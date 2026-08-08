import { z } from 'zod';

import type { CounterState } from '../counter/counter-state.js';
import type { RewardComputation } from '../counter/reward-engine.js';
import type { DomainEvent } from '../events/domain-event.js';
import type { Logger } from '../logging/logger.js';
import { createJsonlStore, type JsonlStore } from '../storage/jsonl-store.js';

const BASE_NAME = 'events';

const historyEntrySchema = z
  .object({
    id: z.string(),
    type: z.enum(['sub', 'resub', 'gift', 'bits', 'raid', 'follow', 'command']),
    occurredAt: z.number(),
    recordedAt: z.number(),
    userId: z.string(),
    userName: z.string(),
    source: z.enum(['eventsub', 'chat-notification', 'manual', 'chat-command']),
    detail: z.union([z.string(), z.number()]).nullable(),
    rewardSeconds: z.number(),
    applied: z.boolean(),
    reason: z.string(),
    remainingMsAfter: z.number(),
  })
  .strip();

export type HistoryEntry = z.infer<typeof historyEntrySchema>;

export interface EventHistoryService {
  record(event: DomainEvent, reward: RewardComputation, state: CounterState): Promise<void>;

  list(limit: number): Promise<HistoryEntry[]>;

  purge(): Promise<number>;
}

export interface EventHistoryServiceOptions {
  readonly directory: string;
  readonly logger: Logger;
  readonly retentionDays: number;
  readonly now?: () => Date;
}

function detailOf(event: DomainEvent): string | number | null {
  switch (event.type) {
    case 'sub':
    case 'resub':
      return event.tier;
    case 'gift':
      return event.total;
    case 'bits':
      return event.bits;
    case 'raid':
      return event.viewers;
    case 'follow':
      return null;
    case 'command':
      return event.command;
  }
}

export function createEventHistoryService(
  options: EventHistoryServiceOptions,
): EventHistoryService {
  const { directory, logger, retentionDays } = options;
  const scoped = logger.child('history');
  const now = options.now ?? (() => new Date());

  const store: JsonlStore<HistoryEntry> = createJsonlStore<HistoryEntry>({
    directory,
    baseName: BASE_NAME,
    parse: (raw) => historyEntrySchema.parse(raw),
    logger: scoped,
    retentionDays,
    now,
  });

  return {
    async record(
      event: DomainEvent,
      reward: RewardComputation,
      state: CounterState,
    ): Promise<void> {
      const entry: HistoryEntry = {
        id: event.id,
        type: event.type,
        occurredAt: event.occurredAt,
        recordedAt: now().getTime(),
        userId: event.userId,
        userName: event.userName,
        source: event.source,
        detail: detailOf(event),
        rewardSeconds: reward.seconds,
        applied: reward.applied,
        reason: reward.reason,
        remainingMsAfter: state.remainingMs,
      };

      try {
        await store.append(entry);
      } catch (error) {
        scoped.error('événement non consigné dans l’historique', {
          eventId: event.id,
          cause: error,
        });
      }
    },

    async list(limit: number): Promise<HistoryEntry[]> {
      const entries = await store.tail(limit);
      return entries.reverse();
    },

    purge(): Promise<number> {
      return store.purge();
    },
  };
}
