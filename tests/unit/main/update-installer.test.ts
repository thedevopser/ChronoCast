import { describe, expect, it, vi } from 'vitest';

import { createLogger, type LogSink } from '../../../src/core/logging/logger.js';
import { createUpdateInstaller } from '../../../src/main/update-installer.js';

/**
 * Lancement de l'installeur téléchargé.
 *
 * C'est le seul geste de la mise à jour que le noyau ne peut pas faire, et il
 * est irréductible : NSIS ne peut pas écraser un exécutable en cours
 * d'exécution, l'application doit donc sortir juste après avoir lancé
 * l'installeur.
 *
 * Le module est écrit avec `spawn` et `quit` injectés pour la même raison que
 * `browser-opener.ts` et `safe-storage-secret-store.ts` : la coquille Electron
 * n'est pas exécutable dans le conteneur, et tout ce qui décide doit en sortir.
 * Ce qui reste dans `main.ts` est le câblage de `node:child_process.spawn` et
 * d'`app.quit`, qui ne décide de rien.
 */

const SILENT: LogSink = { name: 'silencieux', write: () => undefined };

function createHarness() {
  const child = { unref: vi.fn() };
  const spawn = vi.fn(() => child);
  const quit = vi.fn();

  return {
    child,
    spawn,
    quit,
    installer: createUpdateInstaller({
      spawn,
      quit,
      logger: createLogger({ level: 'debug', sinks: [SILENT] }),
    }),
  };
}

describe('createUpdateInstaller', () => {
  const PATH = 'C:\\Users\\moi\\AppData\\Roaming\\ChronoCast\\updates\\ChronoCast-Setup-0.5.1.exe';

  it('lance l’installeur puis quitte, dans cet ordre', async () => {
    // L'ordre inverse tuerait le processus avant qu'il n'ait lancé quoi que ce
    // soit : l'utilisateur verrait l'application se fermer et rien d'autre.
    const h = createHarness();

    await h.installer.run(PATH);

    expect(h.spawn).toHaveBeenCalledWith(PATH, [], expect.objectContaining({ detached: true }));
    expect(h.spawn.mock.invocationCallOrder[0]).toBeLessThan(h.quit.mock.invocationCallOrder[0] ?? Infinity);
    expect(h.quit).toHaveBeenCalledTimes(1);
  });

  it('détache le processus et le libère', async () => {
    // Sans `detached` et `unref`, l'installeur serait rattaché au processus qui
    // s'apprête à mourir : Windows le tuerait avec son parent, et la mise à
    // jour n'aurait jamais lieu.
    const h = createHarness();

    await h.installer.run(PATH);

    expect(h.spawn).toHaveBeenCalledWith(
      PATH,
      [],
      expect.objectContaining({ detached: true, stdio: 'ignore' }),
    );
    expect(h.child.unref).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['un chemin relatif', 'updates\\ChronoCast-Setup-0.5.1.exe'],
    ['un chemin vide', ''],
    ['un fichier qui n’est pas un exécutable', 'C:\\Users\\moi\\updates\\notes.txt'],
    ['un script', 'C:\\Users\\moi\\updates\\install.bat'],
  ])('refuse %s sans rien lancer ni quitter', async (_libelle, chemin) => {
    // Le service ne compose ce chemin que depuis un nom d'asset déjà validé,
    // mais c'est ici qu'on exécute : le contrôle appartient au point où le
    // pouvoir est réel, pas à celui qui le transmet.
    const h = createHarness();

    await expect(h.installer.run(chemin)).rejects.toThrow();

    expect(h.spawn).not.toHaveBeenCalled();
    expect(h.quit).not.toHaveBeenCalled();
  });

  it('accepte un chemin POSIX absolu', async () => {
    // Le conteneur n'est pas la cible, mais le module doit rester exécutable
    // ailleurs que sous Windows pour que ce test veuille dire quelque chose.
    const h = createHarness();

    await h.installer.run('/home/moi/.config/ChronoCast/updates/ChronoCast-Setup-0.5.1.exe');

    expect(h.spawn).toHaveBeenCalledTimes(1);
  });

  it('ne quitte pas si le lancement échoue', async () => {
    // Quitter après un lancement raté, c'est fermer l'application de
    // l'utilisateur sans rien installer — c'est-à-dire arrêter son subathon
    // pour rien.
    const h = createHarness();
    h.spawn.mockImplementation(() => {
      throw new Error('accès refusé');
    });

    await expect(h.installer.run(PATH)).rejects.toThrow('accès refusé');

    expect(h.quit).not.toHaveBeenCalled();
  });
});
