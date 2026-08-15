import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppEvents } from '../../../src/core/app/app-events.js';
import { createEventBus, type EventBus } from '../../../src/core/app/event-bus.js';
import type { Clock } from '../../../src/core/app/ports.js';
import { DEFAULT_CONFIG } from '../../../src/core/config/defaults.js';
import { configSchema, type ChronoCastConfig } from '../../../src/core/config/schema.js';
import { createCounterService } from '../../../src/core/counter/counter-service.js';
import type { CounterState } from '../../../src/core/counter/counter-state.js';
import type { GiftEvent, SubEvent } from '../../../src/core/events/domain-event.js';
import { createLogger, type LogRecord, type LogSink } from '../../../src/core/logging/logger.js';
import { StoreWriteError, type AtomicJsonStore } from '../../../src/core/storage/atomic-json-store.js';

const START_EPOCH = 1_754_000_000_000;

function createFakeClock(): Clock & { advance(ms: number): void } {
  let epoch = START_EPOCH;
  let monotonic = 0;

  return {
    now: () => epoch,
    monotonicMs: () => monotonic,
    advance(ms: number): void {
      epoch += ms;
      monotonic += ms;
    },
  };
}

function createFakeTicker() {
  let callback: (() => void) | undefined;
  let intervalMs = 0;

  return {
    ticker: {
      start(interval: number, onTick: () => void): void {
        intervalMs = interval;
        callback = onTick;
      },
      stop(): void {
        callback = undefined;
      },
    },
    get running(): boolean {
      return callback !== undefined;
    },
    get intervalMs(): number {
      return intervalMs;
    },
    fire(): void {
      callback?.();
    },
  };
}

function createStoreDouble(initial?: CounterState) {
  let persisted: CounterState | undefined = initial;
  let failNext: Error | undefined;
  const writes: CounterState[] = [];

  const store: AtomicJsonStore<CounterState | null> = {
    filePath: '/mémoire/counter.json',
    read: () => Promise.resolve(persisted ?? null),
    write: (value: CounterState | null) => {
      if (value === null) {
        return Promise.resolve();
      }
      if (failNext !== undefined) {
        const failure = failNext;
        failNext = undefined;
        return Promise.reject(failure);
      }
      persisted = value;
      writes.push(value);
      return Promise.resolve();
    },
  };

  return {
    store,
    writes,
    get persisted(): CounterState | undefined {
      return persisted;
    },
    failNextWrite(error: Error): void {
      failNext = error;
    },
  };
}

function createMemorySink(): LogSink & { readonly records: LogRecord[] } {
  const records: LogRecord[] = [];
  return {
    name: 'memory',
    records,
    write(record: LogRecord): void {
      records.push(record);
    },
  };
}

function subEvent(overrides: Partial<SubEvent> = {}): SubEvent {
  return {
    id: 'msg-1',
    type: 'sub',
    tier: 'tier1',
    occurredAt: START_EPOCH,
    userId: '42',
    userName: 'Spectateur',
    source: 'eventsub',
    ...overrides,
  };
}

