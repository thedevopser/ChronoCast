/**
 * Service OAuth Twitch.
 *
 * Il tient une promesse forte du cahier des charges : « l'utilisateur ne doit
 * plus jamais refaire la manipulation ». Trois choix de conception y concourent.
 *
 * **Flux code d'autorisation.** C'est le seul à délivrer un jeton de
 * rafraîchissement utilisateur, indispensable aux portées d'abonnements, de bits
 * et de chat. Les identifiants client seuls ne donneraient qu'un jeton
 * applicatif, incapable de lire les abonnements d'une chaîne.
 *
 * **Renouvellement proactif.** Le jeton est renouvelé avant expiration plutôt
 * qu'après un refus, si bien qu'aucun appel ne part avec un jeton qui mourra en
 * chemin. Les renouvellements concurrents sont mutualisés : le client EventSub
 * et le client Helix peuvent réclamer un jeton au même instant, et deux
 * renouvellements simultanés s'invalideraient mutuellement.
 *
 * **Aucune insistance sur un jeton de rafraîchissement invalide.** Réessayer
 * n'aboutirait pas et masquerait la seule action utile : prévenir l'utilisateur.
 * Les identifiants sont alors effacés et une réauthentification est demandée.
 */

import type { Clock } from '../app/ports.js';
import type { Logger } from '../logging/logger.js';
import type { TokenStore, TwitchCredentials } from './token-store.js';

/**
 * Marge de renouvellement anticipé.
 *
 * Un jeton expirant dans moins de cinq minutes est renouvelé sans attendre : la
 * connexion EventSub peut vivre des heures, et un jeton mort en cours de route
 * provoquerait une révocation de toutes les souscriptions.
 */
const REFRESH_MARGIN_MS = 300_000;

/** Échec d'un échange avec le service d'identité de Twitch. */
export class OAuthError extends Error {
  public override readonly name = 'OAuthError';

  public constructor(
    message: string,
    public readonly status?: number,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
  }
}

/**
 * L'utilisateur doit repasser par l'assistant d'authentification.
 *
 * Distinct d'{@link OAuthError} : ce n'est pas un incident technique mais une
 * action requise de l'utilisateur, que l'interface doit présenter comme telle.
 */
export class ReauthenticationRequiredError extends Error {
  public override readonly name = 'ReauthenticationRequiredError';

  public constructor(public readonly detail: string) {
    super(`réauthentification Twitch requise : ${detail}`);
  }
}

/** Identité et portées associées à un jeton, telles que Twitch les rapporte. */
export interface TokenValidation {
  readonly clientId: string;
  readonly login: string;
  readonly userId: string;
  readonly scopes: readonly string[];
  /** Secondes restantes. Absent pour un jeton sans expiration. */
  readonly expiresInSeconds?: number;
}

/** Paramètres de composition de l'URL d'autorisation. */
export interface AuthorizationUrlParams {
  readonly idBaseUrl: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly scopes: readonly string[];
  /** Valeur aléatoire vérifiée au retour, contre la falsification de requête. */
  readonly state: string;
  /** Impose l'écran de consentement, pour obtenir un jeton de rafraîchissement neuf. */
  readonly forceVerify?: boolean;
}

/**
 * Compose l'URL vers laquelle envoyer l'utilisateur.
 *
 * Fonction pure, exposée séparément : l'assistant de configuration l'appelle
 * sans avoir besoin du service complet.
 */
export function buildAuthorizationUrl(params: AuthorizationUrlParams): string {
  const url = new URL('/oauth2/authorize', params.idBaseUrl);

  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  // Twitch attend les portées séparées par des espaces, et non par des virgules.
  url.searchParams.set('scope', params.scopes.join(' '));
  url.searchParams.set('state', params.state);

  if (params.forceVerify === true) {
    url.searchParams.set('force_verify', 'true');
  }

  return url.toString();
}

export interface OAuthSettings {
  readonly idBaseUrl: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly scopes: readonly string[];
}

export interface OAuthService {
  /** Échange le code reçu sur la redirection contre des identifiants complets. */
  exchangeCode(code: string, clientSecret: string): Promise<TwitchCredentials>;

  /**
   * Renvoie un jeton d'accès utilisable, en le renouvelant si nécessaire.
   * @throws ReauthenticationRequiredError si l'utilisateur doit se reconnecter.
   */
  getAccessToken(): Promise<string>;

