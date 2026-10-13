import { z } from 'zod';

import type { Clock } from '../app/ports.js';
import type { Logger } from '../logging/logger.js';
import {
  assertSchedulable,
  stepWindow,
  type OneShotWindow,
  type WindowState,
} from '../schedule/one-shot-window.js';
import type { AtomicJsonStore } from '../storage/atomic-json-store.js';

export interface HappyHourSchedule {
  start(): Promise<void>;

  get(): OneShotWindow | null;

  /** Pose la plage, en remplaçant la précédente. Lève `InvalidWindowError` si elle est invalide. */
  set(window: OneShotWindow): Promise<OneShotWindow>;

  cancel(): Promise<void>;

  /** À appeler à chaque battement du ticker : ne fait rien tant qu'aucune transition n'est due. */
  tick(): void;

  /** Résolue une fois les transitions en cours appliquées. */
  settled(): Promise<void>;
}

export interface HappyHourScheduleOptions {
  readonly store: AtomicJsonStore<WindowState | null>;
  readonly clock: Clock;
  readonly isActive: () => boolean;
  readonly setActive: (active: boolean) => Promise<void>;
  readonly onChange: (window: OneShotWindow | null) => void;
  readonly logger: Logger;
}

const stateSchema = z
  .object({
    window: z
      .object({
        startAt: z.number().int().nonnegative(),
        endAt: z.number().int().nonnegative(),
      })
      .strip(),
    started: z.boolean(),
  })
  .strip();

export function parseScheduleState(raw: unknown): WindowState | null {
  const parsed = stateSchema.safeParse(raw);

  return parsed.success && parsed.data.window.endAt > parsed.data.window.startAt
    ? parsed.data
    : null;
}

export function createHappyHourSchedule(options: HappyHourScheduleOptions): HappyHourSchedule {
  const { store, clock, isActive, setActive, onChange, logger } = options;

  let state: WindowState | null = null;

  // Poses, annulations et transitions passent par la même file : une transition en cours d'écriture
  // ne doit pas voir la plage changer sous elle.
  let queue: Promise<void> = Promise.resolve();

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation);
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async function persist(): Promise<void> {
    try {
      await store.write(state);
    } catch (error) {
      logger.error('plage du Happy Hour non sauvegardée', { cause: error });
    }
  }

  async function advance(): Promise<void> {
    if (state === null) {
      return;
    }

    const previous = state;
    const step = stepWindow(previous, clock.now());
    if (step.next === previous) {
      return;
    }

    state = step.next;

    // Le geste manuel garde la main : la plage ne bascule que ce qui n'est pas déjà dans l'état
    // voulu, et une extinction à la main pendant la plage rend donc la fin sans effet.
    for (const transition of step.transitions) {
      const wanted = transition === 'start';
      if (isActive() === wanted) {
        continue;
      }

      try {
        await setActive(wanted);
      } catch (error) {
        logger.error('bascule programmée du Happy Hour en échec', { cause: error });
      }
    }

    await persist();

    if (state === null) {
      logger.info('plage du Happy Hour terminée', { endAt: previous.window.endAt });
      onChange(null);
    }
  }

  return {
    async start(): Promise<void> {
      state = await store.read();
      await enqueue(advance);
    },

    get(): OneShotWindow | null {
      return state?.window ?? null;
    },

    set(window: OneShotWindow): Promise<OneShotWindow> {
      return enqueue(async () => {
        assertSchedulable(window, clock.now());

        const posted: OneShotWindow = { startAt: window.startAt, endAt: window.endAt };
        state = { window: posted, started: false };
        await persist();

        logger.info('plage du Happy Hour posée', { startAt: posted.startAt, endAt: posted.endAt });
        onChange(posted);

        await advance();
        return posted;
      });
    },

    cancel(): Promise<void> {
      return enqueue(async () => {
        if (state === null) {
          return;
        }

        state = null;
        await persist();

        logger.info('plage du Happy Hour annulée');
        onChange(null);
      });
    },

    tick(): void {
      if (state === null || stepWindow(state, clock.now()).next === state) {
        return;
      }

      void enqueue(advance).catch((error: unknown) => {
        logger.error('transition du Happy Hour en échec', { cause: error });
      });
    },

    settled(): Promise<void> {
      return queue;
    },
  };
}
