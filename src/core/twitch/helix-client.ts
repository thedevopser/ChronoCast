/**
 * Client de l'API REST Helix.
 *
 * Seul composant qui parle à l'API REST de Twitch : il crée et supprime les
 * souscriptions EventSub, et résout l'identité de la chaîne.
 *
 * Sa robustesse détermine celle de toute la connexion. Si la création des
 * souscriptions échoue au démarrage, le subathon ne reçoit plus aucun événement
 * sans que rien ne le signale visiblement — le compteur descend, personne ne
 * comprend pourquoi les subs ne créditent rien.
 *
 * D'où une politique de reprise différenciée selon la nature de l'échec :
 *
 *   - **401** : le jeton a expiré. Renouvellement puis rejeu, une seule fois —
 *     un second refus signifie autre chose qu'une expiration, et insister ne
 *     ferait que retarder le diagnostic.
 *   - **429** : limitation de débit. Attente de l'échéance annoncée par Twitch,
 *     puis rejeu.
 *   - **5xx et pannes réseau** : incident passager, rejeu avec attente
 *     croissante.
 *   - **autres 4xx** : la requête est fautive — condition ou type de
 *     souscription erroné. La rejouer donnerait exactement le même refus.
 */

import type { Logger } from '../logging/logger.js';

/** Attente de base entre deux tentatives, doublée à chaque échec. */
const BASE_BACKOFF_MS = 500;

/** Attente par défaut après un 429 dépourvu d'en-tête d'échéance. */
const DEFAULT_RATE_LIMIT_WAIT_MS = 1_000;

/** Échec d'un appel à l'API Helix. */
export class HelixError extends Error {
  public override readonly name = 'HelixError';

  public constructor(
    message: string,
    public readonly status?: number,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
  }
}

/** Utilisateur Twitch, réduit à ce dont l'application a besoin. */
export interface HelixUser {
  readonly id: string;
  readonly login: string;
  readonly displayName: string;
}

/** Souscription EventSub telle que Helix la rapporte. */
export interface HelixSubscription {
  readonly id: string;
  readonly type: string;
  readonly version: string;
  /** `enabled`, `webhook_callback_verification_pending`, `authorization_revoked`… */
  readonly status: string;
}

export interface CreateSubscriptionRequest {
  readonly type: string;
  readonly version: string;
  /** Condition propre au type, par exemple `{ broadcaster_user_id }`. */
  readonly condition: Readonly<Record<string, string>>;
  /** Session WebSocket à laquelle rattacher la souscription. */
  readonly sessionId: string;
}

export interface HelixSettings {
  readonly helixBaseUrl: string;
  readonly clientId: string;
}

export interface HelixClient {
  /** Identité associée au jeton courant. */
  getCurrentUser(): Promise<HelixUser>;

  /** Crée une souscription rattachée à une session WebSocket. */
  createEventSubSubscription(request: CreateSubscriptionRequest): Promise<HelixSubscription>;

  /** Souscriptions existantes pour cette application. */
  listEventSubSubscriptions(): Promise<HelixSubscription[]>;

  /** Supprime une souscription. */
  deleteEventSubSubscription(id: string): Promise<void>;
}

export interface HelixClientOptions {
  readonly getSettings: () => HelixSettings;
  readonly getAccessToken: () => Promise<string>;
  readonly logger: Logger;
  /** Injecté pour rendre les tests hermétiques au réseau. */
  readonly fetch: typeof fetch;
  /** Injecté pour que les tests n'attendent jamais réellement. */
  readonly sleep: (ms: number) => Promise<void>;
  /** Nombre total de tentatives, rejeux compris. */
  readonly maxAttempts: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Message d'erreur renvoyé par Twitch, ou description du statut. */
function describeFailure(status: number, body: unknown): string {
  if (isRecord(body) && typeof body['message'] === 'string' && body['message'] !== '') {
    return `${String(status)} — ${body['message']}`;
  }
  return `réponse ${String(status)}`;
}

/** Convertit un élément de réponse en souscription, ou `undefined` s'il est mal formé. */
function toSubscription(value: unknown): HelixSubscription | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { id, type, version, status } = value;
  if (
    typeof id !== 'string' ||
    typeof type !== 'string' ||
    typeof version !== 'string' ||
    typeof status !== 'string'
  ) {
    return undefined;
  }
  return { id, type, version, status };
}

