import type { AppEvents } from '../app/app-events.js';
import type { EventBus } from '../app/event-bus.js';
import type { Clock } from '../app/ports.js';
import type { ChronoCastConfig, GoalTier } from '../config/schema.js';
import type { DomainEvent } from '../events/domain-event.js';
import type { Logger } from '../logging/logger.js';
import type { AtomicJsonStore } from '../storage/atomic-json-store.js';
import {
  normalizeLadder,
  positionAt,
  tiersCrossed,
  type LadderPosition,
} from './goal-ladder.js';
import { subsGained } from './goal-progress.js';

export const GOAL_STATE_VERSION = 1;

export interface ReachedTier {
  readonly target: number;

  readonly reachedAt: number;
}

export interface GoalState {
  readonly subs: number;

  readonly reached: readonly ReachedTier[];

  readonly updatedAt: number;

  readonly schemaVersion: number;
}

export interface GoalSnapshot {
  readonly subs: number;
  readonly reached: readonly ReachedTier[];

  // Dérivée de l'échelle courante à chaque lecture, jamais persistée : changer l'échelle doit se
  // refléter aussitôt sans réécrire l'historique des franchissements.
  readonly position: LadderPosition;

  readonly tiers: readonly GoalTier[];
}

export interface GoalOutcome {
  readonly snapshot: GoalSnapshot;
  readonly crossed: readonly GoalTier[];
}

export interface GoalService {
  start(): Promise<void>;

  getState(): GoalState;

  getSnapshot(): GoalSnapshot;

  applyEvent(event: DomainEvent): Promise<GoalOutcome>;

  reset(): Promise<GoalState>;
}

export interface GoalServiceOptions {
  readonly store: AtomicJsonStore<GoalState | null>;
  readonly getConfig: () => ChronoCastConfig;
  readonly clock: Clock;
  readonly bus: EventBus<AppEvents>;
  readonly logger: Logger;
}

export function createGoalService(options: GoalServiceOptions): GoalService {
  const { store, getConfig, clock, bus, logger } = options;

  let state: GoalState | undefined;

  function requireState(): GoalState {
    if (state === undefined) {
      throw new Error('service des objectifs non démarré : appelez start() en premier');
    }
    return state;
  }

  function ladder(): readonly GoalTier[] {
    return normalizeLadder(getConfig().goals.tiers);
  }

  function snapshotOf(current: GoalState): GoalSnapshot {
    const tiers = ladder();
    return {
      subs: current.subs,
      reached: current.reached,
      position: positionAt(current.subs, tiers),
      tiers,
    };
  }

  async function persist(next: GoalState): Promise<void> {
    try {
      await store.write(next);
    } catch (error) {
      logger.error('progression des objectifs non sauvegardée', { cause: error });
    }
  }

  async function commit(next: GoalState, crossed: readonly GoalTier[]): Promise<GoalSnapshot> {
    state = next;
    await persist(next);

    const snapshot = snapshotOf(next);
    bus.emit('goals:changed', { snapshot, crossed });
    return snapshot;
  }

  function emptyState(): GoalState {
    return { subs: 0, reached: [], updatedAt: clock.now(), schemaVersion: GOAL_STATE_VERSION };
  }

  return {
    async start(): Promise<void> {
      state = (await store.read()) ?? emptyState();
      await persist(state);

      logger.info('objectifs démarrés', { subs: state.subs, reached: state.reached.length });
    },

    getState(): GoalState {
      return requireState();
    },

    getSnapshot(): GoalSnapshot {
      return snapshotOf(requireState());
    },

    async applyEvent(event: DomainEvent): Promise<GoalOutcome> {
      const previous = requireState();
      const gained = subsGained(event, getConfig().goals);

      // Rien à écrire ni à annoncer : un événement qui ne compte pour aucun abonnement ne doit pas
      // réveiller les pages ouvertes ni toucher au disque.
      if (gained <= 0) {
        return { snapshot: snapshotOf(previous), crossed: [] };
      }

      const subs = previous.subs + gained;
      const reachedAt = clock.now();
      const crossed = tiersCrossed(previous.subs, subs, ladder());

      const next: GoalState = {
        subs,
        reached: [
          ...previous.reached,
          ...crossed.map((tier) => ({ target: tier.target, reachedAt })),
        ],
        updatedAt: reachedAt,
        schemaVersion: GOAL_STATE_VERSION,
      };

      logger.info('progression des objectifs', {
        type: event.type,
        gained,
        subs,
        crossed: crossed.length,
      });

      return { snapshot: await commit(next, crossed), crossed };
    },

    async reset(): Promise<GoalState> {
      requireState();
      const next = emptyState();

      await commit(next, []);
      logger.info('progression des objectifs remise à zéro');

      return next;
    },
  };
}
