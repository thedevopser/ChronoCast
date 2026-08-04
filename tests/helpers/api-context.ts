/**
 * Contexte d'API en mémoire.
 *
 * Les routes ne sont que de la délégation : leur intérêt est dans ce qu'elles
 * valident et dans ce qu'elles refusent de renvoyer, pas dans le métier qu'elles
 * appellent. Les doubles ci-dessous rendent donc chaque dépendance triviale et
 * observable, sans disque, sans réseau et sans minuteur.
 */

import type { TwitchStatusPayload } from '../../src/core/app/app-events.js';
import { DEFAULT_CONFIG } from '../../src/core/config/defaults.js';
import type { ChronoCastConfig } from '../../src/core/config/schema.js';
import { configSchema } from '../../src/core/config/schema.js';
import type { ConfigService, DeepPartial } from '../../src/core/config/config-service.js';
import { createInitialState, type CounterState } from '../../src/core/counter/counter-state.js';
import type { CounterEventOutcome, CounterService } from '../../src/core/counter/counter-service.js';
import type { DomainEvent } from '../../src/core/events/domain-event.js';
import type { HistoryEntry } from '../../src/core/history/event-history-service.js';
import type { EventHistoryService } from '../../src/core/history/event-history-service.js';
import {
  createRingBufferSink,
  type RingBufferSink,
} from '../../src/core/logging/sinks/ring-buffer-sink.js';
import { createLogger, type LogSink } from '../../src/core/logging/logger.js';
import type { ApiContext, TwitchApiPort, UpdateApiPort } from '../../src/core/server/routes/api.js';
import type { UpdateStatus } from '../../src/core/update/update-service.js';

const SILENT_SINK: LogSink = { name: 'silencieux', write: () => undefined };

export interface ApiDoubles {
  context: ApiContext;
  calls: string[];
  ringBuffer: RingBufferSink;
  config: ChronoCastConfig;
  counterState: CounterState;
  historyEntries: HistoryEntry[];
  twitchStatus: TwitchStatusPayload;
  clientSecret: string | null;
  /** État de la mise à jour, que chaque test pose comme il l'entend. */
  updateStatus: UpdateStatus;
  /** Fait échouer la prochaine opération Twitch, pour éprouver la remontée d'erreur. */
  failTwitch: boolean;
}

