/**
 * Implémentation du port {@link PathProvider} hors d'Electron.
 *
 * La racine vient de `CHRONOCAST_DATA_DIR` lorsqu'elle est définie — c'est ce que
 * fait `docker/compose.yml`, qui la place hors du volume projet pour qu'aucun test
 * ne puisse écrire dans les sources. À défaut, elle tombe sous le répertoire
 * personnel, comme n'importe quelle application en ligne de commande.
 *
 * La coquille Electron fournira l'équivalent pointant vers `%APPDATA%\ChronoCast`.
 * Aucun chemin n'est jamais codé en dur ailleurs que dans ces deux fichiers : c'est
 * précisément ce que le port garantit.
 */

import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';

import type { PathProvider } from '../core/app/ports.js';

/** Variable d'environnement surchargeant la racine des données. */
const DATA_DIRECTORY_VARIABLE = 'CHRONOCAST_DATA_DIR';

export interface FsPathProviderOptions {
  /** Racine explicite, prioritaire sur l'environnement. Surtout utile aux tests. */
  readonly dataDirectory?: string;
  /**
   * Racine des ressources web servies.
   *
   * Distincte des données : le contenu servi est livré avec l'application, il
   * n'a rien à faire dans le répertoire modifiable de l'utilisateur.
   */
  readonly webRootDirectory: string;
}

/** Racine par défaut, selon l'environnement puis le répertoire personnel. */
function defaultDataDirectory(): string {
  const fromEnvironment = process.env[DATA_DIRECTORY_VARIABLE];
  if (fromEnvironment !== undefined && fromEnvironment !== '') {
    return fromEnvironment;
  }
  return join(homedir(), '.chronocast');
}

export function createFsPathProvider(options: FsPathProviderOptions): PathProvider {
  const dataDirectory = resolve(options.dataDirectory ?? defaultDataDirectory());

  return {
    dataDirectory,
    logsDirectory: join(dataDirectory, 'logs'),
    historyDirectory: join(dataDirectory, 'history'),
    webRootDirectory: resolve(options.webRootDirectory),

    resolveDataFile(...segments: string[]): string {
      const candidate = resolve(join(dataDirectory, ...segments));

      // Le contrat du port l'exige : composer un chemin ne doit jamais permettre
      // d'en sortir. Un segment contenant `..` est une erreur de programmation,
      // et il vaut mieux la voir tout de suite qu'écrire hors du répertoire.
      const difference = relative(dataDirectory, candidate);
      if (difference.startsWith('..') || isAbsolute(difference)) {
        throw new Error('chemin de données hors de la racine');
      }

      return candidate;
    },
  };
}
