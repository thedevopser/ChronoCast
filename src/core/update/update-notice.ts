import { z } from 'zod';

import type { Logger } from '../logging/logger.js';
import type { AtomicJsonStore } from '../storage/atomic-json-store.js';

/**
 * Ce qu'une mise à jour a changé sans que le streamer l'ait demandé, et qu'il n'a pas encore lu.
 *
 * Un état et non un réglage : il vit dans son propre fichier, ne s'exporte pas, et disparaît dès
 * qu'il est acquitté.
 */
export interface UpdateNoticeState {
  readonly goalsReset: {
    /** Le compte qu'avait la barre avant d'être remise à zéro, pour pouvoir la recaler. */
    readonly previousCount: number;
  };
}

export interface UpdateNotice {
  start(): Promise<void>;

  get(): UpdateNoticeState | null;

  announceGoalsReset(previousCount: number): Promise<void>;

  acknowledge(): Promise<void>;
}

export interface UpdateNoticeOptions {
  readonly store: AtomicJsonStore<UpdateNoticeState | null>;
  readonly logger: Logger;
}

const stateSchema = z
  .object({
    goalsReset: z.object({ previousCount: z.number().int().nonnegative() }).strip(),
  })
  .strip();

export function parseUpdateNotice(raw: unknown): UpdateNoticeState | null {
  const parsed = stateSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function createUpdateNotice(options: UpdateNoticeOptions): UpdateNotice {
  const { store, logger } = options;

  let state: UpdateNoticeState | null = null;

  async function persist(): Promise<void> {
    try {
      await store.write(state);
    } catch (error) {
      logger.error('annonce de mise à jour non sauvegardée', { cause: error });
    }
  }

  return {
    async start(): Promise<void> {
      state = await store.read();
    },

    get(): UpdateNoticeState | null {
      return state;
    },

    async announceGoalsReset(previousCount: number): Promise<void> {
      state = { goalsReset: { previousCount } };
      await persist();
    },

    async acknowledge(): Promise<void> {
      if (state === null) {
        return;
      }

      state = null;
      await persist();
      logger.info('annonce de mise à jour acquittée');
    },
  };
}
