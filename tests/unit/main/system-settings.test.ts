import { describe, expect, it } from 'vitest';

import {
  createSystemSettingsOpener,
  STARTUP_SETTINGS_URI,
} from '../../../src/main/system-settings.js';

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
    expect(STARTUP_SETTINGS_URI).toBe('ms-settings:startupapps');
  });

  it('laisse remonter l’échec plutôt que de le taire', async () => {
    const opener = createSystemSettingsOpener({
      openExternal: () => Promise.reject(new Error('aucun gestionnaire pour ce schéma')),
    });

    await expect(opener.openStartupSettings()).rejects.toThrow('aucun gestionnaire');
  });
});
