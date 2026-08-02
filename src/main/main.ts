/**
 * Point d'entrée de l'application Windows.
 *
 * Il compose exactement la même application que `src/headless/index.ts`, avec
 * les mêmes briques Node — c'est `core/app/node-runtime.ts` qui les fournit aux
 * deux — et ne diffère que par les trois ports qui touchent réellement à la
 * plateforme : les chemins, qui pointent vers `%APPDATA%\ChronoCast` ; les
 * secrets, protégés par DPAPI via `safeStorage` ; et l'ouverture du navigateur,
 * confiée au système.
 *
 * Ce fichier importe `electron` : il n'est pas exécutable dans le conteneur, et
 * c'est pour cela qu'il ne contient aucune décision. Tout ce qui se décide —
 * quelle navigation aboutit, ce que propose le tray, comment se comporte le
 * magasin de secrets — vit dans des modules purs, testés.
 *
 * Trois pièges d'Electron sont traités ici, et méritent d'être connus avant
 * d'y toucher :
 *
 *   1. **Aucun `await` avant l'enregistrement des écouteurs de cycle de vie.**
 *      Le processus principal en ESM se charge de façon asynchrone : une
 *      attente placée trop tôt ferait manquer l'événement `ready`.
 *   2. **`app.setName` avant toute lecture de chemin.** `app.getPath('userData')`
 *      en dérive ; sans lui, les données atterriraient dans un répertoire qui
 *      changerait le jour où electron-builder posera `productName`. Un
 *      répertoire de données qui se déplace entre deux versions, c'est un
 *      compteur perdu.
 *   3. **`safeStorage` n'est utilisable qu'après `whenReady`.** Le magasin ne
 *      l'interroge donc jamais à la construction.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { app, clipboard, dialog, safeStorage, shell, Notification, type BrowserWindow } from 'electron';

import { createApplication, type Application } from '../core/app/application.js';
import { createFsPathProvider, defaultWebRoot } from '../core/app/fs-path-provider.js';
import { createNodeRuntime } from '../core/app/node-runtime.js';
import { createSystemClock } from '../core/app/system-clock.js';
import { createSystemTicker } from '../core/app/system-ticker.js';
import { createLogger } from '../core/logging/logger.js';
import { createConsoleSink } from '../core/logging/sinks/console-sink.js';
import { createExternalBrowserOpener } from './browser-opener.js';
import { createSafeStorageSecretStore } from './safe-storage-secret-store.js';
import { createAppTray, type AppTray } from './tray.js';
import { createMainWindow } from './windows.js';

/**
 * Nom du produit, posé avant tout le reste.
 *
 * Il détermine `%APPDATA%\ChronoCast`, et doit rester identique à celui
 * qu'electron-builder inscrira dans l'installeur.
 */
app.setName('ChronoCast');

/** Période de rafraîchissement du tray, en millisecondes. */
const TRAY_REFRESH_MS = 5_000;

/**
 * Chemin d'une icône livrée avec l'application.
 *
 * `dist/main/main.js` → racine du paquet → `assets/`. Le chemin reste valide à
 * l'intérieur de l'archive asar, à condition qu'`assets/` figure dans les
 * fichiers du paquet — c'est à la configuration d'electron-builder de le dire.
 */
function iconPath(name: string): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', name);
}

let application: Application | null = null;
let window: BrowserWindow | null = null;
let tray: AppTray | null = null;
let shuttingDown = false;

/** Ramène la fenêtre au premier plan, en la recréant si elle a été détruite. */
function showWindow(): void {
  if (window === null || window.isDestroyed()) {
    return;
  }

  if (!window.isVisible()) {
    window.show();
  }
  if (window.isMinimized()) {
    window.restore();
  }
  window.focus();
}