export function createHelixClient(options: HelixClientOptions): HelixClient {
  const { getSettings, getAccessToken, logger, fetch: fetchImpl, sleep, maxAttempts } = options;

  /** Attente demandée par Twitch après un 429, avec un plancher raisonnable. */
  function rateLimitWaitMs(response: Response): number {
    const reset = response.headers.get('ratelimit-reset');
    if (reset === null) {
      return DEFAULT_RATE_LIMIT_WAIT_MS;
    }

    const seconds = Number(reset);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return DEFAULT_RATE_LIMIT_WAIT_MS;
    }

    // Twitch documente un horodatage absolu, mais renvoie parfois une durée.
    // On retient l'interprétation la plus prudente, sans jamais dépasser une
    // minute : au-delà, mieux vaut échouer visiblement que paraître figé.
    const asDuration = seconds * 1_000;
    const asDeadline = seconds * 1_000 - Date.now();
    return Math.min(Math.max(asDuration, asDeadline, DEFAULT_RATE_LIMIT_WAIT_MS), 60_000);
  }

  /**
   * Exécute une requête avec la politique de reprise.
   *
   * @param path Chemin relatif à la base Helix.
   * @param init Options de requête, hors en-têtes d'authentification.
   */
  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    const settings = getSettings();
    const url = `${settings.helixBaseUrl}${path}`;

    let lastFailure: HelixError | undefined;
    let tokenRetried = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      // Le jeton est redemandé à chaque tentative : le service OAuth peut
      // l'avoir renouvelé entre-temps, et une demande de réauthentification doit
      // remonter telle quelle plutôt que d'être déguisée en échec réseau.
      const accessToken = await getAccessToken();

      const headers = new Headers(init.headers);
      headers.set('Authorization', `Bearer ${accessToken}`);
      headers.set('Client-Id', settings.clientId);
      if (init.body !== undefined && !headers.has('content-type')) {
        headers.set('content-type', 'application/json');
      }

      let response: Response;
      try {
        response = await fetchImpl(url, { ...init, headers });
      } catch (error) {
        lastFailure = new HelixError('API Twitch injoignable', undefined, error);
        if (attempt < maxAttempts) {
          await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
          continue;
        }
        break;
      }

      if (response.status === 204) {
        return undefined;
      }

      const text = await response.text();
      let body: unknown;
      if (text !== '') {
        try {
          body = JSON.parse(text);
        } catch (error) {
          throw new HelixError('réponse Helix illisible', response.status, error);
        }
      }

      if (response.ok) {
        return body;
      }

      if (response.status === 401 && !tokenRetried) {
        // Le jeton a expiré en vol : une seule reprise, le temps qu'il soit
        // renouvelé par le service OAuth au tour suivant.
        tokenRetried = true;
        logger.debug('jeton refusé par Helix, nouvelle tentative après renouvellement');
        lastFailure = new HelixError(describeFailure(response.status, body), response.status);
        continue;
      }

      if (response.status === 429) {
        lastFailure = new HelixError(describeFailure(response.status, body), response.status);
        if (attempt < maxAttempts) {
          const waitMs = rateLimitWaitMs(response);
          logger.warning('limitation de débit Helix, attente avant nouvelle tentative', { waitMs });
          await sleep(waitMs);
          continue;
        }
        break;
      }

      if (response.status >= 500) {
        lastFailure = new HelixError(describeFailure(response.status, body), response.status);
        if (attempt < maxAttempts) {
          await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
          continue;
        }
        break;
      }

      // Autres 4xx : la requête est fautive, la rejouer donnerait le même refus.
      throw new HelixError(describeFailure(response.status, body), response.status);
    }

    throw lastFailure ?? new HelixError('appel Helix en échec');
  }

  /** Extrait le tableau `data` d'une réponse Helix. */
  function readData(payload: unknown): unknown[] {
    if (!isRecord(payload) || !Array.isArray(payload['data'])) {
      throw new HelixError('réponse Helix inattendue : tableau « data » absent');
    }
    return payload['data'];
  }

  return {
    async getCurrentUser(): Promise<HelixUser> {
      const data = readData(await request('/users'));
      const first = data[0];

      if (!isRecord(first) || typeof first['id'] !== 'string' || typeof first['login'] !== 'string') {
        throw new HelixError('aucun utilisateur associé au jeton courant');
      }

      return {
        id: first['id'],
        login: first['login'],
        displayName:
          typeof first['display_name'] === 'string' ? first['display_name'] : first['login'],
      };
    },

    async createEventSubSubscription(
      requestParams: CreateSubscriptionRequest,
    ): Promise<HelixSubscription> {
      const payload = await request('/eventsub/subscriptions', {
        method: 'POST',
        body: JSON.stringify({
          type: requestParams.type,
          version: requestParams.version,
          condition: requestParams.condition,
          transport: { method: 'websocket', session_id: requestParams.sessionId },
        }),
      });

      const subscription = toSubscription(readData(payload)[0]);
      if (subscription === undefined) {
        throw new HelixError(`souscription ${requestParams.type} créée mais non décrite`);
      }

      logger.debug('souscription EventSub créée', {
        type: subscription.type,
        status: subscription.status,
      });
      return subscription;
    },

    async listEventSubSubscriptions(): Promise<HelixSubscription[]> {
      const data = readData(await request('/eventsub/subscriptions'));
      return data
        .map(toSubscription)
        .filter((subscription): subscription is HelixSubscription => subscription !== undefined);
    },

    async deleteEventSubSubscription(id: string): Promise<void> {
      await request(`/eventsub/subscriptions?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      logger.debug('souscription EventSub supprimée', { id });
    },
  };
}
