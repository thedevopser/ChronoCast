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
import { normalizeLadder, positionAt } from '../../src/core/goals/goal-ladder.js';
import type { GoalService, GoalSnapshot, GoalState } from '../../src/core/goals/goal-service.js';
import type { GoalTier } from '../../src/core/config/schema.js';
import {
  createRingBufferSink,
  type RingBufferSink,
} from '../../src/core/logging/sinks/ring-buffer-sink.js';
import { createLogger, type LogSink } from '../../src/core/logging/logger.js';
import { createHappyHourSchedule } from '../../src/core/happy-hour/happy-hour-schedule.js';
import type { WindowState } from '../../src/core/schedule/one-shot-window.js';
import { createUpdateNotice, type UpdateNoticeState } from '../../src/core/update/update-notice.js';
import type { ApiContext, TwitchApiPort } from '../../src/core/server/routes/api.js';

const SILENT_SINK: LogSink = { name: 'silencieux', write: () => undefined };

/** L'instant figé de l'horloge des doublures : les plages se posent par rapport à lui. */
export const API_NOW = 1_700_000_000_000;

export interface ApiDoubles {
  context: ApiContext;
  calls: string[];
  ringBuffer: RingBufferSink;
  config: ChronoCastConfig;
  counterState: CounterState;
  historyEntries: HistoryEntry[];
  twitchStatus: TwitchStatusPayload;
  clientSecret: string | null;
  failTwitch: boolean;
  goalSubs: number;

  /** Le palier dont l'aperçu a été diffusé, ou `null` si la route ne l'a pas fait. */
  previewed: GoalTier | null;

  leaveUpdateNotice(notice: UpdateNoticeState): Promise<void>;
}

export function createApiDoubles(): ApiDoubles {
  const calls: string[] = [];
  const ringBuffer = createRingBufferSink(50);

  const doubles = {
    calls,
    config: configSchema.parse({
      ...DEFAULT_CONFIG,
      goals: {
        tiers: [
          { target: 5, label: 'Je me rase la tête' },
          { target: 10, label: 'Karaoké' },
        ],
      },
    }),
    counterState: createInitialState({ initialMs: 43_200_000, now: 1_700_000_000_000 }),
    historyEntries: [] as HistoryEntry[],
    twitchStatus: { status: 'ready' } as TwitchStatusPayload,
    clientSecret: null as string | null,
    failTwitch: false,
    goalSubs: 7,
    previewed: null as GoalTier | null,
  };

  const configService: ConfigService = {
    load: () => Promise.resolve(doubles.config),
    get: () => doubles.config,
    update: (patch: DeepPartial<ChronoCastConfig>) => {
      calls.push('config.update');
      // Fusion sur deux niveaux, assez pour qu'un correctif d'un sous-arbre n'efface pas ses voisins.
      const merged: Record<string, unknown> = { ...doubles.config };
      for (const [key, value] of Object.entries(patch)) {
        const current = merged[key];
        merged[key] =
          typeof value === 'object' && value !== null && typeof current === 'object' && current !== null
            ? { ...current, ...value }
            : value;
      }
      doubles.config = configSchema.parse(merged);
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

  function goalState(): GoalState {
    return {
      subs: doubles.goalSubs,
      reached: [],
      updatedAt: 1_700_000_000_000,
      schemaVersion: 1,
    };
  }

  function goalSnapshot(): GoalSnapshot {
    const tiers = normalizeLadder(doubles.config.goals.tiers);
    return {
      subs: doubles.goalSubs,
      reached: [],
      position: positionAt(doubles.goalSubs, tiers),
      tiers,
    };
  }

  const goals: GoalService = {
    start: () => Promise.resolve(),
    getState: () => goalState(),
    getSnapshot: () => goalSnapshot(),
    applyEvent: () => Promise.resolve({ snapshot: goalSnapshot(), crossed: [] }),
    setSubs: (count: number) => {
      calls.push(`goals.setSubs:${String(count)}`);
      doubles.goalSubs = count;
      return Promise.resolve(goalState());
    },
    addSubs: (amount: number) => {
      calls.push(`goals.addSubs:${String(amount)}`);
      doubles.goalSubs += amount;
      return Promise.resolve({ snapshot: goalSnapshot(), crossed: [] });
    },
    removeSubs: (amount: number) => {
      calls.push(`goals.removeSubs:${String(amount)}`);
      doubles.goalSubs = Math.max(0, doubles.goalSubs - amount);
      return Promise.resolve({ snapshot: goalSnapshot(), crossed: [] });
    },
    reset: () => {
      calls.push('goals.reset');
      doubles.goalSubs = 0;
      return Promise.resolve(goalState());
    },
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

  let scheduleState: WindowState | null = null;
  const logger = createLogger({ level: 'error', sinks: [SILENT_SINK] });

  const happyHourSchedule = createHappyHourSchedule({
    store: {
      filePath: '/mémoire/happy-hour-schedule.json',
      read: () => Promise.resolve(scheduleState),
      write: (value) => {
        scheduleState = value;
        return Promise.resolve();
      },
    },
    clock: { now: () => API_NOW, monotonicMs: () => 0 },
    isActive: () => doubles.config.rewards.happyHour,
    setActive: (active) => {
      calls.push(`happyHour.setActive:${String(active)}`);
      doubles.config = configSchema.parse({
        ...doubles.config,
        rewards: { ...doubles.config.rewards, happyHour: active },
      });
      return Promise.resolve();
    },
    onChange: () => {
      calls.push('happyHour.scheduleChanged');
    },
    logger,
  });

  let noticeState: UpdateNoticeState | null = null;
  const updateNotice = createUpdateNotice({
    store: {
      filePath: '/mémoire/update-notice.json',
      read: () => Promise.resolve(noticeState),
      write: (value) => {
        noticeState = value;
        return Promise.resolve();
      },
    },
    logger,
  });

  const context: ApiContext = {
    config: configService,
    counter: counterService,
    goals,
    happyHourSchedule,
    updateNotice,
    history,
    logs: ringBuffer,
    twitch,
    system: {
      openStartupSettings: () => {
        calls.push('system.openStartupSettings');
        return Promise.resolve();
      },
    },
    previewGoal: (tier: GoalTier) => {
      calls.push('goals.preview');
      doubles.previewed = tier;
    },
    getPort: () => 3_777,
    appVersion: '0.1.0',
    applyManualEvent: (event: DomainEvent) => {
      calls.push(`manual:${event.type}`);
      return Promise.resolve({
        reward: { seconds: 180, applied: true, reason: 'test manuel' },
        state: doubles.counterState,
      });
    },
    logger,
  };

  return Object.assign(doubles, {
    context,
    calls,
    ringBuffer,
    /** Pose l'annonce qu'une 1.4.0 aurait laissée sur le disque, et la fait relire. */
    async leaveUpdateNotice(notice: UpdateNoticeState): Promise<void> {
      noticeState = notice;
      await updateNotice.start();
    },
  });
}