/**
 * Instance unique.
 *
 * Deux instances écriraient dans le même répertoire de données, chacune
 * persistant son propre compteur par-dessus celui de l'autre. La seconde rend
 * donc la main immédiatement, après avoir demandé à la première de se montrer :
 * c'est ce que l'utilisateur attend en relançant l'application.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);

  // Enregistré avant tout `await` : c'est la condition pour ne pas manquer
  // l'événement.
  app.on('window-all-closed', () => {
    // Volontairement vide. Fermer la fenêtre replie l'application vers le
    // tray ; le compteur continue de tourner, et seul le menu du tray termine.
  });

  app.on('before-quit', (event) => {
    if (shuttingDown) {
      return;
    }

    // L'arrêt propre est asynchrone — sockets, serveur, puis vidange des
    // journaux — alors que `before-quit` est synchrone. On l'annule, on arrête,
    // puis on sort pour de bon.
    event.preventDefault();
    shuttingDown = true;
    void shutdown();
  });

  app.whenReady().then(start, reportFatal);
}

function start(): void {
  const paths = createFsPathProvider({
    // `%APPDATA%\ChronoCast` sous Windows. C'est le seul endroit du code où
    // l'emplacement des données de l'utilisateur est décidé.
    dataDirectory: app.getPath('userData'),
    webRootDirectory: defaultWebRoot(import.meta.url),
  });

  const logger = createLogger({ level: 'info', sinks: [createConsoleSink()] });

  application = createApplication({
    paths,
    secrets: createSafeStorageSecretStore({
      directory: paths.dataDirectory,
      // `safeStorage` est prêt : nous sommes après `whenReady`.
      safeStorage,
      logger,
    }),
    clock: createSystemClock(),
    browser: createExternalBrowserOpener({ openExternal: (url) => shell.openExternal(url) }),
    ticker: createSystemTicker(),
    appVersion: app.getVersion(),
    ...createNodeRuntime(),
  });

  application.start().then(onStarted, reportFatal);
}

function onStarted(port: number): void {
  const current = application;
  if (current === null) {
    return;
  }

  const appOrigin = `http://127.0.0.1:${String(port)}`;
  const config = current.config.get();

  window = createMainWindow({
    appOrigin,
    startHidden: config.app.startMinimized,
    // Jamais dans une application packagée : les outils de développement y
    // donnent accès à la page d'administration et à tout ce qu'elle peut faire.
    devToolsEnabled: !app.isPackaged,
    // Le `.ico` porte sept tailles : Windows y prend celle qui convient à la
    // barre des tâches comme à l'alternateur de fenêtres.
    iconPath: iconPath('icon.ico'),
    hideOnClose: () => !shuttingDown,
    onFirstHide: () => {
      notifyStillRunning();
    },
  });

  tray = createAppTray({
    // Le PNG carré 32 × 32, et non le `.ico` : la zone de notification affiche
    // une image unique, à laquelle un fichier multi-tailles n'apporte rien.
    iconPath: iconPath('tray.png'),
    getState: () => {
      const state = current.counter.getState();
      return {
        status: state.status,
        remainingMs: state.remainingMs,
        overlayUrl: `${appOrigin}/overlay`,
      };
    },
    onCommand: (id) => {
      switch (id) {
        case 'show':
          showWindow();
          break;
        case 'copy-overlay-url':
          clipboard.writeText(`${appOrigin}/overlay`);
          break;
        case 'quit':
          app.quit();
          break;
      }
    },
  });

  // Rafraîchissement périodique plutôt qu'à chaque changement du compteur :
  // celui-ci change à chaque battement, et reconstruire le menu une fois par
  // seconde ne servirait qu'à fermer celui que l'utilisateur vient d'ouvrir.
  const refresh = setInterval(() => {
    tray?.refresh();
  }, TRAY_REFRESH_MS);
  refresh.unref();

  applyLaunchAtStartup(config.app.launchAtStartup);
  current.config.onChange((updated) => {
    applyLaunchAtStartup(updated.app.launchAtStartup);
  });
}

/**
 * Applique le lancement à l'ouverture de session.
 *
 * Relu avant d'écrire : `setLoginItemSettings` touche au registre, et le
 * réappliquer à chaque changement de configuration — c'est-à-dire à chaque
 * enregistrement depuis le panneau — écrirait pour rien.
 */
function applyLaunchAtStartup(enabled: boolean): void {
  if (app.getLoginItemSettings().openAtLogin === enabled) {
    return;
  }

  app.setLoginItemSettings({ openAtLogin: enabled });
}

/** Prévient, une seule fois, que fermer la fenêtre n'a rien arrêté. */
function notifyStillRunning(): void {
  if (!Notification.isSupported()) {
    return;
  }

  new Notification({
    title: 'ChronoCast continue en arrière-plan',
    body: 'Le compteur tourne toujours. Pour quitter, faites un clic droit sur l’icône près de l’horloge.',
  }).show();
}

/** Arrêt propre, puis sortie. */
async function shutdown(): Promise<void> {
  tray?.destroy();
  tray = null;

  try {
    await application?.stop();
  } catch (error) {
    console.error('arrêt incomplet :', error);
  }

  app.exit(0);
}

/**
 * Échec au démarrage.
 *
 * Dans une application packagée, il n'y a pas de console : sans cette boîte de
 * dialogue, un port occupé ou un répertoire non inscriptible se traduirait par
 * un lancement qui ne fait rien du tout, ce qui est le pire des retours.
 */
function reportFatal(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error('démarrage impossible :', error);

  dialog.showErrorBox(
    'ChronoCast n’a pas pu démarrer',
    `${message}\n\nVérifiez qu’aucune autre instance ne tourne et que le port configuré est libre.`,
  );

  app.exit(1);
}
