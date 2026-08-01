/**
 * Point d'entrée sans Electron.
 *
 * Il existe pour une raison précise : la chaîne d'outillage de ChronoCast tourne
 * dans un conteneur Linux alors que la cible est Windows. Sans ce point d'entrée,
 * la seule façon de voir l'application fonctionner serait de produire un `.exe` et
 * de le lancer sur un poste Windows — c'est-à-dire à la toute fin, quand il est
 * trop tard pour découvrir un problème d'assemblage.
 *
 * Avec lui, l'application complète — compteur, serveurs, pipeline Twitch — démarre
 * dans un Node nu, se teste bout en bout, et se pilote à la main pendant le
 * développement. C'est la contrepartie concrète de la règle « `src/core` n'importe
 * jamais `electron` ».
 *
 * Deux ports sont dégradés par rapport à la version Windows, et il faut le savoir :
 * le magasin de secrets, qui ne dispose d'aucun coffre-fort système, et l'ouverture
 * du navigateur, qui se contente d'afficher l'URL.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApplication, type Application } from '../core/app/application.js';
import type { BrowserOpener } from '../core/app/ports.js';
import { createSystemClock } from '../core/app/system-clock.js';
import { createSystemTicker } from '../core/app/system-ticker.js';
import { createLogger } from '../core/logging/logger.js';
import { createConsoleSink } from '../core/logging/sinks/console-sink.js';
import { createWebSocketFactory } from '../core/twitch/ws-socket-adapter.js';
import { createAesSecretStore } from './aes-secret-store.js';
import { createFsPathProvider } from './fs-path-provider.js';

/** Version affichée aux clients WebSocket. Alignée sur `package.json` au packaging. */
const APP_VERSION = '0.1.0';

/** Racine des ressources web, surchargeable pour servir une compilation en cours. */
const WEB_ROOT_VARIABLE = 'CHRONOCAST_WEB_ROOT';

/**
 * Ouverture de navigateur dégradée.
 *
 * Un conteneur n'a pas de navigateur. Afficher l'URL laisse l'utilisateur la
 * copier, ce qui suffit au développement. Le refus des schémas autres qu'`https`
 * est conservé : c'est une capacité sensible, et l'assouplir ici la rendrait
 * facile à assouplir ailleurs.
 */
function createConsoleBrowserOpener(): BrowserOpener {
  return {
    open(url: string): Promise<void> {
      if (!url.startsWith('https://')) {
        return Promise.reject(new Error('seules les URL https peuvent être ouvertes'));
      }
      console.log(`\nOuvrez cette adresse dans votre navigateur :\n${url}\n`);
      return Promise.resolve();
    },
  };
}

/** Racine par défaut des ressources web : `dist/public`, à côté du code compilé. */
function defaultWebRoot(): string {
  const fromEnvironment = process.env[WEB_ROOT_VARIABLE];
  if (fromEnvironment !== undefined && fromEnvironment !== '') {
    return fromEnvironment;
  }

  // `dist/headless/index.js` → `dist/public`. Le chemin est relatif au module
  // compilé, jamais au répertoire courant : l'application doit démarrer de
  // partout, y compris depuis un raccourci Windows.
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public');
}

export function buildHeadlessApplication(): Application {
  const paths = createFsPathProvider({ webRootDirectory: defaultWebRoot() });

  const logger = createLogger({ level: 'info', sinks: [createConsoleSink()] });

  return createApplication({
    paths,
    secrets: createAesSecretStore({ directory: paths.dataDirectory, logger }),
    clock: createSystemClock(),
    browser: createConsoleBrowserOpener(),
    ticker: createSystemTicker(),
    appVersion: APP_VERSION,
    hubTimers: {
      setInterval: (handler, ms) => {
        const timer = setInterval(handler, ms);
        // Sans `unref`, le battement de vivacité empêcherait le processus de se
        // terminer, et l'arrêt propre ne se terminerait jamais.
        timer.unref();
        return timer as unknown as number;
      },
      clearInterval: (id) => {
        clearInterval(id as unknown as NodeJS.Timeout);
      },
    },
    eventSubTimers: {
      setTimeout: (handler, ms) => {
        const timer = setTimeout(handler, ms);
        timer.unref();
        return timer as unknown as number;
      },
      clearTimeout: (id) => {
        clearTimeout(id as unknown as NodeJS.Timeout);
      },
    },
    createSocket: createWebSocketFactory(),
    fetch: globalThis.fetch.bind(globalThis),
    sleep: (ms) =>
      new Promise((done) => {
        setTimeout(done, ms).unref();
      }),
  });
}

/** Démarre l'application et installe l'arrêt propre sur signal. */
async function main(): Promise<void> {
  const application = buildHeadlessApplication();
  const port = await application.start();

  console.log(
    [
      '',
      'ChronoCast est démarré.',
      `  Panneau d'administration : http://127.0.0.1:${String(port)}/admin`,
      `  Overlay à coller dans OBS : http://127.0.0.1:${String(port)}/overlay`,
      '',
    ].join('\n'),
  );

  let stopping = false;

  const shutdown = (signal: string): void => {
    // Un second Ctrl+C ne doit pas relancer un arrêt déjà en cours : il
    // interromprait la vidange des journaux, c'est-à-dire exactement ce qu'on
    // cherche à préserver.
    if (stopping) {
      return;
    }
    stopping = true;

    console.log(`\nArrêt demandé (${signal})…`);

    application.stop().then(
      () => {
        process.exit(0);
      },
      (error: unknown) => {
          console.error('arrêt incomplet :', error);
        process.exit(1);
      },
    );
  };

  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
}

// Exécuté uniquement lorsque le module est le point d'entrée : l'importer depuis
// un test doit donner accès à `buildHeadlessApplication` sans rien démarrer.
if (process.argv[1] !== undefined && import.meta.url === `file://${resolve(process.argv[1])}`) {
  main().catch((error: unknown) => {
    console.error('démarrage impossible :', error);
    process.exit(1);
  });
}

/** Exporté pour que la coquille Electron partage la même racine par défaut. */
export { defaultWebRoot };
