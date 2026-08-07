import type { Clock } from '../app/ports.js';
import type { Logger } from '../logging/logger.js';
import type { TokenStore, TwitchCredentials } from './token-store.js';

const REFRESH_MARGIN_MS = 300_000;

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

export class ReauthenticationRequiredError extends Error {
  public override readonly name = 'ReauthenticationRequiredError';

  public constructor(public readonly detail: string) {
    super(`réauthentification Twitch requise : ${detail}`);
  }
}

export interface TokenValidation {
  readonly clientId: string;
  readonly login: string;
  readonly userId: string;
  readonly scopes: readonly string[];
  readonly expiresInSeconds?: number;
}

export interface AuthorizationUrlParams {
  readonly idBaseUrl: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly scopes: readonly string[];
  readonly state: string;
  readonly forceVerify?: boolean;
}

export function buildAuthorizationUrl(params: AuthorizationUrlParams): string {
  const url = new URL('/oauth2/authorize', params.idBaseUrl);

  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
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
  exchangeCode(code: string, clientSecret: string): Promise<TwitchCredentials>;

  getAccessToken(): Promise<string>;

  validate(accessToken: string): Promise<TokenValidation>;

  findMissingScopes(granted: readonly string[]): string[];

  revoke(): Promise<void>;
}

export interface OAuthServiceOptions {
  readonly tokenStore: TokenStore;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly fetch: typeof fetch;
  readonly getSettings: () => OAuthSettings;
}

interface TokenResponse {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly expires_in: number;
  readonly scope?: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

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

function describeFailure(status: number, body: unknown): string {
  if (isRecord(body) && typeof body['message'] === 'string') {
    return `${String(status)} — ${body['message']}`;
  }
  return `réponse ${String(status)}`;
}

export function createOAuthService(options: OAuthServiceOptions): OAuthService {
  const { tokenStore, clock, logger, fetch: fetchImpl, getSettings } = options;

  let pendingToken: Promise<string> | undefined;

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
      throw new OAuthError(`${context} : réponse illisible`, response.status, error);
    }
  }

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
      scopes: response.scope ?? fallbackScopes,
    };
  }

  async function performRefresh(credentials: TwitchCredentials): Promise<string> {
    const settings = getSettings();

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

  async function resolveToken(): Promise<string> {
    const credentials = await tokenStore.load();
    if (credentials === null) {
      throw new ReauthenticationRequiredError('aucun identifiant enregistré');
    }

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
          logger.warning('révocation distante impossible', { cause: error });
        }
      }

      await tokenStore.clear();
    },
  };
}
