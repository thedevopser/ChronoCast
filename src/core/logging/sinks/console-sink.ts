/**
 * Puits console.
 *
 * Sert au développement et aux diagnostics de démarrage, avant que les puits
 * fichier et mémoire ne soient branchés. En production, l'application tourne sans
 * terminal : ce puits n'y a alors aucun lecteur, mais son coût est nul.
 *
 * Les fonctions d'écriture sont injectables afin que le format soit vérifiable
 * par les tests sans capturer les flux du processus.
 */

import type { LogLevel, LogRecord, LogSink } from '../logger.js';

export interface ConsoleSinkOptions {
  /** Destination des enregistrements courants. Par défaut, la sortie standard. */
  readonly writeOut?: (line: string) => void;

  /** Destination des erreurs. Par défaut, la sortie d'erreur. */
  readonly writeError?: (line: string) => void;
}

/** Largeur du champ de niveau, pour que les portées restent alignées. */
const LEVEL_WIDTH = 7;

/** Niveaux dirigés vers la sortie d'erreur. */
const ERROR_LEVELS: ReadonlySet<LogLevel> = new Set<LogLevel>(['error']);

export function createConsoleSink(options: ConsoleSinkOptions = {}): LogSink {
  const writeOut =
    options.writeOut ??
    ((line: string): void => {
      process.stdout.write(line);
    });

  const writeError =
    options.writeError ??
    ((line: string): void => {
      process.stderr.write(line);
    });

  return {
    name: 'console',

    write(record: LogRecord): void {
      const level = record.level.toUpperCase().padEnd(LEVEL_WIDTH, ' ');
      const scope = record.scope === '' ? '' : `[${record.scope}] `;

      let suffix = '';
      if (record.context !== undefined) {
        try {
          suffix = ` ${JSON.stringify(record.context)}`;
        } catch {
          // Une structure non sérialisable ne doit pas faire disparaître le
          // message : le rédacteur neutralise déjà les cycles, ce filet ne couvre
          // que les cas résiduels comme un BigInt.
          suffix = ' [contexte non sérialisable]';
        }
      }

      const line = `${record.timestamp} ${level} ${scope}${record.message}${suffix}\n`;

      if (ERROR_LEVELS.has(record.level)) {
        writeError(line);
        return;
      }
      writeOut(line);
    },
  };
}
