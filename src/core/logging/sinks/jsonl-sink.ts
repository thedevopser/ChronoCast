/**
 * Puits écrivant les enregistrements dans un journal JSONL.
 *
 * C'est la trace qui survit au redémarrage et que l'utilisateur transmettra en
 * cas de problème. Le rédacteur ayant déjà fait son office en amont, aucun secret
 * n'atteint ce module.
 *
 * L'écriture est **différée** : `LogSink.write` est synchrone, alors que
 * l'écriture disque ne l'est pas. Bloquer le fil d'exécution qui traite un
 * événement Twitch pour attendre un `write` système serait absurde ; les
 * enregistrements sont donc enchaînés dans une file, ce qui préserve leur ordre
 * tout en rendant la main immédiatement.
 */

import type { LogRecord, LogSink } from '../logger.js';

/** Sous-ensemble de `JsonlStore` réellement utilisé, pour un couplage minimal. */
export interface LogRecordAppender {
  append(record: LogRecord): Promise<void>;
}

export interface JsonlSinkOptions {
  readonly store: LogRecordAppender;

  /**
   * Notification d'échec d'écriture.
   *
   * Volontairement pas un log : journaliser l'échec de la journalisation
   * provoquerait une récursion.
   */
  readonly onError?: (error: unknown) => void;
}

export interface JsonlSink extends LogSink {
  /**
   * Attend la fin des écritures en attente.
   *
   * Indispensable à l'arrêt de l'application : sans cela, les derniers
   * enregistrements — souvent les plus intéressants après un incident —
   * seraient perdus.
   */
  flush(): Promise<void>;
}

export function createJsonlSink(options: JsonlSinkOptions): JsonlSink {
  const { store, onError } = options;

  /**
   * File d'attente des écritures.
   *
   * Le chaînage garantit l'ordre des lignes du journal, qui serait autrement
   * dicté par l'ordonnancement des entrées-sorties.
   */
  let queue: Promise<void> = Promise.resolve();

  return {
    name: 'jsonl',

    write(record: LogRecord): void {
      queue = queue.then(async () => {
        try {
          await store.append(record);
        } catch (error) {
          // Neutralisé ici : un rejet non traité ferait tomber le processus
          // Node, et une écriture manquée doit rester sans conséquence sur
          // l'application.
          onError?.(error);
        }
      });
    },

    async flush(): Promise<void> {
      await queue;
    },
  };
}
