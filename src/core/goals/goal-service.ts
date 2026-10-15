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
import { pointsGained } from './goal-progress.js';

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

  setSubs(count: number): Promise<GoalState>;

  addSubs(amount: number): Promise<GoalOutcome>;

  removeSubs(amount: number): Promise<GoalOutcome>;

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

  async function advance(previous: GoalState, gained: number): Promise<GoalOutcome> {
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

    return { snapshot: await commit(next, crossed), crossed };
  }

  // Aucun franchissement fabriqué : `reached` n'enregistre que ce qui a été vécu en direct.
  // Ceux qu'un compte abaissé laisse derrière lui s'en vont, faute de quoi il traînerait un
  // historique qui le contredit.
  function lowered(previous: GoalState, subs: number): GoalState {
    return {
      subs,
      reached: previous.reached.filter((entry) => entry.target <= subs),
      updatedAt: clock.now(),
      schemaVersion: GOAL_STATE_VERSION,
    };
  }

  function requireAmount(amount: number): void {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new RangeError(`montant d'ajustement invalide : ${String(amount)}`);
    }
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
      const gained = pointsGained(event, getConfig().goals);

      // Rien à écrire ni à annoncer : un événement qui ne rapporte aucun point ne doit pas
      // réveiller les pages ouvertes ni toucher au disque.
      if (gained <= 0) {
        return { snapshot: snapshotOf(previous), crossed: [] };
      }

      const outcome = await advance(previous, gained);

      logger.info('progression des objectifs', {
        type: event.type,
        gained,
        subs: outcome.snapshot.subs,
        crossed: outcome.crossed.length,
      });

      return outcome;
    },

    async setSubs(count: number): Promise<GoalState> {
      const next = lowered(requireState(), count);

      // Émis sans palier franchi : écrire quatre-vingts abonnements sur une échelle de douze
      // paliers ne doit pas jeter douze annonces à la suite sur la page des spectateurs.
      await commit(next, []);
      logger.info('compte des objectifs écrit', { subs: count });

      return next;
    },

    async addSubs(amount: number): Promise<GoalOutcome> {
      const previous = requireState();
      requireAmount(amount);

      const outcome = await advance(previous, amount);
      logger.info('ajout manuel aux objectifs', {
        amount,
        subs: outcome.snapshot.subs,
        crossed: outcome.crossed.length,
      });

      return outcome;
    },

    async removeSubs(amount: number): Promise<GoalOutcome> {
      const previous = requireState();
      requireAmount(amount);

      const snapshot = await commit(lowered(previous, Math.max(0, previous.subs - amount)), []);
      logger.info('retrait manuel des objectifs', { amount, subs: snapshot.subs });

      return { snapshot, crossed: [] };
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
