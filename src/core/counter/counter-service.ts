/**
 * Service compteur : assemblage des réducteurs purs, de l'horloge, de la
 * persistance et de la diffusion.
 *
 * C'est ici que se tiennent les promesses visibles par l'utilisateur.
 *
 * **Mode gel.** Le temps écoulé application fermée n'est jamais décompté. Le
 * décompte ne progresse qu'au rythme des tops reçus pendant l'exécution, si bien
 * qu'un crash nocturne ne coûte rien au streamer.
 *
 * **Deux régimes de persistance.** Une mutation — événement Twitch, action
 * manuelle — est écrite sur le disque immédiatement, avant même d'être diffusée.
 * La simple érosion du temps qui passe, elle, est sauvegardée périodiquement : en
 * cas de crash on perd au pire cet intervalle, toujours en faveur du streamer,
 * alors qu'écrire à quatre hertz userait le disque sans bénéfice.
 *
 * **Le disque ne fait jamais tomber le subathon.** Un échec d'écriture est
 * journalisé et signalé sur le bus, mais l'état en mémoire reste appliqué : un
 * direct ne doit pas s'arrêter parce que le disque est saturé.
 *
 * **L'horloge monotone fait foi.** Le décompte mesure des durées avec
 * `monotonicMs`, jamais avec l'heure du système : un passage à l'heure d'hiver
 * offrirait autrement une heure de subathon.
 */

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

/** Durée de la fenêtre glissante du quota de follows. */
const ONE_HOUR_MS = 3_600_000;

/**
 * Cadenceur du décompte.
 *
 * Injecté plutôt qu'appelé directement : les tests pilotent ainsi le temps sans
 * jamais attendre une seconde réelle, et sans dépendre des minuteurs simulés de
 * l'outil de test.
 */
export interface Ticker {
  start(intervalMs: number, onTick: () => void): void;
  stop(): void;
}

/** Résultat de l'évaluation d'un événement Twitch. */
export interface CounterEventOutcome {
  readonly reward: RewardComputation;
  readonly state: CounterState;
}

export interface CounterService {
  /** Restaure l'état persisté et démarre le cadenceur. */
  start(): Promise<void>;

  /** Arrête le cadenceur après avoir sauvegardé l'état courant. */
  stop(): Promise<void>;

  /** État courant. Toujours défini une fois {@link start} appelé. */
  getState(): CounterState;

  pause(): Promise<CounterState>;
  resume(): Promise<CounterState>;
  reset(): Promise<CounterState>;

  /** Crédite du temps manuellement. */
  addTime(seconds: number, reason: string): Promise<CounterState>;

  /** Retire du temps manuellement. */
  removeTime(seconds: number, reason: string): Promise<CounterState>;

  /** Change la valeur de départ. */
  setInitialSeconds(seconds: number): Promise<CounterState>;

  /** Évalue un événement Twitch et applique le barème. */
  applyEvent(event: DomainEvent): Promise<CounterEventOutcome>;
}

export interface CounterServiceOptions {
  /**
   * Magasin de l'état.
   *
   * Le type nullable est délibéré : `null` signifie « rien n'a jamais été
   * persisté », cas où le service construit l'état de départ à partir de la
   * configuration. Sans cette distinction, le magasin devrait connaître la
   * valeur initiale du compteur, ce qui n'est pas sa responsabilité.
   */
  readonly store: AtomicJsonStore<CounterState | null>;
  /** Lu à chaque opération : une modification de configuration prend effet aussitôt. */
  readonly getConfig: () => ChronoCastConfig;
  readonly clock: Clock;
  readonly ticker: Ticker;
  readonly bus: EventBus<AppEvents>;
  readonly logger: Logger;
}

export function createCounterService(options: CounterServiceOptions): CounterService {
  const { store, getConfig, clock, ticker, bus, logger } = options;

  let state: CounterState | undefined;

  /** Repère du dernier top, sur l'horloge monotone. */
  let lastTickAt = 0;

  /** Instant de la dernière écriture de la décroissance naturelle. */
  let lastPersistAt = 0;

  /** Horodatages des follows récompensés, pour la fenêtre glissante. */
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

  /**
   * Écrit l'état sans jamais propager l'échec.
   *
   * Le compteur doit continuer de fonctionner même si la persistance échoue :
   * l'incident est journalisé et signalé, l'état en mémoire reste appliqué.
   */
  async function persist(next: CounterState): Promise<void> {
    try {
      await store.write(next);
      lastPersistAt = clock.monotonicMs();
    } catch (error) {
      logger.error('état du compteur non sauvegardé', { cause: error });
      bus.emit('counter:persist-failed', { state: next, error });
    }
  }

  /**
   * Adopte un nouvel état, le persiste et le diffuse.
   *
   * Sans effet si le réducteur a renvoyé l'état identique : les réducteurs
   * garantissent l'égalité de référence lorsqu'une action n'a rien changé, ce
   * qui évite une écriture disque et une diffusion WebSocket inutiles.
   */
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

    // Émis sur la transition uniquement : un compteur resté au plancher ne doit
    // pas déclencher l'animation de fin à chaque top.
    if (!wasFinished && next.status === 'finished') {
      bus.emit('counter:finished', { state: next });
    }

    return next;
  }

  /** Top du cadenceur : fait progresser le décompte. */
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

    // Sauvegarde périodique de l'érosion naturelle. L'atteinte du plancher, elle,
    // est écrite tout de suite : c'est un événement, pas une simple progression.
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

      // Le temps restant est repris tel quel : aucune soustraction du temps
      // passé hors ligne. C'est tout le mode gel.
      state =
        restored ??
        createInitialState({
          initialMs: config.counter.initialSeconds * 1_000,
          now: clock.now(),
        });

      if (!config.counter.resumeOnStartup && state.status === 'running') {
        state = applyPause(state, { now: clock.now() });
      }

      // L'état est écrit dès le démarrage, y compris sur une installation neuve.
      // Sans cela le fichier n'existerait qu'après la première mutation : le
      // répertoire de données ne décrirait pas l'application, et un crash
      // survenant dans les premières secondes effacerait la valeur de départ
      // que l'utilisateur venait de choisir.
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
      // Le repère monotone est réarmé : le temps passé en pause ne doit pas être
      // décompté d'un seul coup au premier top qui suit la reprise.
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

      // Fenêtre glissante du quota de follows : on purge avant d'évaluer, sinon
      // le quota resterait saturé indéfiniment après une salve.
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