export function createApiDoubles(): ApiDoubles {
  const calls: string[] = [];
  const ringBuffer = createRingBufferSink(50);

  const doubles = {
    calls,
    config: DEFAULT_CONFIG,
    counterState: createInitialState({ initialMs: 43_200_000, now: 1_700_000_000_000 }),
    historyEntries: [] as HistoryEntry[],
    twitchStatus: { status: 'ready' } as TwitchStatusPayload,
    clientSecret: null as string | null,
    failTwitch: false,
    updateStatus: {
      phase: 'idle',
      currentVersion: '0.1.0',
      availableVersion: null,
      notesUrl: null,
      message: null,
      checkedAt: null,
    } as UpdateStatus,
  };

  const configService: ConfigService = {
    load: () => Promise.resolve(doubles.config),
    get: () => doubles.config,
    update: (patch: DeepPartial<ChronoCastConfig>) => {
      calls.push('config.update');
      // Fusion naïve au premier niveau : suffisant pour observer ce que la route
      // transmet, le vrai service étant testé pour lui-même.
      doubles.config = configSchema.parse({ ...doubles.config, ...patch });
      return Promise.resolve(doubles.config);
    },
    export: () => {
      calls.push('config.export');
      return JSON.stringify(doubles.config);
    },
    import: (serialized: string) => {
      calls.push('config.import');
      doubles.config = configSchema.parse(JSON.parse(serialized));
      return Promise.resolve(doubles.config);
    },
    onChange: () => () => undefined,
  };

  const counterService: CounterService = {
    start: () => Promise.resolve(),
    stop: () => Promise.resolve(),
    getState: () => doubles.counterState,
    pause: () => {
      calls.push('counter.pause');
      return Promise.resolve(doubles.counterState);
    },
    resume: () => {
      calls.push('counter.resume');
      return Promise.resolve(doubles.counterState);
    },
    reset: () => {
      calls.push('counter.reset');
      return Promise.resolve(doubles.counterState);
    },
    addTime: (seconds: number, reason: string) => {
      calls.push(`counter.addTime:${String(seconds)}:${reason}`);
      return Promise.resolve(doubles.counterState);
    },
    removeTime: (seconds: number, reason: string) => {
      calls.push(`counter.removeTime:${String(seconds)}:${reason}`);
      return Promise.resolve(doubles.counterState);
    },
    setInitialSeconds: (seconds: number) => {
      calls.push(`counter.setInitialSeconds:${String(seconds)}`);
      return Promise.resolve(doubles.counterState);
    },
    applyEvent: (): Promise<CounterEventOutcome> =>
      Promise.resolve({
        reward: { seconds: 180, applied: true, reason: 'test' },
        state: doubles.counterState,
      }),
  };

  const history: EventHistoryService = {
    record: () => Promise.resolve(),
    list: (limit: number) => {
      calls.push(`history.list:${String(limit)}`);
      return Promise.resolve(doubles.historyEntries.slice(0, limit));
    },
    purge: () => Promise.resolve(0),
  };

  const twitch: TwitchApiPort = {
    getStatus: () => doubles.twitchStatus,
    describe: () => {
      if (doubles.failTwitch) {
        return Promise.reject(new Error('Twitch injoignable'));
      }
      return Promise.resolve({
        broadcasterLogin: doubles.config.twitch.broadcasterLogin,
        clientId: doubles.config.twitch.clientId,
        hasClientSecret: doubles.clientSecret !== null,
        connected: true,
        scopes: ['channel:read:subscriptions'],
        missingScopes: [],
      });
    },
    startAuthorization: () => {
      calls.push('twitch.startAuthorization');
      return Promise.resolve({
        authorizationUrl: 'https://id.twitch.tv/oauth2/authorize?client_id=abc&state=xyz',
      });
    },
    revoke: () => {
      calls.push('twitch.revoke');
      return Promise.resolve();
    },
    listSubscriptions: () => {
      calls.push('twitch.listSubscriptions');
      return Promise.resolve([{ id: 'sub-1', type: 'channel.subscribe', status: 'enabled' }]);
    },
    setClientSecret: (secret: string) => {
      calls.push('twitch.setClientSecret');
      doubles.clientSecret = secret;
      return Promise.resolve();
    },
  };

  const update: UpdateApiPort = {
    getStatus: () => doubles.updateStatus,
    check: () => {
      calls.push('update.check');
      return Promise.resolve(doubles.updateStatus);
    },
    install: () => {
      calls.push('update.install');
      if (doubles.updateStatus.phase !== 'ready') {
        return Promise.reject(new Error('Aucune mise à jour vérifiée n’est prête à être installée.'));
      }
      return Promise.resolve();
    },
  };

  const context: ApiContext = {
    config: configService,
    counter: counterService,
    history,
    logs: ringBuffer,
    twitch,
    update,
    getPort: () => 3_777,
    appVersion: '0.1.0',
    applyManualEvent: (event: DomainEvent) => {
      calls.push(`manual:${event.type}`);
      return Promise.resolve({
        reward: { seconds: 180, applied: true, reason: 'test manuel' },
        state: doubles.counterState,
      });
    },
    logger: createLogger({ level: 'error', sinks: [SILENT_SINK] }),
  };

  // `Object.assign` et non un objet neuf : les doubles ci-dessus lisent
  // `doubles.config` et `doubles.counterState` par référence. Recopier ces
  // champs figerait les valeurs vues par les fermetures, et un test qui modifie
  // la configuration n'aurait plus aucun effet.
  return Object.assign(doubles, { context, calls, ringBuffer });
}
