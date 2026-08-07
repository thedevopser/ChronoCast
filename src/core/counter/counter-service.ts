import type { AppEvents, CounterChangeOrigin } from '../app/app-events.js';
import type { EventBus } from '../app/event-bus.js';
import type { Clock } from '../app/ports.js';
import type { ChronoCastConfig } from '../config/schema.js';
import type { DomainEvent } from '../events/domain-event.js';
import type { Logger } from '../logging/logger.js';
import type { AtomicJsonStore } from '../storage/atomic-json-store.js';
import {
  applyAdd,
  applyPause,
  applyRemove,
  applyReset,
  applyResume,
  applySetInitial,
  applyTick,
  createInitialState,
  type CounterBounds,
  type CounterState,
} from './counter-state.js';
import { computeReward, type RewardComputation } from './reward-engine.js';

const ONE_HOUR_MS = 3_600_000;

export interface Ticker {
  start(intervalMs: number, onTick: () => void): void;
  stop(): void;
}

export interface CounterEventOutcome {
  readonly reward: RewardComputation;
  readonly state: CounterState;
}

export interface CounterService {
  start(): Promise<void>;

  stop(): Promise<void>;

  getState(): CounterState;

  pause(): Promise<CounterState>;
  resume(): Promise<CounterState>;
  reset(): Promise<CounterState>;

  addTime(seconds: number, reason: string): Promise<CounterState>;

  removeTime(seconds: number, reason: string): Promise<CounterState>;

  setInitialSeconds(seconds: number): Promise<CounterState>;

  applyEvent(event: DomainEvent): Promise<CounterEventOutcome>;
}

export interface CounterServiceOptions {
  readonly store: AtomicJsonStore<CounterState | null>;
  readonly getConfig: () => ChronoCastConfig;
  readonly clock: Clock;
  readonly ticker: Ticker;
  readonly bus: EventBus<AppEvents>;
  readonly logger: Logger;
}

