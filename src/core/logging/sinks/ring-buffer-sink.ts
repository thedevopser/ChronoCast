/**
 * Puits conservant les derniers enregistrements en mémoire.
 *
 * C'est lui qui alimente la vue « Logs » du panneau d'administration : elle doit
 * s'afficher instantanément, sans relire ni décoder les fichiers du disque.
 *
 * La capacité est bornée par construction — un subathon de trente heures produit
 * beaucoup d'enregistrements, et une accumulation sans limite finirait par
 * peser sur la mémoire d'une application censée tourner en arrière-plan.
 */

import type { LogRecord, LogSink } from '../logger.js';

export interface RingBufferSink extends LogSink {
  /**
   * Copie des enregistrements conservés, du plus ancien au plus récent.
   *
   * @param limit Nombre maximal d'enregistrements renvoyés, les plus récents.
   */
  snapshot(limit?: number): LogRecord[];

  /** Vide le tampon. */
  clear(): void;
}

/**
 * @param capacity Nombre d'enregistrements conservés. Doit être strictement positif.
 * @throws RangeError si la capacité ne permet de rien conserver.
 */
export function createRingBufferSink(capacity: number): RingBufferSink {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new RangeError(`capacité invalide : ${String(capacity)} (entier positif attendu)`);
  }

  // Un simple tableau suffit : `shift` sur quelques milliers d'éléments reste
  // négligeable face à la fréquence réelle des logs, et le code reste lisible.
  let records: LogRecord[] = [];

  return {
    name: 'ring-buffer',

    write(record: LogRecord): void {
      records.push(record);
      if (records.length > capacity) {
        records.shift();
      }
    },

    snapshot(limit?: number): LogRecord[] {
      // Copie défensive : l'appelant ne doit pas pouvoir modifier le tampon en
      // manipulant le tableau qu'il reçoit.
      if (limit === undefined) {
        return [...records];
      }
      if (limit <= 0) {
        return [];
      }
      return records.slice(-limit);
    },

    clear(): void {
      records = [];
    },
  };
}
