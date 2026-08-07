import { z } from 'zod';

import type { TwitchStatusPayload } from '../../app/app-events.js';
import type { SystemSettingsOpener } from '../../app/ports.js';
import type { ConfigService } from '../../config/config-service.js';
import type { CounterEventOutcome, CounterService } from '../../counter/counter-service.js';
import type { DomainEvent, DomainEventType } from '../../events/domain-event.js';
import type { EventHistoryService } from '../../history/event-history-service.js';
import type { Logger, LogLevel } from '../../logging/logger.js';
import type { RingBufferSink } from '../../logging/sinks/ring-buffer-sink.js';
import {
  errorResponse,
  jsonResponse,
  noContentResponse,
  type HttpRequest,
  type HttpResponse,
} from '../http-types.js';
import type { Route } from '../router.js';

export interface TwitchApiPort {
  getStatus(): TwitchStatusPayload;

  describe(): Promise<{
    readonly broadcasterLogin: string;
    readonly clientId: string;
    readonly hasClientSecret: boolean;
    readonly connected: boolean;
    readonly scopes: readonly string[];
    readonly missingScopes: readonly string[];
  }>;

  startAuthorization(): Promise<{ readonly authorizationUrl: string }>;

  revoke(): Promise<void>;

  listSubscriptions(): Promise<
    { readonly id: string; readonly type: string; readonly status: string }[]
  >;

  setClientSecret(secret: string): Promise<void>;
}

export interface ApiContext {
  readonly config: ConfigService;
  readonly counter: CounterService;
  readonly history: EventHistoryService;

  readonly system?: SystemSettingsOpener | undefined;
  readonly logs: RingBufferSink;
  readonly twitch: TwitchApiPort;
  readonly getPort: () => number;
  readonly appVersion: string;
  readonly applyManualEvent: (event: DomainEvent) => Promise<CounterEventOutcome>;
  readonly logger: Logger;
}

const HISTORY_LIMIT = { min: 1, max: 500, fallback: 50 } as const;
const LOG_LIMIT = { min: 1, max: 1_000, fallback: 200 } as const;

const MAX_REASON_LENGTH = 200;

const MAX_USER_NAME_LENGTH = 64;

const MAX_ADJUSTMENT_SECONDS = 86_400;

const MAX_INITIAL_SECONDS = 2_592_000;

const secondsSchema = z.number().int().positive().max(MAX_ADJUSTMENT_SECONDS);

const adjustmentSchema = z
  .object({
    seconds: secondsSchema,
    reason: z.string().max(MAX_REASON_LENGTH).optional(),
  })
  .strip();

const initialSchema = z
  .object({ seconds: z.number().int().positive().max(MAX_INITIAL_SECONDS) })
  .strip();

const configPatchSchema = z
  .object({
    config: z.record(z.string(), z.unknown()).optional(),
    clientSecret: z.string().min(1).max(200).optional(),
  })
  .strip();

const importSchema = z.object({ content: z.string().min(1).max(1_048_576) }).strip();

const overlayTestSchema = z
  .object({
    type: z.enum(['sub', 'resub', 'gift', 'bits', 'raid', 'follow', 'command']),
    userName: z.string().min(1).optional(),
  })
  .strip();

const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warning', 'error'];

function parseJsonBody(request: HttpRequest): unknown {
  if (request.body === '') {
    return {};
  }
  try {
    return JSON.parse(request.body);
  } catch {
    return null;
  }
}

function badRequest(message: string): HttpResponse {
  return errorResponse(400, 'invalid_request', message);
}

function boundedInteger(
  raw: string | null,
  bounds: { readonly min: number; readonly max: number; readonly fallback: number },
): number {
  const parsed = Number(raw);
  if (raw === null || !Number.isFinite(parsed)) {
    return bounds.fallback;
  }
  return Math.min(bounds.max, Math.max(bounds.min, Math.trunc(parsed)));
}

