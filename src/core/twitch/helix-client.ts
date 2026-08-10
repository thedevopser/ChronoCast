import type { Logger } from '../logging/logger.js';

const BASE_BACKOFF_MS = 500;

const DEFAULT_RATE_LIMIT_WAIT_MS = 1_000;

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

export interface HelixUser {
  readonly id: string;
  readonly login: string;
  readonly displayName: string;
}

export interface HelixSubscription {
  readonly id: string;
  readonly type: string;
  readonly version: string;
  readonly status: string;
}

export interface CreateSubscriptionRequest {
  readonly type: string;
  readonly version: string;
  readonly condition: Readonly<Record<string, string>>;
  readonly sessionId: string;
}

export interface HelixSettings {
  readonly helixBaseUrl: string;
  readonly clientId: string;
}

export interface HelixClient {
  getCurrentUser(): Promise<HelixUser>;

  createEventSubSubscription(request: CreateSubscriptionRequest): Promise<HelixSubscription>;

  listEventSubSubscriptions(): Promise<HelixSubscription[]>;

  deleteEventSubSubscription(id: string): Promise<void>;
}

export interface HelixClientOptions {
  readonly getSettings: () => HelixSettings;
  readonly getAccessToken: () => Promise<string>;
  readonly logger: Logger;
  readonly fetch: typeof fetch;
  readonly sleep: (ms: number) => Promise<void>;
  readonly maxAttempts: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function describeFailure(status: number, body: unknown): string {
  if (isRecord(body) && typeof body['message'] === 'string' && body['message'] !== '') {
    return `${String(status)} — ${body['message']}`;
  }
  return `réponse ${String(status)}`;
}

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

  function rateLimitWaitMs(response: Response): number {
    const reset = response.headers.get('ratelimit-reset');
    if (reset === null) {
      return DEFAULT_RATE_LIMIT_WAIT_MS;
    }

    const seconds = Number(reset);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return DEFAULT_RATE_LIMIT_WAIT_MS;
    }

    const asDuration = seconds * 1_000;
    const asDeadline = seconds * 1_000 - Date.now();
    return Math.min(Math.max(asDuration, asDeadline, DEFAULT_RATE_LIMIT_WAIT_MS), 60_000);
  }

  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    const settings = getSettings();
    const url = `${settings.helixBaseUrl}${path}`;

    let lastFailure: HelixError | undefined;
    let tokenRetried = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
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

      throw new HelixError(describeFailure(response.status, body), response.status);
    }

    throw lastFailure ?? new HelixError('appel Helix en échec');
  }

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
