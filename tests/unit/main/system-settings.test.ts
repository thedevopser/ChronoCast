import { describe, expect, it } from 'vitest';

import {
  createSystemSettingsOpener,
  STARTUP_SETTINGS_URI,
} from '../../../src/main/system-settings.js';

/**
 * Renvoi vers les paramètres de démarrage de Windows.
 *
 * Le lancement à l'ouverture de session a cessé d'être un réglage de
 * ChronoCast avec le passage au Microsoft Store : `setLoginItemSettings` écrit
 * dans `HKCU\…\Run`, que **MSIX virtualise**. La case aurait coché sans que
 * rien ne démarre au redémarrage suivant, et rien ne l'aurait dit — le pire
 * mode de défaillance qui soit. C'est désormais le manifeste du paquet qui
 * déclare la tâche, et Windows qui en détient l'état.
 *
 * Ce module est minuscule, et c'est exactement ce qu'on lui demande :
 * l'adresse est une **constante**, jamais un paramètre. Elle ne peut donc pas
 * venir du panneau, c'est-à-dire du réseau, fût-il local — ce qui reviendrait
 * à offrir l'ouverture de n'importe quel schéma, précisément ce que la garde
 * `https:` de `browser-opener.ts` refuse par ailleurs.
 */
describe('createSystemSettingsOpener', () => {
  it('ouvre la page « Démarrage » des paramètres de Windows', async () => {
    const opened: string[] = [];
    const opener = createSystemSettingsOpener({
      openExternal: (url) => {
        opened.push(url);
        return Promise.resolve();
      },
    });

    await opener.openStartupSettings();

    expect(opened).toStrictEqual([STARTUP_SETTINGS_URI]);
  });

  it('vise la page des applications de démarrage, et non la racine des paramètres', () => {
    // `ms-settings:startupapps` mène directement à la liste où figure la tâche
    // déclarée par le manifeste. Ouvrir `ms-settings:` tout court laisserait
    // l'utilisateur chercher dans une arborescence entière ce que la phrase du
    // panneau vient de lui promettre.
    expect(STARTUP_SETTINGS_URI).toBe('ms-settings:startupapps');
  });

  it('laisse remonter l’échec plutôt que de le taire', async () => {
    const opener = createSystemSettingsOpener({
      openExternal: () => Promise.reject(new Error('aucun gestionnaire pour ce schéma')),
    });

    // Le panneau affiche le refus dans son bandeau. Avaler l'erreur ferait
    // croire que les paramètres se sont ouverts derrière la fenêtre.
    await expect(opener.openStartupSettings()).rejects.toThrow('aucun gestionnaire');
  });
});
