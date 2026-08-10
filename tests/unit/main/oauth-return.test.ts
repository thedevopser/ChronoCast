import { describe, expect, it } from 'vitest';

import { oauthReturnUrl } from '../../../src/main/oauth-return.js';

const APP_ORIGIN = 'http://127.0.0.1:37770';

function withScheme(scheme: string, rest: string): string {
  return `${scheme}:${rest}`;
}

describe('oauthReturnUrl', () => {
  it('recharge la page courante en y portant l’issue', () => {
    expect(
      oauthReturnUrl({
        appOrigin: APP_ORIGIN,
        currentUrl: `${APP_ORIGIN}/setup`,
        outcome: 'ok',
      }),
    ).toBe(`${APP_ORIGIN}/setup?oauth=ok`);
  });

  it('garde le panneau d’administration quand le flux en est parti', () => {
    expect(
      oauthReturnUrl({
        appOrigin: APP_ORIGIN,
        currentUrl: `${APP_ORIGIN}/admin`,
        outcome: 'ok',
      }),
    ).toBe(`${APP_ORIGIN}/admin?oauth=ok`);
  });

  it('transporte l’issue quelle qu’elle soit', () => {
    expect(
      oauthReturnUrl({ appOrigin: APP_ORIGIN, currentUrl: `${APP_ORIGIN}/setup`, outcome: 'denied' }),
    ).toBe(`${APP_ORIGIN}/setup?oauth=denied`);
    expect(
      oauthReturnUrl({ appOrigin: APP_ORIGIN, currentUrl: `${APP_ORIGIN}/setup`, outcome: 'failed' }),
    ).toBe(`${APP_ORIGIN}/setup?oauth=failed`);
  });

  it('remplace une chaîne de requête déjà présente', () => {
    expect(
      oauthReturnUrl({
        appOrigin: APP_ORIGIN,
        currentUrl: `${APP_ORIGIN}/setup?oauth=failed&autre=1`,
        outcome: 'ok',
      }),
    ).toBe(`${APP_ORIGIN}/setup?oauth=ok`);
  });

  it('abandonne le fragment', () => {
    expect(
      oauthReturnUrl({
        appOrigin: APP_ORIGIN,
        currentUrl: `${APP_ORIGIN}/setup#etape-3`,
        outcome: 'ok',
      }),
    ).toBe(`${APP_ORIGIN}/setup?oauth=ok`);
  });

  it('retombe sur l’assistant quand la fenêtre est ailleurs', () => {
    for (const elsewhere of ['', 'about:blank', 'https://id.twitch.tv/oauth2/authorize', 'http://127.0.0.1:9999/setup']) {
      expect(
        oauthReturnUrl({ appOrigin: APP_ORIGIN, currentUrl: elsewhere, outcome: 'ok' }),
      ).toBe(`${APP_ORIGIN}/setup?oauth=ok`);
    }
  });

  it('ne recharge que l’assistant ou le panneau, jamais autre chose', () => {
    const payloads = [
      `${APP_ORIGIN}//evil.example/setup`,
      `${APP_ORIGIN}/../../etc/passwd`,
      `${APP_ORIGIN}/overlay`,
      withScheme('javascript', 'alert(1)'),
      'file:///etc/passwd',
      withScheme('data', 'text/html,<script>alert(1)</script>'),
      `${APP_ORIGIN}@evil.example/setup`,
      'http://evil.example/admin',
    ];

    for (const payload of payloads) {
      expect(oauthReturnUrl({ appOrigin: APP_ORIGIN, currentUrl: payload, outcome: 'ok' })).toBe(
        `${APP_ORIGIN}/setup?oauth=ok`,
      );
    }
  });
});
