/**
 * Retour dans la fenêtre après le rappel OAuth.
 *
 * Le flux d'autorisation part dans le navigateur système et y revient : Twitch
 * ne connaît que la boucle locale, et la fenêtre de l'application ne voit rien
 * passer. Sans ce retour, elle reste indéfiniment à l'étape où l'utilisateur
 * l'a laissée, pendant que le navigateur affiche une page qui, elle, sait que
 * tout s'est bien passé.
 *
 * Ce module dit **quelle URL recharger**. Il est pur, donc testé ici, et c'est
 * `main/main.ts` qui l'applique — la coquille ne décide de rien.
 *
 * Deux exigences le gouvernent :
 *
 *   - **Rester où l'utilisateur était.** Le flux se déclenche depuis
 *     l'assistant comme depuis le panneau d'administration ; le ramener de
 *     force dans l'assistant le sortirait de la page qu'il avait ouverte.
 *   - **Ne jamais sortir de l'origine applicative.** Cette URL part dans
 *     `loadURL` : ce qu'on y met est ce que la fenêtre affichera.
 */

import { describe, expect, it } from 'vitest';

import { oauthReturnUrl } from '../../../src/main/oauth-return.js';

const APP_ORIGIN = 'http://127.0.0.1:37770';

/**
 * Compose une URL à partir de son schéma et du reste.
 *
 * `no-script-url` interdit le littéral `javascript:`, y compris dans les tests,
 * et la désactiver localement reviendrait à s'autoriser ce qu'on interdit
 * ailleurs. Même helper que dans `tests/security/navigation-policy.test.ts`.
 */
function withScheme(scheme: string, rest: string): string {
  return `${scheme}:${rest}`;
}

describe('oauthReturnUrl', () => {
  it('recharge la page courante en y portant l’issue', () => {
    // L'assistant lit `?oauth=` pour annoncer le résultat, puis dérive son
    // étape de l'état réel : il suffit de le recharger.
    expect(
      oauthReturnUrl({
        appOrigin: APP_ORIGIN,
        currentUrl: `${APP_ORIGIN}/setup`,
        outcome: 'ok',
      }),
    ).toBe(`${APP_ORIGIN}/setup?oauth=ok`);
  });

  it('garde le panneau d’administration quand le flux en est parti', () => {
    // La reconnexion à Twitch se lance aussi depuis le panneau. Renvoyer dans
    // l'assistant quelqu'un qui n'y était pas serait déroutant.
    expect(
      oauthReturnUrl({
        appOrigin: APP_ORIGIN,
        currentUrl: `${APP_ORIGIN}/admin`,
        outcome: 'ok',
      }),
    ).toBe(`${APP_ORIGIN}/admin?oauth=ok`);
  });

  it('transporte l’issue quelle qu’elle soit', () => {
    // Un refus et un échec doivent ramener la fenêtre autant qu'une réussite :
    // c'est là que l'utilisateur a le plus besoin de comprendre.
    expect(
      oauthReturnUrl({ appOrigin: APP_ORIGIN, currentUrl: `${APP_ORIGIN}/setup`, outcome: 'denied' }),
    ).toBe(`${APP_ORIGIN}/setup?oauth=denied`);
    expect(
      oauthReturnUrl({ appOrigin: APP_ORIGIN, currentUrl: `${APP_ORIGIN}/setup`, outcome: 'failed' }),
    ).toBe(`${APP_ORIGIN}/setup?oauth=failed`);
  });

  it('remplace une chaîne de requête déjà présente', () => {
    // Sinon un second passage empilerait `?oauth=ok&oauth=failed`, et
    // l'assistant annoncerait le résultat de l'avant-dernière tentative.
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
    // Fenêtre encore vide, page d'erreur du réseau, ou origine étrangère :
    // l'assistant est la destination sûre, et la seule qui sache quoi montrer.
    for (const elsewhere of ['', 'about:blank', 'https://id.twitch.tv/oauth2/authorize', 'http://127.0.0.1:9999/setup']) {
      expect(
        oauthReturnUrl({ appOrigin: APP_ORIGIN, currentUrl: elsewhere, outcome: 'ok' }),
      ).toBe(`${APP_ORIGIN}/setup?oauth=ok`);
    }
  });

  it('ne recharge que l’assistant ou le panneau, jamais autre chose', () => {
    // Cette URL part dans `loadURL` : ce qu'on y met est ce que la fenêtre
    // affichera. Plutôt que de filtrer les formes hostiles une à une — il y en
    // a toujours une de plus — la destination est prise dans un ensemble clos
    // de deux pages. Tout le reste retombe sur l'assistant.
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
