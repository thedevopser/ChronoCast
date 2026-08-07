/**
 * Implémentation du port {@link SystemSettingsOpener} sur la coquille Windows.
 *
 * `shell.openExternal` est **injecté** plutôt qu'importé d'`electron`, comme
 * dans `browser-opener.ts` : c'est ce qui rend le module exécutable dans le
 * conteneur, donc réellement testé.
 *
 * Il existe parce que le lancement à l'ouverture de session a cessé d'être un
 * réglage de ChronoCast. Sous MSIX, `app.setLoginItemSettings` écrit dans
 * `HKCU\…\Run`, que le conteneur du paquet **virtualise** : la case aurait
 * coché, et rien n'aurait démarré au redémarrage suivant — sans erreur, sans
 * journal, sans le moindre indice. C'est le manifeste qui déclare désormais la
 * tâche (`assets/appx/extensions.xml`), et Windows qui en détient l'état.
 *
 * L'adresse est une **constante**, jamais un paramètre. Elle ne peut donc pas
 * venir du panneau — la route qui mène ici ne porte pas de charge utile — et ce
 * module n'est pas un `openExternal` déguisé.
 */

import type { SystemSettingsOpener } from '../core/app/ports.js';

/**
 * Page « Applications de démarrage » des paramètres de Windows.
 *
 * Elle mène directement à la liste où figure la tâche déclarée par le
 * manifeste. Ouvrir `ms-settings:` tout court laisserait l'utilisateur chercher
 * dans une arborescence entière ce que le panneau vient de lui promettre.
 */
export const STARTUP_SETTINGS_URI = 'ms-settings:startupapps';

export interface SystemSettingsOpenerOptions {
  /** `shell.openExternal` d'Electron, ou tout équivalent. */
  openExternal(url: string): Promise<void>;
}

export function createSystemSettingsOpener(
  options: SystemSettingsOpenerOptions,
): SystemSettingsOpener {
  return {
    openStartupSettings(): Promise<void> {
      // Aucun `catch` : le panneau affiche le refus dans son bandeau. Avaler
      // l'erreur ferait croire que les paramètres se sont ouverts derrière la
      // fenêtre, et l'utilisateur attendrait devant rien.
      return options.openExternal(STARTUP_SETTINGS_URI);
    },
  };
}