describe('createCounterService', () => {
  let clock: ReturnType<typeof createFakeClock>;
  let ticker: ReturnType<typeof createFakeTicker>;
  let bus: EventBus<AppEvents>;
  let sink: ReturnType<typeof createMemorySink>;

  beforeEach(() => {
    clock = createFakeClock();
    ticker = createFakeTicker();
    bus = createEventBus<AppEvents>();
    sink = createMemorySink();
  });

  function createService(options: { config?: ChronoCastConfig; initial?: CounterState } = {}) {
    const double = createStoreDouble(options.initial);
    const config = options.config ?? DEFAULT_CONFIG;

    const service = createCounterService({
      store: double.store,
      getConfig: () => config,
      clock,
      ticker: ticker.ticker,
      bus,
      logger: createLogger({ level: 'debug', sinks: [sink] }),
    });

    return { service, double, config };
  }

  describe('démarrage', () => {
    it('part de la valeur initiale configurée quand rien n\'est persisté', async () => {
      const { service } = createService();

      await service.start();

      expect(service.getState().remainingMs).toBe(DEFAULT_CONFIG.counter.initialSeconds * 1_000);
      expect(service.getState().status).toBe('idle');
    });

    it('écrit l\'état de départ sur le disque dès le démarrage', async () => {
      const { service, double } = createService();

      await service.start();

      expect(double.writes).toHaveLength(1);
      expect(double.writes[0]?.remainingMs).toBe(DEFAULT_CONFIG.counter.initialSeconds * 1_000);
    });

    it('restaure exactement l\'état persisté', async () => {
      const persisted: CounterState = {
        remainingMs: 12_345,
        status: 'paused',
        initialMs: 43_200_000,
        totalAddedMs: 900,
        totalRemovedMs: 0,
        startedAt: START_EPOCH - 10_000,
        finishedAt: null,
        updatedAt: START_EPOCH - 1_000,
        schemaVersion: 1,
      };
      const { service } = createService({ initial: persisted });

      await service.start();

      expect(service.getState()).toEqual(persisted);
    });

    it('ne décompte jamais le temps passé application fermée', async () => {
      const persisted: CounterState = {
        remainingMs: 3_600_000,
        status: 'running',
        initialMs: 43_200_000,
        totalAddedMs: 0,
        totalRemovedMs: 0,
        startedAt: START_EPOCH - 86_400_000,
        finishedAt: null,
        updatedAt: START_EPOCH - 28_800_000,
        schemaVersion: 1,
      };
      const { service } = createService({ initial: persisted });

      await service.start();

      expect(service.getState().remainingMs).toBe(3_600_000);
    });

    it('démarre le cadenceur à la période configurée', async () => {
      const { service } = createService();

      await service.start();

      expect(ticker.running).toBe(true);
      expect(ticker.intervalMs).toBe(DEFAULT_CONFIG.counter.tickIntervalMs);
    });

    it('met en pause au démarrage lorsque la reprise automatique est désactivée', async () => {
      const config = configSchema.parse({ counter: { resumeOnStartup: false } });
      const persisted: CounterState = {
        remainingMs: 3_600_000,
        status: 'running',
        initialMs: 43_200_000,
        totalAddedMs: 0,
        totalRemovedMs: 0,
        startedAt: START_EPOCH,
        finishedAt: null,
        updatedAt: START_EPOCH,
        schemaVersion: 1,
      };
      const { service } = createService({ config, initial: persisted });

      await service.start();

      expect(service.getState().status).toBe('paused');
    });
  });

  describe('décompte', () => {
    it('retranche le temps réellement écoulé entre deux tops', async () => {
      const { service } = createService();
      await service.start();
      await service.resume();

      clock.advance(1_000);
      ticker.fire();

      expect(service.getState().remainingMs).toBe(
        DEFAULT_CONFIG.counter.initialSeconds * 1_000 - 1_000,
      );
    });

    it('ne décompte pas tant que le compteur est en pause', async () => {
      const { service } = createService();
      await service.start();

      clock.advance(5_000);
      ticker.fire();

      expect(service.getState().remainingMs).toBe(DEFAULT_CONFIG.counter.initialSeconds * 1_000);
    });

    it('n\'écrit pas sur le disque à chaque top', async () => {
      const { service, double } = createService();
      await service.start();
      await service.resume();
      const avant = double.writes.length;

      clock.advance(250);
      ticker.fire();
      clock.advance(250);
      ticker.fire();

      expect(double.writes.length).toBe(avant);
    });

    it('écrit périodiquement selon l\'intervalle configuré', async () => {
      const { service, double } = createService();
      await service.start();
      await service.resume();
      const avant = double.writes.length;

      clock.advance(DEFAULT_CONFIG.counter.persistIntervalMs + 1);
      ticker.fire();

      expect(double.writes.length).toBe(avant + 1);
    });

    it('diffuse un événement d\'achèvement une seule fois', async () => {
      const config = configSchema.parse({ counter: { initialSeconds: 1 } });
      const { service } = createService({ config });
      const finished = vi.fn();
      bus.on('counter:finished', finished);
      await service.start();
      await service.resume();

      clock.advance(5_000);
      ticker.fire();
      clock.advance(5_000);
      ticker.fire();

      expect(finished).toHaveBeenCalledTimes(1);
    });
  });

  describe('actions manuelles', () => {
    it('crédite du temps et le persiste immédiatement', async () => {
      const { service, double } = createService();
      await service.start();
      const avant = double.writes.length;

      await service.addTime(300, 'ajout manuel');

      expect(service.getState().remainingMs).toBe(
        DEFAULT_CONFIG.counter.initialSeconds * 1_000 + 300_000,
      );
      expect(double.writes.length).toBe(avant + 1);
    });

    it('retire du temps et le persiste immédiatement', async () => {
      const { service, double } = createService();
      await service.start();
      const avant = double.writes.length;

      await service.removeTime(300, 'retrait manuel');

      expect(service.getState().remainingMs).toBe(
        DEFAULT_CONFIG.counter.initialSeconds * 1_000 - 300_000,
      );
      expect(double.writes.length).toBe(avant + 1);
    });

    it('bascule en pause puis reprend', async () => {
      const { service } = createService();
      await service.start();

      await service.resume();
      expect(service.getState().status).toBe('running');

      await service.pause();
      expect(service.getState().status).toBe('paused');
    });

    it('réinitialise sur la valeur initiale', async () => {
      const { service } = createService();
      await service.start();
      await service.addTime(600, 'ajout');

      await service.reset();

      expect(service.getState().remainingMs).toBe(DEFAULT_CONFIG.counter.initialSeconds * 1_000);
      expect(service.getState().totalAddedMs).toBe(0);
    });

    it('change la valeur de départ', async () => {
      const { service } = createService();
      await service.start();

      await service.setInitialSeconds(3_600);

      expect(service.getState().initialMs).toBe(3_600_000);
    });

    it('n\'écrit ni ne diffuse lorsque l\'action est sans effet', async () => {
      const { service, double } = createService();
      await service.start();
      const changed = vi.fn();
      bus.on('counter:changed', changed);
      const avant = double.writes.length;

      await service.pause();

      expect(double.writes.length).toBe(avant);
      expect(changed).not.toHaveBeenCalled();
    });

    it('ne plafonne pas le temps crédité', async () => {
      const config = configSchema.parse({ counter: { initialSeconds: 100 } });
      const { service } = createService({ config });
      await service.start();

      await service.addTime(300_000, 'salve');

      expect(service.getState().remainingMs).toBe(300_100_000);
    });
  });

  describe('application des événements Twitch', () => {
    it('crédite le temps prévu par le barème', async () => {
      const { service } = createService();
      await service.start();

      await service.applyEvent(subEvent({ tier: 'tier2' }));

      expect(service.getState().remainingMs).toBe(
        DEFAULT_CONFIG.counter.initialSeconds * 1_000 + 240_000,
      );
    });

    it('persiste immédiatement, avant toute diffusion', async () => {
      const { service, double } = createService();
      await service.start();
      let persistedAtBroadcast: number | undefined;
      bus.on('counter:changed', () => {
        persistedAtBroadcast = double.persisted?.remainingMs;
      });

      await service.applyEvent(subEvent());

      expect(persistedAtBroadcast).toBe(service.getState().remainingMs);
    });

    it('diffuse le résultat de l\'application', async () => {
      const { service } = createService();
      await service.start();
      const applied = vi.fn();
      bus.on('counter:event-applied', applied);

      await service.applyEvent(subEvent());

      expect(applied).toHaveBeenCalledTimes(1);
      expect(applied.mock.calls[0]?.[0]).toMatchObject({
        reward: { seconds: 180, applied: true },
      });
    });

    it('ne touche pas au compteur lorsque le barème refuse', async () => {
      const { service } = createService();
      await service.start();
      const avant = service.getState().remainingMs;
      const gift: GiftEvent = {
        id: 'msg-2',
        type: 'gift',
        tier: 'tier1',
        total: 0,
        isAnonymous: false,
        occurredAt: START_EPOCH,
        userId: '43',
        userName: 'Donateur',
        source: 'eventsub',
      };

      const outcome = await service.applyEvent(gift);

      expect(outcome.reward.applied).toBe(false);
      expect(service.getState().remainingMs).toBe(avant);
    });

    it('crédite intégralement une salve massive d\'abonnements offerts', async () => {
      const { service } = createService();
      await service.start();
      const gift: GiftEvent = {
        id: 'msg-3',
        type: 'gift',
        tier: 'tier1',
        total: 1_000,
        isAnonymous: false,
        occurredAt: START_EPOCH,
        userId: '43',
        userName: 'Donateur',
        source: 'eventsub',
      };

      await service.applyEvent(gift);

      expect(service.getState().remainingMs).toBe(
        DEFAULT_CONFIG.counter.initialSeconds * 1_000 + 180_000_000,
      );
    });
  });

  describe('résilience de la persistance', () => {
    it('conserve le temps crédité même si le disque refuse l\'écriture', async () => {
      const { service, double } = createService();
      await service.start();
      double.failNextWrite(new StoreWriteError('/mémoire/counter.json', new Error('disque plein')));

      await service.addTime(300, 'ajout');

      expect(service.getState().remainingMs).toBe(
        DEFAULT_CONFIG.counter.initialSeconds * 1_000 + 300_000,
      );
    });

    it('journalise une erreur en cas d\'échec de persistance', async () => {
      const { service, double } = createService();
      await service.start();
      double.failNextWrite(new StoreWriteError('/mémoire/counter.json', new Error('disque plein')));

      await service.addTime(300, 'ajout');

      expect(sink.records.some((record) => record.level === 'error')).toBe(true);
    });

    it('signale l\'échec de persistance sur le bus', async () => {
      const { service, double } = createService();
      await service.start();
      const failures = vi.fn();
      bus.on('counter:persist-failed', failures);
      double.failNextWrite(new StoreWriteError('/mémoire/counter.json', new Error('disque plein')));

      await service.addTime(300, 'ajout');

      expect(failures).toHaveBeenCalledTimes(1);
    });
  });

  describe('arrêt', () => {
    it('arrête le cadenceur', async () => {
      const { service } = createService();
      await service.start();

      await service.stop();

      expect(ticker.running).toBe(false);
    });

    it('sauvegarde l\'état courant avant de rendre la main', async () => {
      const { service, double } = createService();
      await service.start();
      await service.resume();
      clock.advance(2_000);
      ticker.fire();

      await service.stop();

      expect(double.persisted?.remainingMs).toBe(service.getState().remainingMs);
    });
  });
});