export function createCounterService(options: CounterServiceOptions): CounterService {
  const { store, getConfig, clock, ticker, bus, logger } = options;

  let state: CounterState | undefined;

  let lastTickAt = 0;

  let lastPersistAt = 0;

  let rewardedFollows: number[] = [];

  function requireState(): CounterState {
    if (state === undefined) {
      throw new Error('service compteur non démarré : appelez start() en premier');
    }
    return state;
  }

  function currentBounds(): CounterBounds {
    const counter = getConfig().counter;
    return {
      minRemainingMs: counter.minRemainingSeconds * 1_000,
      maxRemainingMs: counter.maxRemainingSeconds * 1_000,
    };
  }

  async function persist(next: CounterState): Promise<void> {
    try {
      await store.write(next);
      lastPersistAt = clock.monotonicMs();
    } catch (error) {
      logger.error('état du compteur non sauvegardé', { cause: error });
      bus.emit('counter:persist-failed', { state: next, error });
    }
  }

  async function commit(
    next: CounterState,
    origin: CounterChangeOrigin,
    reason: string,
  ): Promise<CounterState> {
    const previous = requireState();
    if (next === previous) {
      return previous;
    }

    const wasFinished = previous.status === 'finished';
    state = next;

    await persist(next);

    bus.emit('counter:changed', {
      state: next,
      origin,
      deltaMs: next.remainingMs - previous.remainingMs,
      reason,
    });

    if (!wasFinished && next.status === 'finished') {
      bus.emit('counter:finished', { state: next });
    }

    return next;
  }

  function onTick(): void {
    const previous = state;
    if (previous === undefined) {
      return;
    }

    const monotonic = clock.monotonicMs();
    const elapsedMs = monotonic - lastTickAt;
    lastTickAt = monotonic;

    const next = applyTick(previous, {
      elapsedMs,
      bounds: currentBounds(),
      now: clock.now(),
    });

    if (next === previous) {
      return;
    }

    const wasFinished = previous.status === 'finished';
    state = next;

    bus.emit('counter:changed', {
      state: next,
      origin: 'tick',
      deltaMs: next.remainingMs - previous.remainingMs,
      reason: 'décompte',
    });

    if (!wasFinished && next.status === 'finished') {
      bus.emit('counter:finished', { state: next });
    }

    const shouldPersist =
      next.status === 'finished' ||
      monotonic - lastPersistAt >= getConfig().counter.persistIntervalMs;

    if (shouldPersist) {
      void persist(next);
    }
  }

  return {
    async start(): Promise<void> {
      const config = getConfig();
      const restored = await store.read();

      state =
        restored ??
        createInitialState({
          initialMs: config.counter.initialSeconds * 1_000,
          now: clock.now(),
        });

      if (!config.counter.resumeOnStartup && state.status === 'running') {
        state = applyPause(state, { now: clock.now() });
      }

      await persist(state);

      lastTickAt = clock.monotonicMs();
      lastPersistAt = clock.monotonicMs();
      rewardedFollows = [];

      ticker.start(config.counter.tickIntervalMs, onTick);

      logger.info('compteur démarré', {
        remainingMs: state.remainingMs,
        status: state.status,
      });
    },

    async stop(): Promise<void> {
      ticker.stop();
      if (state !== undefined) {
        await persist(state);
      }
      logger.info('compteur arrêté');
    },

    getState(): CounterState {
      return requireState();
    },

    async pause(): Promise<CounterState> {
      return commit(applyPause(requireState(), { now: clock.now() }), 'manual', 'pause');
    },

    async resume(): Promise<CounterState> {
      lastTickAt = clock.monotonicMs();
      return commit(applyResume(requireState(), { now: clock.now() }), 'manual', 'reprise');
    },

    async reset(): Promise<CounterState> {
      rewardedFollows = [];
      return commit(applyReset(requireState(), { now: clock.now() }), 'manual', 'réinitialisation');
    },

    async addTime(seconds: number, reason: string): Promise<CounterState> {
      return commit(
        applyAdd(requireState(), {
          deltaMs: Math.round(seconds * 1_000),
          bounds: currentBounds(),
          now: clock.now(),
        }),
        'manual',
        reason,
      );
    },

    async removeTime(seconds: number, reason: string): Promise<CounterState> {
      return commit(
        applyRemove(requireState(), {
          deltaMs: Math.round(seconds * 1_000),
          bounds: currentBounds(),
          now: clock.now(),
        }),
        'manual',
        reason,
      );
    },

    async setInitialSeconds(seconds: number): Promise<CounterState> {
      return commit(
        applySetInitial(requireState(), {
          initialMs: Math.round(seconds * 1_000),
          bounds: currentBounds(),
          now: clock.now(),
        }),
        'manual',
        'valeur de départ modifiée',
      );
    },

    async applyEvent(event: DomainEvent): Promise<CounterEventOutcome> {
      const config = getConfig();

      const threshold = clock.now() - ONE_HOUR_MS;
      rewardedFollows = rewardedFollows.filter((instant) => instant > threshold);

      const reward = computeReward(event, config.rewards, {
        followsInLastHour: rewardedFollows.length,
      });

      if (!reward.applied) {
        logger.debug('événement sans récompense', { type: event.type, reason: reward.reason });
        const unchanged = requireState();
        bus.emit('counter:event-applied', { event, reward, state: unchanged });
        return { reward, state: unchanged };
      }

      if (event.type === 'follow') {
        rewardedFollows.push(clock.now());
      }

      const next = await commit(
        applyAdd(requireState(), {
          deltaMs: reward.seconds * 1_000,
          bounds: currentBounds(),
          now: clock.now(),
        }),
        'twitch',
        reward.reason,
      );

      logger.info('événement appliqué', {
        type: event.type,
        seconds: reward.seconds,
        remainingMs: next.remainingMs,
      });

      bus.emit('counter:event-applied', { event, reward, state: next });
      return { reward, state: next };
    },
  };
}
