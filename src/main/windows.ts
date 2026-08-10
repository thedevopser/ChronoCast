import { BrowserWindow, shell } from 'electron';

import { decideNavigation } from './navigation-policy.js';

export interface MainWindowOptions {
  readonly appOrigin: string;

  readonly startHidden: boolean;

  readonly devToolsEnabled: boolean;

  readonly iconPath: string;

  hideOnClose(): boolean;

  onFirstHide?: () => void;
}

function openExternally(url: string): void {
  void shell.openExternal(url).catch(() => undefined);
}

export function createMainWindow(options: MainWindowOptions): BrowserWindow {
  const window = new BrowserWindow({
    width: 1_180,
    height: 820,
    minWidth: 900,
    minHeight: 620,
    show: !options.startHidden,
    backgroundColor: '#14131a',
    title: 'ChronoCast',
    icon: options.iconPath,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: options.devToolsEnabled,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (decideNavigation(url, { appOrigin: options.appOrigin }) === 'external') {
      openExternally(url);
    }
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    const decision = decideNavigation(url, { appOrigin: options.appOrigin });
    if (decision === 'allow') {
      return;
    }

    event.preventDefault();
    if (decision === 'external') {
      openExternally(url);
    }
  });

  let hiddenOnce = false;

  window.on('close', (event) => {
    if (!options.hideOnClose()) {
      return;
    }

    event.preventDefault();
    window.hide();

    if (!hiddenOnce) {
      hiddenOnce = true;
      options.onFirstHide?.();
    }
  });

  void window.loadURL(`${options.appOrigin}/`);

  return window;
}
