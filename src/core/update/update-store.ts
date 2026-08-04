/**
 * Répertoire des mises à jour téléchargées.
 *
 * Un sous-dossier du répertoire de données — `%APPDATA%\ChronoCast\updates`
 * sous Windows — plutôt que `%TEMP%`. Trois raisons : `PathProvider` y mène
 * déjà, donc aucun port supplémentaire n'est nécessaire ; le ménage est le
 * nôtre, alors que `%TEMP%` est balayé par des politiques qu'on ne contrôle
 * pas ; et un installeur d'une centaine de mégaoctets a plus sa place à côté
 * des données de l'application que dans un dossier partagé.
 *
 * Le service n'écrit ici qu'**après** avoir vérifié le condensat : ce qui se
 * trouve dans ce répertoire a toujours été confronté à ce que GitHub a publié.
 */

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import type { UpdateFileStore } from './update-service.js';

/** Nom du sous-répertoire, relatif à la racine des données. */
export const UPDATES_DIRECTORY = 'updates';

/** Ce que ce module a besoin de connaître d'un `PathProvider`. */
export interface UpdatePaths {
  resolveDataFile(...segments: string[]): string;
}

export function createFsUpdateStore(paths: UpdatePaths): UpdateFileStore {
  const directory = paths.resolveDataFile(UPDATES_DIRECTORY);

  return {
    async clear(): Promise<void> {
      // `force` : le répertoire n'existe pas sur une installation neuve, et
      // `clear()` est appelé au démarrage. Lever ici ferait échouer le
      // lancement pour un dossier absent.
      await rm(directory, { recursive: true, force: true });
      await mkdir(directory, { recursive: true });
    },

    async save(name: string, bytes: Uint8Array): Promise<string> {
      const path = resolve(directory, name);

      // Le nom vient d'un asset de release, déjà confronté à celui qu'on
      // attend. Le contrôle est refait ici parce que c'est ici qu'on écrit :
      // un séparateur de chemin dans le nom ferait sortir l'écriture du
      // répertoire, et ce qu'on écrit est un exécutable.
      if (dirname(path) !== resolve(directory)) {
        throw new Error(`Nom de fichier de mise à jour refusé : ${name}`);
      }

      await mkdir(directory, { recursive: true });
      await writeFile(path, bytes);

      return path;
    },
  };
}
