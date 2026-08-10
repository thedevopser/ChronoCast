import { Menu, Tray, nativeImage } from 'electron';

import { buildTrayMenu, formatTrayDuration, type TrayCommandId, type TrayMenuState } from './tray-menu.js';

export interface AppTrayOptions {
  readonly iconPath: string;

  getState(): TrayMenuState;

  onCommand(id: TrayCommandId): void;
}

export interface AppTray {
  refresh(): void;
  destroy(): void;
}

export function createAppTray(options: AppTrayOptions): AppTray {
  const tray = new Tray(nativeImage.createFromPath(options.iconPath));

  function refresh(): void {
    const state = options.getState();

    const template = buildTrayMenu(state).map((item) => {
      switch (item.kind) {
        case 'separator':
          return { type: 'separator' as const };
        case 'status':
          return { label: item.label, enabled: false };
        case 'command':
          return {
            label: item.label,
            enabled: item.enabled,
            click: () => {
              options.onCommand(item.id);
            },
          };
      }
    });

    tray.setContextMenu(Menu.buildFromTemplate(template));

    tray.setToolTip(`ChronoCast — ${formatTrayDuration(state.remainingMs)}`);
  }

  tray.on('double-click', () => {
    options.onCommand('show');
  });

  refresh();

  return {
    refresh,
    destroy: () => {
      tray.destroy();
    },
  };
}