function buildTestEvent(type: DomainEventType, userName: string, now: number): DomainEvent {
  const base = {
    id: `test-${String(now)}`,
    occurredAt: now,
    userId: 'test',
    userName: userName.slice(0, MAX_USER_NAME_LENGTH),
    source: 'manual',
  } as const;

  switch (type) {
    case 'sub':
      return { ...base, type: 'sub', tier: 'tier1' };
    case 'resub':
      return { ...base, type: 'resub', tier: 'tier1', cumulativeMonths: 12 };
    case 'gift':
      return { ...base, type: 'gift', tier: 'tier1', total: 5, isAnonymous: false };
    case 'bits':
      return { ...base, type: 'bits', bits: 500 };
    case 'raid':
      return { ...base, type: 'raid', viewers: 42 };
    case 'follow':
      return { ...base, type: 'follow' };
    case 'command':
      return { ...base, type: 'command', command: 'addtime', seconds: 300 };
  }
}

export function createApiRoutes(context: ApiContext): Route[] {
  const {
    config,
    counter,
    history,
    logs,
    twitch,
    system,
    getPort,
    appVersion,
    applyManualEvent,
    logger,
  } = context;
  const scoped = logger.child('api');

  async function throughTwitch<T>(
    operation: () => Promise<T>,
    describe: string,
  ): Promise<T | HttpResponse> {
    try {
      return await operation();
    } catch (error) {
      scoped.error('opération Twitch en échec', { operation: describe, cause: error });
      return errorResponse(502, 'twitch_unavailable', 'Twitch n’a pas répondu. Réessayez.');
    }
  }

  function isResponse(value: unknown): value is HttpResponse {
    return typeof value === 'object' && value !== null && 'status' in value && 'headers' in value;
  }

  return [
    {
      method: 'GET',
      path: '/api/state',
      handler: () =>
        jsonResponse(200, {
          counter: counter.getState(),
          twitch: twitch.getStatus(),
          overlay: config.get().overlay,
          port: getPort(),
          appVersion,
        }),
    },

    {
      method: 'GET',
      path: '/api/config',
      handler: async () => {
        const description = await throughTwitch(() => twitch.describe(), 'describe');
        if (isResponse(description)) {
          return description;
        }

        return jsonResponse(200, {
          config: config.get(),
          hasClientSecret: description.hasClientSecret,
        });
      },
    },

    {
      method: 'PATCH',
      path: '/api/config',
      handler: async (request) => {
        const raw = parseJsonBody(request);
        if (raw === null) {
          return badRequest('Corps de requête illisible.');
        }

        const parsed = configPatchSchema.safeParse(raw);
        if (!parsed.success) {
          return badRequest('Modification refusée : forme inattendue.');
        }

        if (parsed.data.clientSecret !== undefined) {
          const stored = await throughTwitch(
            () => twitch.setClientSecret(parsed.data.clientSecret ?? ''),
            'setClientSecret',
          );
          if (isResponse(stored)) {
            return stored;
          }
        }

        if (parsed.data.config !== undefined) {
          try {
            await config.update(parsed.data.config);
          } catch (error) {
            scoped.warning('modification de configuration refusée', { cause: error });
            return badRequest('Valeur de configuration invalide.');
          }
        }

        return jsonResponse(200, { config: config.get() });
      },
    },

    {
      method: 'GET',
      path: '/api/config/export',
      handler: () => ({
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'content-disposition': 'attachment; filename="chronocast-config.json"',
        },
        body: config.export(),
      }),
    },

    {
      method: 'POST',
      path: '/api/config/import',
      handler: async (request) => {
        const raw = parseJsonBody(request);
        if (raw === null) {
          return badRequest('Corps de requête illisible.');
        }

        const parsed = importSchema.safeParse(raw);
        if (!parsed.success) {
          return badRequest('Fichier de configuration attendu.');
        }

        try {
          await config.import(parsed.data.content);
        } catch (error) {
          scoped.warning('import de configuration refusé', { cause: error });
          return badRequest('Fichier de configuration invalide.');
        }

        return jsonResponse(200, { config: config.get() });
      },
    },

    {
      method: 'POST',
      path: '/api/counter/pause',
      handler: async () => jsonResponse(200, { counter: await counter.pause() }),
    },
    {
      method: 'POST',
      path: '/api/counter/resume',
      handler: async () => jsonResponse(200, { counter: await counter.resume() }),
    },
    {
      method: 'POST',
      path: '/api/counter/reset',
      handler: async () => jsonResponse(200, { counter: await counter.reset() }),
    },

    {
      method: 'POST',
      path: '/api/counter/add',
      handler: async (request) => {
        const parsed = adjustmentSchema.safeParse(parseJsonBody(request));
        if (!parsed.success) {
          return badRequest('Durée invalide.');
        }
        const reason = parsed.data.reason ?? 'ajout manuel';
        return jsonResponse(200, { counter: await counter.addTime(parsed.data.seconds, reason) });
      },
    },

    {
      method: 'POST',
      path: '/api/counter/remove',
      handler: async (request) => {
        const parsed = adjustmentSchema.safeParse(parseJsonBody(request));
        if (!parsed.success) {
          return badRequest('Durée invalide.');
        }
        const reason = parsed.data.reason ?? 'retrait manuel';
        return jsonResponse(200, {
          counter: await counter.removeTime(parsed.data.seconds, reason),
        });
      },
    },

    {
      method: 'POST',
      path: '/api/counter/initial',
      handler: async (request) => {
        const parsed = initialSchema.safeParse(parseJsonBody(request));
        if (!parsed.success) {
          return badRequest('Valeur de départ invalide.');
        }
        return jsonResponse(200, {
          counter: await counter.setInitialSeconds(parsed.data.seconds),
        });
      },
    },

    {
      method: 'GET',
      path: '/api/twitch/status',
      handler: async () => {
        const description = await throughTwitch(() => twitch.describe(), 'describe');
        if (isResponse(description)) {
          return description;
        }

        const status = twitch.getStatus();
        return jsonResponse(200, {
          status: status.status,
          detail: status.detail,
          ...description,
        });
      },
    },

    {
      method: 'POST',
      path: '/api/twitch/connect',
      handler: async () => {
        const started = await throughTwitch(() => twitch.startAuthorization(), 'startAuthorization');
        return isResponse(started) ? started : jsonResponse(200, started);
      },
    },

    {
      method: 'POST',
      path: '/api/twitch/revoke',
      handler: async () => {
        const revoked = await throughTwitch(() => twitch.revoke(), 'revoke');
        return isResponse(revoked) ? revoked : noContentResponse();
      },
    },

    {
      method: 'GET',
      path: '/api/twitch/subscriptions',
      handler: async () => {
        const subscriptions = await throughTwitch(
          () => twitch.listSubscriptions(),
          'listSubscriptions',
        );
        return isResponse(subscriptions)
          ? subscriptions
          : jsonResponse(200, { subscriptions });
      },
    },

    {
      method: 'GET',
      path: '/api/history',
      handler: async (request) => {
        const limit = boundedInteger(request.query.get('limit'), HISTORY_LIMIT);
        return jsonResponse(200, { entries: await history.list(limit) });
      },
    },

    {
      method: 'GET',
      path: '/api/logs',
      handler: (request) => {
        const limit = boundedInteger(request.query.get('limit'), LOG_LIMIT);
        const requested = request.query.get('level');

        const threshold = LOG_LEVELS.indexOf(requested as LogLevel);
        const records = logs
          .snapshot(limit)
          .filter((record) => threshold < 0 || LOG_LEVELS.indexOf(record.level) >= threshold);

        return jsonResponse(200, { records });
      },
    },

    {
      method: 'POST',
      path: '/api/overlay/test',
      handler: async (request) => {
        const parsed = overlayTestSchema.safeParse(parseJsonBody(request));
        if (!parsed.success) {
          return badRequest('Type d’événement de test inconnu.');
        }

        const event = buildTestEvent(
          parsed.data.type,
          parsed.data.userName ?? 'ChronoCast',
          Date.now(),
        );

        const outcome = await applyManualEvent(event);

        return jsonResponse(200, {
          event,
          rewardSeconds: outcome.reward.seconds,
          counter: outcome.state,
        });
      },
    },

    {
      method: 'POST',
      path: '/api/system/startup-settings',
      handler: async () => {
        if (system === undefined) {
          return errorResponse(
            501,
            'shell_unavailable',
            'Ce point d’entrée ne peut pas ouvrir les paramètres de Windows.',
          );
        }

        await system.openStartupSettings();
        return noContentResponse();
      },
    },
  ];
}
