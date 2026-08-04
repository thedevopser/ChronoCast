/**
 * Lancement de l'installeur d'une mise à jour.
 *
 * Implémentation du port `UpdateInstaller`. Comme `browser-opener.ts` et
 * `safe-storage-secret-store.ts`, elle reçoit ses dépendances plateforme par
 * injection et n'importe donc pas `electron` : elle est intégralement testable
 * dans le conteneur, et seul son câblage — `node:child_process.spawn` et
 * `app.quit` — reste dans `main.ts`, où il ne décide de rien.
 *
 * Deux propriétés à ne pas défaire :
 *
 *   - **le processus est détaché, puis libéré.** Un enfant ordinaire meurt avec
 *     son parent : sans `detached` et `unref`, Windows tuerait l'installeur au
 *     moment même où l'application se ferme, et la mise à jour n'aurait jamais
 *     lieu ;
 *   - **on ne quitte qu'après avoir lancé.** Quitter d'abord fermerait
 *     l'application sans rien installer, c'est-à-dire arrêterait un subathon
 *     pour rien.
 */

import { win32 } from 'node:path';

import type { UpdateInstaller } from '../core/app/ports.js';
import type { Logger } from '../core/logging/logger.js';

/** Ce que ce module attend de `child_process.spawn`, et rien de plus. */
export type SpawnDetached = (
  command: string,
  args: readonly string[],
  options: { readonly detached: boolean; readonly stdio: 'ignore'; readonly windowsHide: boolean },
) => { unref(): void };

export interface UpdateInstallerOptions {
  readonly spawn: SpawnDetached;
  /** Arrêt de l'application. Sous Electron, `app.quit` — donc l'arrêt propre. */
  readonly quit: () => void;
  readonly logger: Logger;
}

export function createUpdateInstaller(options: UpdateInstallerOptions): UpdateInstaller {
  const logger = options.logger.child('update:installer');

  return {
    run(installerPath: string): Promise<void> {
      // Le chemin vient du service, qui ne le compose qu'à partir d'un nom
      // d'asset déjà validé. Le contrôle est refait ici parce que c'est ici
      // qu'on exécute : la garde appartient au point où le pouvoir est réel,
      // pas à celui qui le transmet.
      //
      // `win32.isAbsolute` et non `isAbsolute` : ce dernier suit la convention
      // de la plateforme **hôte**, si bien que `C:\...` y passe pour relatif
      // sous Linux. La suite tourne en conteneur alors que la cible est
      // Windows, et une garde qui ne dit pas la même chose des deux côtés ne
      // prouve rien. La variante `win32` reconnaît les deux conventions —
      // `/chemin` lui est absolu aussi — et se comporte donc identiquement où
      // qu'elle s'exécute. C'est la leçon de la Phase 7, appliquée d'avance.
      if (!win32.isAbsolute(installerPath) || !installerPath.toLowerCase().endsWith('.exe')) {
        return Promise.reject(new Error(`Chemin d’installeur refusé : ${installerPath}`));
      }

      try {
        const child = options.spawn(installerPath, [], {
          detached: true,
          stdio: 'ignore',
          windowsHide: false,
        });
        child.unref();
      } catch (error: unknown) {
        logger.error('lancement de l’installeur impossible', { error });
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }

      logger.info('installeur lancé, arrêt de l’application');
      options.quit();

      return Promise.resolve();
    },
  };
}
