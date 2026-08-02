/**
 * Icône de la zone de notification.
 *
 * C'est le poste de commande de ChronoCast quand la fenêtre est repliée, et
 * surtout le **seul** chemin par lequel on quitte l'application.
 *
 * Ce fichier importe `electron` et n'est donc pas exécutable dans le conteneur.
 * Il ne décide de rien : la composition du menu — ce qu'il propose, ce qui est
 * grisé, ce que dit le libellé d'état — vient de `tray-menu.ts`, qui est pur et
 * couvert par les tests.
 */

import { Menu, Tray, nativeImage } from 'electron';

import { buildTrayMenu, formatTrayDuration, type TrayCommandId, type TrayMenuState } from './tray-menu.js';

export interface AppTrayOptions {
  /** Chemin de l'icône, résolu par le point d'entrée. */
  readonly iconPath: string;

  /** État courant, relu à chaque reconstruction du menu. */
  getState(): TrayMenuState;

  /** Exécution d'une commande du menu. */
  onCommand(id: TrayCommandId): void;
}

export interface AppTray {
  /** Reconstruit le menu et l'infobulle depuis l'état courant. */
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
          // Désactivée : c'est un affichage, pas une commande. Windows la grise,
          // ce qui est exactement la lecture attendue.
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

    // L'infobulle porte le temps restant : c'est ce qu'on vient vérifier d'un
    // coup d'œil, sans ouvrir le menu.
    tray.setToolTip(`ChronoCast — ${formatTrayDuration(state.remainingMs)}`);
  }

  // Le double-clic est le geste attendu sous Windows pour rouvrir une
  // application repliée.
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
