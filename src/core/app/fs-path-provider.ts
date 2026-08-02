/**
 * Implémentation du port {@link PathProvider} sur le système de fichiers.
 *
 * Elle vit ici, et non dans un point d'entrée, pour la même raison que
 * `system-clock.ts` et `system-ticker.ts` : elle a deux appelants. La coquille
 * Electron lui impose `app.getPath('userData')` — soit `%APPDATA%\ChronoCast`
 * sous Windows, seule cible de la V1 — et le point d'entrée headless la laisse
 * choisir sa racine, sous le répertoire personnel ou là où
 * `CHRONOCAST_DATA_DIR` la place. C'est ce que fait `docker/compose.yml`, qui
 * la met hors du volume projet pour qu'aucun test ne puisse écrire dans les
 * sources.
 *
 * Aucun chemin n'est jamais codé en dur ailleurs que dans ce fichier : c'est
 * précisément ce que le port garantit.
 */

import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PathProvider } from './ports.js';

/** Variable d'environnement surchargeant la racine des données. */
const DATA_DIRECTORY_VARIABLE = 'CHRONOCAST_DATA_DIR';

/** Variable d'environnement surchargeant la racine des ressources web. */
const WEB_ROOT_VARIABLE = 'CHRONOCAST_WEB_ROOT';

export interface FsPathProviderOptions {
  /** Racine explicite, prioritaire sur l'environnement. */
  readonly dataDirectory?: string;
  /**
   * Racine des ressources web servies.
   *
   * Distincte des données : le contenu servi est livré avec l'application, il
   * n'a rien à faire dans le répertoire modifiable de l'utilisateur.
   */
  readonly webRootDirectory: string;
}

/** Lit une variable d'environnement, en traitant la chaîne vide comme absente. */
function readEnvironment(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
}

/** Racine par défaut, selon l'environnement puis le répertoire personnel. */
function defaultDataDirectory(): string {
  return readEnvironment(DATA_DIRECTORY_VARIABLE) ?? join(homedir(), '.chronocast');
}

/**
 * Racine par défaut des ressources web, à côté du code compilé.
 *
 * Elle se mesure depuis l'URL du module **appelant**, qui doit être un point
 * d'entrée : `dist/headless/index.js` et `dist/main/main.js` sont chacun à un
 * niveau sous `dist/`, et donnent donc tous deux `dist/public`. La mesurer
 * depuis ce fichier-ci — enfoui dans `dist/core/app/` — donnerait un chemin
 * faux, et surtout un chemin qui se briserait à la première réorganisation de
 * `src/core`.
 *
 * Le chemin est relatif au module compilé, jamais au répertoire courant :
 * l'application doit démarrer de partout, y compris depuis un raccourci
 * Windows.
 *
 * @param entryModuleUrl `import.meta.url` du point d'entrée appelant.
 */
export function defaultWebRoot(entryModuleUrl: string): string {
  return (
    readEnvironment(WEB_ROOT_VARIABLE) ??
    resolve(dirname(fileURLToPath(entryModuleUrl)), '..', 'public')
  );
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
      // d'en sortir. Un segment contenant `..` — ou un segment absolu, qui
      // reprendrait la main sur la racine — est une erreur de programmation, et
      // il vaut mieux la voir tout de suite qu'écrire hors du répertoire.
      //
      // La comparaison passe par `relative` et non par un préfixe de chaîne :
      // `/tmp/racine-bis` commence par `/tmp/racine` sans en être un enfant.
      const difference = relative(dataDirectory, candidate);
      if (difference.startsWith('..') || isAbsolute(difference)) {
        throw new Error('chemin de données hors de la racine');
      }

      return candidate;
    },
  };
}
