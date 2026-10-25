import { describe, expect, it } from 'vitest';

import { decidePermission } from '../../src/main/permission-policy.js';

const APP_ORIGIN = 'http://127.0.0.1:3777';

const decide = (permission: string, requestingUrl: string): boolean =>
  decidePermission(permission, requestingUrl, { appOrigin: APP_ORIGIN });

describe('decidePermission', () => {
  it('laisse le panneau écrire dans le presse-papiers, pour les boutons « Copier »', () => {
    expect(decide('clipboard-sanitized-write', `${APP_ORIGIN}/admin`)).toBe(true);
  });

  it.each([
    'media',
    'notifications',
    'geolocation',
    'clipboard-read',
    'fullscreen',
    'openExternal',
    'display-capture',
    'hid',
    'serial',
    'usb',
  ])('refuse %s à l’origine locale', (permission) => {
    expect(decide(permission, `${APP_ORIGIN}/admin`)).toBe(false);
  });

  it.each([
    ['une autre origine', 'https://id.twitch.tv/oauth2/authorize'],
    ['un autre port de la boucle locale', 'http://127.0.0.1:37771/callback'],
    ['localhost au lieu de 127.0.0.1', 'http://localhost:3777/admin'],
    ['une adresse illisible', 'pas une adresse'],
    ['une adresse vide', ''],
  ])('refuse l’écriture du presse-papiers à %s', (_cas, url) => {
    expect(decide('clipboard-sanitized-write', url)).toBe(false);
  });
});
