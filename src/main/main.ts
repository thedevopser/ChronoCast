import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { app, clipboard, dialog, safeStorage, shell, Notification, type BrowserWindow } from 'electron';

import { createApplication, type Application } from '../core/app/application.js';
import { createFsPathProvider, defaultWebRoot } from '../core/app/fs-path-provider.js';
import { createNodeRuntime } from '../core/app/node-runtime.js';
import { createSystemClock } from '../core/app/system-clock.js';
import { createSystemTicker } from '../core/app/system-ticker.js';
import { createLogger } from '../core/logging/logger.js';
import { createConsoleSink } from '../core/logging/sinks/console-sink.js';
import type { OAuthOutcome } from '../core/server/oauth-callback.js';
import { createExternalBrowserOpener } from './browser-opener.js';
import { oauthReturnUrl } from './oauth-return.js';
import { createSafeStorageSecretStore } from './safe-storage-secret-store.js';
import { createSystemSettingsOpener } from './system-settings.js';
import { createAppTray, type AppTray } from './tray.js';
import { createMainWindow } from './windows.js';

app.setName('ChronoCast');

const TRAY_REFRESH_MS = 5_000;

function iconPath(name: string): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', name);
}

let application: Application | null = null;
let window: BrowserWindow | null = null;
let tray: AppTray | null = null;
let shuttingDown = false;

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

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);

  app.on('window-all-closed', () => {
    // Volontairement vide : fermer la fenêtre replie vers le tray.
  });

  app.on('before-quit', (event) => {
    if (shuttingDown) {
      return;
    }

    event.preventDefault();
    shuttingDown = true;
    void shutdown();
  });

  app.whenReady().then(start, reportFatal);
}

function start(): void {
  const paths = createFsPathProvider({
    dataDirectory: join(app.getPath('home'), 'ChronoCast'),
    webRootDirectory: defaultWebRoot(import.meta.url),
  });

  const logger = createLogger({ level: 'info', sinks: [createConsoleSink()] });

  application = createApplication({
    paths,
    legacyDataDirectory: app.getPath('userData'),
    secrets: createSafeStorageSecretStore({
      directory: paths.dataDirectory,
      safeStorage,
      logger,
    }),
    clock: createSystemClock(),
    browser: createExternalBrowserOpener({ openExternal: (url) => shell.openExternal(url) }),
    system: createSystemSettingsOpener({ openExternal: (url) => shell.openExternal(url) }),
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
    devToolsEnabled: !app.isPackaged,
    iconPath: iconPath('icon.ico'),
    hideOnClose: () => !shuttingDown,
    onFirstHide: () => {
      notifyStillRunning();
    },
  });

  tray = createAppTray({
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

  const refresh = setInterval(() => {
    tray?.refresh();
  }, TRAY_REFRESH_MS);
  refresh.unref();

  current.bus.on('oauth:settled', ({ outcome }) => {
    returnFromOAuth(appOrigin, outcome);
  });
}

function returnFromOAuth(appOrigin: string, outcome: OAuthOutcome): void {
  if (window === null || window.isDestroyed()) {
    return;
  }

  showWindow();

  void window
    .loadURL(oauthReturnUrl({ appOrigin, currentUrl: window.webContents.getURL(), outcome }))
    .catch((error: unknown) => {
      console.error('retour dans la fenêtre impossible :', error);
    });
}

function notifyStillRunning(): void {
  if (!Notification.isSupported()) {
    return;
  }

  new Notification({
    title: 'ChronoCast continue en arrière-plan',
    body: 'Le compteur tourne toujours. Pour quitter, faites un clic droit sur l’icône près de l’horloge.',
  }).show();
}

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

function reportFatal(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error('démarrage impossible :', error);

  dialog.showErrorBox(
    'ChronoCast n’a pas pu démarrer',
    `${message}\n\nVérifiez qu’aucune autre instance ne tourne et que le port configuré est libre.`,
  );

  app.exit(1);
}