  /** Interroge Twitch sur la validité d'un jeton et les portées accordées. */
  validate(accessToken: string): Promise<TokenValidation>;

  /** Portées requises qui ne figurent pas parmi celles demandées. */
  findMissingScopes(granted: readonly string[]): string[];

  /** Révoque le jeton auprès de Twitch et efface les identifiants locaux. */
  revoke(): Promise<void>;
}

export interface OAuthServiceOptions {
  readonly tokenStore: TokenStore;
  readonly clock: Clock;
  readonly logger: Logger;
  /** Injecté pour rendre les tests hermétiques au réseau. */
  readonly fetch: typeof fetch;
  /** Lu à chaque appel : un changement de configuration prend effet aussitôt. */
  readonly getSettings: () => OAuthSettings;
}

/** Réponse de `/oauth2/token`, telle que Twitch la renvoie. */
interface TokenResponse {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly expires_in: number;
  readonly scope?: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Valide la forme d'une réponse de jeton. */
function isTokenResponse(value: unknown): value is TokenResponse {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value['access_token'] === 'string' &&
    typeof value['refresh_token'] === 'string' &&
    typeof value['expires_in'] === 'number'
  );
}

/** Extrait le message d'erreur renvoyé par Twitch, quand il y en a un. */
function describeFailure(status: number, body: unknown): string {
  if (isRecord(body) && typeof body['message'] === 'string') {
    return `${String(status)} — ${body['message']}`;
  }
  return `réponse ${String(status)}`;
}

