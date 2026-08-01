/**
 * Historique des événements Twitch.
 *
 * Il répond à une question que le streamer se pose forcément un jour : « d'où
 * viennent ces trois heures ? ». Chaque entrée conserve donc ce qui a été crédité
 * **et pourquoi** — y compris quand rien ne l'a été. Un gift sub écarté par le
 * plafond est précisément le cas qui intrigue, et l'omettre du journal
 * reviendrait à effacer la seule explication disponible.
 *
 * C'est un journal, jamais une base : on y ajoute, on ne modifie rien. Le format
 * JSONL et la rotation quotidienne, déjà portés par `JsonlStore`, rendent la
 * purge triviale et une coupure inoffensive.
 *
 * Une règle prime sur tout : **le compteur passe avant son journal**. Un disque
 * plein ne doit pas faire remonter d'exception jusqu'au service compteur, sous
 * peine d'interrompre le subathon pour une écriture d'agrément.
 */

import { z } from 'zod';

import type { CounterState } from '../counter/counter-state.js';
import type { RewardComputation } from '../counter/reward-engine.js';
import type { DomainEvent } from '../events/domain-event.js';
import type { Logger } from '../logging/logger.js';
import { createJsonlStore, type JsonlStore } from '../storage/jsonl-store.js';

/** Préfixe des fichiers : `events-2026-08-01.jsonl`. */
const BASE_NAME = 'events';

const historyEntrySchema = z
  .object({
    id: z.string(),
    type: z.enum(['sub', 'resub', 'gift', 'bits', 'raid', 'follow']),
    occurredAt: z.number(),
    recordedAt: z.number(),
    userId: z.string(),
    userName: z.string(),
    source: z.enum(['eventsub', 'chat-notification', 'manual']),
    /** Palier, nombre de bits, de spectateurs ou de dons, selon le type. */
    detail: z.union([z.string(), z.number()]).nullable(),
    rewardSeconds: z.number(),
    applied: z.boolean(),
    reason: z.string(),
    /** Temps restant juste après l'application : de quoi reconstituer une courbe. */
    remainingMsAfter: z.number(),
  })
  .strip();

export type HistoryEntry = z.infer<typeof historyEntrySchema>;

export interface EventHistoryService {
  /** Consigne un événement. Ne lève jamais : un échec d'écriture est journalisé. */
  record(event: DomainEvent, reward: RewardComputation, state: CounterState): Promise<void>;

  /** Entrées les plus récentes d'abord. */
  list(limit: number): Promise<HistoryEntry[]>;

  /** Supprime les journaux au-delà de la rétention. Renvoie le nombre de fichiers effacés. */
  purge(): Promise<number>;
}

export interface EventHistoryServiceOptions {
  readonly directory: string;
  readonly logger: Logger;
  readonly retentionDays: number;
  /** Source de date, injectée pour rendre les tests déterministes. */
  readonly now?: () => Date;
}

/**
 * Extrait le détail caractéristique d'un événement.
 *
 * Chaque type porte une information différente — palier, bits, spectateurs — et
 * l'aplatir en une seule colonne évite un schéma à six variantes pour un journal
 * qui sera surtout lu par un humain.
 */
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
        // Neutralisé délibérément : le subathon prime sur son journal. C'est le
        // même arbitrage que pour la persistance du compteur, pour la même
        // raison — l'incident est visible dans les logs, pas à l'écran.
        scoped.error('événement non consigné dans l’historique', {
          eventId: event.id,
          cause: error,
        });
      }
    },

    async list(limit: number): Promise<HistoryEntry[]> {
      // `tail` lit la fin du fichier, ce qui évite de charger des mois
      // d'historique pour n'en afficher que les cinquante dernières lignes.
      const entries = await store.tail(limit);
      return entries.reverse();
    },

    purge(): Promise<number> {
      return store.purge();
    },
  };
}