export function createOAuthService(options: OAuthServiceOptions): OAuthService {
  const { tokenStore, clock, logger, fetch: fetchImpl, getSettings } = options;

  /**
   * Résolution de jeton en cours.
   *
   * Mutualise les demandes concurrentes : sans cela, deux appels simultanés
   * lanceraient deux renouvellements, et le second invaliderait le jeton obtenu
   * par le premier.
   *
   * La garde doit être posée **avant toute attente**. Une version antérieure
   * consultait le magasin de jetons d'abord : trois appels concurrents
   * franchissaient alors tous la garde pendant cette attente et déclenchaient
   * trois renouvellements. Défaut trouvé par le test de concurrence.
   */
  let pendingToken: Promise<string> | undefined;

  /** Exécute une requête et décode sa réponse JSON, sans jamais lever brut. */
  async function requestJson(
    url: string,
    init: RequestInit,
    context: string,
  ): Promise<{ readonly status: number; readonly body: unknown }> {
    let response: Response;
    try {
      response = await fetchImpl(url, init);
    } catch (error) {
      throw new OAuthError(`${context} : service d'identité Twitch injoignable`, undefined, error);
    }

    const text = await response.text();
    if (text === '') {
      return { status: response.status, body: undefined };
    }

    try {
      return { status: response.status, body: JSON.parse(text) };
    } catch (error) {
      // Twitch renvoie parfois une page HTML lors d'un incident : ne pas le
      // traiter produirait une exception de parsing incompréhensible.
      throw new OAuthError(`${context} : réponse illisible`, response.status, error);
    }
  }

  /** Convertit une réponse de jeton en identifiants persistables. */
  function toCredentials(
    response: TokenResponse,
    clientSecret: string,
    fallbackScopes: readonly string[],
  ): TwitchCredentials {
    return {
      clientSecret,
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      expiresAt: clock.now() + response.expires_in * 1_000,
      // Twitch peut accorder moins que demandé : ce sont les portées réellement
      // obtenues qui font foi pour le plan de souscriptions.
      scopes: response.scope ?? fallbackScopes,
    };
  }

  /** Renouvelle effectivement le jeton. Appelé une seule fois à la fois. */
  async function performRefresh(credentials: TwitchCredentials): Promise<string> {
    const settings = getSettings();

    // Le secret transite dans le corps et jamais en chaîne de requête : une URL
    // finit dans les journaux du serveur distant et des mandataires.
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: credentials.refreshToken,
      client_id: settings.clientId,
      client_secret: credentials.clientSecret,
    });

    const { status, body: payload } = await requestJson(
      new URL('/oauth2/token', settings.idBaseUrl).toString(),
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      },
      'renouvellement du jeton',
    );

    if (status !== 200 || !isTokenResponse(payload)) {
      // Aucune tentative supplémentaire : un jeton de rafraîchissement refusé
      // le restera, et insister masquerait la seule action utile.
      logger.warning('jeton de rafraîchissement refusé', {
        detail: describeFailure(status, payload),
      });
      await tokenStore.clear();
      throw new ReauthenticationRequiredError(describeFailure(status, payload));
    }

    const renewed = toCredentials(payload, credentials.clientSecret, credentials.scopes);
    await tokenStore.save(renewed);

    logger.info('jeton Twitch renouvelé', {
      expiresAt: new Date(renewed.expiresAt).toISOString(),
    });

    return renewed.accessToken;
  }

  /** Relit les identifiants et renouvelle le jeton si son échéance approche. */
  async function resolveToken(): Promise<string> {
    const credentials = await tokenStore.load();
    if (credentials === null) {
      throw new ReauthenticationRequiredError('aucun identifiant enregistré');
    }

    // Marge de sécurité : un appel ne doit jamais partir avec un jeton qui
    // expirera pendant son trajet.
    if (credentials.expiresAt - clock.now() > REFRESH_MARGIN_MS) {
      return credentials.accessToken;
    }

    return performRefresh(credentials);
  }

  return {
    async exchangeCode(code: string, clientSecret: string): Promise<TwitchCredentials> {
      const settings = getSettings();

      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: settings.clientId,
        client_secret: clientSecret,
        redirect_uri: settings.redirectUri,
      });

      const { status, body: payload } = await requestJson(
        new URL('/oauth2/token', settings.idBaseUrl).toString(),
        {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        },
        "échange du code d'autorisation",
      );

      if (status !== 200) {
        throw new OAuthError(
          `échange du code refusé : ${describeFailure(status, payload)}`,
          status,
        );
      }

      if (!isTokenResponse(payload)) {
        throw new OAuthError('réponse de jeton incomplète', status);
      }

      const credentials = toCredentials(payload, clientSecret, settings.scopes);
      await tokenStore.save(credentials);

      logger.info('authentification Twitch réussie', { scopes: credentials.scopes });
      return credentials;
    },

    // Volontairement pas `async` : la garde de mutualisation doit être posée de
    // façon strictement synchrone, avant que l'appelant ne rende la main.
    getAccessToken(): Promise<string> {
      if (pendingToken !== undefined) {
        return pendingToken;
      }

      const operation = resolveToken().finally(() => {
        pendingToken = undefined;
      });
      pendingToken = operation;
      return operation;
    },

    async validate(accessToken: string): Promise<TokenValidation> {
      const settings = getSettings();

      // Le jeton voyage dans l'en-tête et non dans l'URL, pour la même raison
      // que le secret client lors de l'échange.
      const { status, body } = await requestJson(
        new URL('/oauth2/validate', settings.idBaseUrl).toString(),
        { method: 'GET', headers: { Authorization: `OAuth ${accessToken}` } },
        'validation du jeton',
      );

      if (status !== 200 || !isRecord(body)) {
        throw new OAuthError(`validation refusée : ${describeFailure(status, body)}`, status);
      }

      const scopes = Array.isArray(body['scopes'])
        ? body['scopes'].filter((scope): scope is string => typeof scope === 'string')
        : [];

      const expiresIn = body['expires_in'];

      return {
        clientId: typeof body['client_id'] === 'string' ? body['client_id'] : '',
        login: typeof body['login'] === 'string' ? body['login'] : '',
        userId: typeof body['user_id'] === 'string' ? body['user_id'] : '',
        scopes,
        ...(typeof expiresIn === 'number' ? { expiresInSeconds: expiresIn } : {}),
      };
    },

    findMissingScopes(granted: readonly string[]): string[] {
      const accorded = new Set(granted);
      return getSettings().scopes.filter((scope) => !accorded.has(scope));
    },

    async revoke(): Promise<void> {
      const settings = getSettings();
      const credentials = await tokenStore.load();

      if (credentials !== null) {
        const body = new URLSearchParams({
          client_id: settings.clientId,
          token: credentials.accessToken,
        });

        try {
          await fetchImpl(new URL('/oauth2/revoke', settings.idBaseUrl).toString(), {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
          });
        } catch (error) {
          // L'échec est sans importance : le jeton local est de toute façon
          // destiné à disparaître, et le conserver bloquerait une nouvelle
          // authentification.
          logger.warning('révocation distante impossible', { cause: error });
        }
      }

      await tokenStore.clear();
    },
  };
}
