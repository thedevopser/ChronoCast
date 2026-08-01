/**
 * Gestionnaire du rappel OAuth de Twitch.
 *
 * C'est le seul point de ChronoCast où un **navigateur extérieur au produit**
 * pousse une requête dans l'application. Twitch renvoie l'utilisateur sur
 * `http://127.0.0.1:37771/callback?code=…&state=…`, et ce code s'échange contre
 * un jeton d'accès à la chaîne. Autrement dit, ce fichier garde la porte.
 *
 * Le `state` est la seule défense contre l'attaque classique du flux
 * d'autorisation : un tiers déclenche son propre flux, glisse **son** code dans
 * la session du streamer, et ChronoCast se retrouve connecté au compte de
 * l'attaquant — qui reçoit alors les événements, ou pire, se sert de la chaîne
 * du streamer comme d'un relais. La comparaison est à temps constant et
 * réutilise `verifyCsrfToken`, le `state` ayant exactement la même forme que le
 * jeton CSRF : trente-deux octets en hexadécimal.
 *
 * Deux propriétés valent d'être énoncées, parce qu'elles ne vont pas de soi.
 *
 * **Le gestionnaire ne voit jamais le `state` attendu.** Il ne reçoit qu'un
 * `verifyState()` qui répond oui ou non. Il ne peut donc ni le journaliser, ni
 * le renvoyer dans une page, ni le laisser fuir dans une URL de redirection.
 *
 * **Un `state` qui ne correspond pas ne consomme rien.** N'importe quelle page
 * distante peut provoquer une navigation vers la boucle locale ; si un
 * `state` erroné suffisait à consommer la demande en cours, le premier venu
 * pourrait faire échouer la connexion du streamer à distance, en boucle.
 *
 * Le gestionnaire est une fonction pure de requête vers réponse, comme tout le
 * routage de la Phase 4 : aucun socket n'est ouvert dans ces tests.
 */

import { describe, expect, it, vi } from 'vitest';

import { createOAuthCallbackRouter } from '../../../src/core/server/oauth-callback.js';
import { createLogger } from '../../../src/core/logging/logger.js';
import { makeRequest } from '../../helpers/http-request.js';

const APP_PORT = 3_777;
const VALID_STATE = 'a'.repeat(64);

interface Harness {
  readonly router: ReturnType<typeof createOAuthCallbackRouter>;
  readonly exchanged: string[];
  readonly verified: string[];
  settledCount: number;
}

function createHarness(
  options: {
    verifyState?: (state: string) => boolean;
    complete?: (code: string) => Promise<void>;
    appPort?: number | null;
  } = {},
): Harness {
  const exchanged: string[] = [];
  const verified: string[] = [];

  const harness: Harness = {
    router: createOAuthCallbackRouter({
      verifyState: (state: string) => {
        verified.push(state);
        return options.verifyState?.(state) ?? state === VALID_STATE;
      },
      complete: async (code: string) => {
        exchanged.push(code);
        await (options.complete?.(code) ?? Promise.resolve());
      },
      getAppPort: () => (options.appPort === undefined ? APP_PORT : options.appPort),
      onSettled: () => {
        harness.settledCount += 1;
      },
      logger: createLogger({ level: 'error', sinks: [] }),
    }),
    exchanged,
    verified,
    settledCount: 0,
  };

  return harness;
}

function callback(query: Record<string, string>) {
  return makeRequest({ method: 'GET', path: '/callback', query, headers: { host: '127.0.0.1:37771' } });
}

describe('createOAuthCallbackRouter', () => {
  describe('rappel légitime', () => {
    it('échange le code reçu', async () => {
      const harness = createHarness();

      await harness.router.handle(callback({ code: 'abc123', state: VALID_STATE }));

      expect(harness.exchanged).toStrictEqual(['abc123']);
    });

    it('renvoie le navigateur vers l’assistant', async () => {
      // Ramener l'utilisateur dans l'assistant vaut mieux que de lui afficher
      // une page morte : il y voit le résultat et poursuit sa configuration.
      const harness = createHarness();

      const response = await harness.router.handle(callback({ code: 'abc', state: VALID_STATE }));

      expect(response.status).toBe(302);
      expect(response.headers['location']).toBe('http://127.0.0.1:3777/setup?oauth=ok');
    });

    it('signale que le flux est terminé', async () => {
      // C'est ce qui désarme le serveur éphémère : il n'a plus rien à écouter.
      const harness = createHarness();

      await harness.router.handle(callback({ code: 'abc', state: VALID_STATE }));

      expect(harness.settledCount).toBe(1);
    });

    it('ne laisse jamais le code apparaître dans la redirection', async () => {
      const harness = createHarness();

      const response = await harness.router.handle(
        callback({ code: 'secret-code', state: VALID_STATE }),
      );

      expect(JSON.stringify(response)).not.toContain('secret-code');
    });

    it('se rabat sur une page quand le port applicatif est inconnu', async () => {
      // Le rappel peut aboutir alors que le serveur principal n'écoute pas
      // encore : mieux vaut une page sobre qu'une redirection vers nulle part.
      const harness = createHarness({ appPort: null });

      const response = await harness.router.handle(callback({ code: 'abc', state: VALID_STATE }));

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(harness.exchanged).toStrictEqual(['abc']);
    });
  });

  describe('refus de l’utilisateur', () => {
    it('ramène à l’assistant sans tenter d’échange', async () => {
      // Twitch renvoie `error=access_denied` quand l'utilisateur clique sur
      // « Annuler ». Ce n'est pas une anomalie, c'est une décision.
      const harness = createHarness();

      const response = await harness.router.handle(
        callback({ error: 'access_denied', error_description: 'refusé', state: VALID_STATE }),
      );

      expect(response.status).toBe(302);
      expect(response.headers['location']).toBe('http://127.0.0.1:3777/setup?oauth=denied');
      expect(harness.exchanged).toStrictEqual([]);
      expect(harness.settledCount).toBe(1);
    });

    it('ne reflète pas le message d’erreur de Twitch', async () => {
      // Ce texte est contrôlé par un tiers et finirait dans une barre d'adresse
      // puis dans l'assistant : il n'apporte rien et ouvre une porte.
      const harness = createHarness();

      const response = await harness.router.handle(
        callback({ error: 'access_denied', error_description: '<script>alert(1)</script>' }),
      );

      expect(JSON.stringify(response)).not.toContain('script');
    });
  });

  describe('state', () => {
    it('refuse un state qui ne correspond pas', async () => {
      const harness = createHarness({ verifyState: () => false });

      const response = await harness.router.handle(callback({ code: 'abc', state: 'b'.repeat(64) }));

      expect(response.status).toBe(403);
      expect(harness.exchanged).toStrictEqual([]);
    });

    it('ne consomme pas la demande en cours quand le state est faux', async () => {
      // Une page distante peut provoquer une navigation vers la boucle locale.
      // Si un state erroné suffisait à clore le flux, n'importe qui pourrait
      // faire échouer la connexion du streamer, à distance et en boucle.
      const harness = createHarness({ verifyState: () => false });

      await harness.router.handle(callback({ code: 'abc', state: 'b'.repeat(64) }));

      expect(harness.settledCount).toBe(0);
    });

    it('refuse un rappel sans state', async () => {
      const harness = createHarness();

      const response = await harness.router.handle(callback({ code: 'abc' }));

      expect(response.status).toBe(400);
      expect(harness.verified).toStrictEqual([]);
      expect(harness.exchanged).toStrictEqual([]);
    });

    it('refuse un rappel sans code', async () => {
      const harness = createHarness();

      const response = await harness.router.handle(callback({ state: VALID_STATE }));

      expect(response.status).toBe(400);
      expect(harness.exchanged).toStrictEqual([]);
    });

    it('ne vérifie le state qu’une fois par requête', async () => {
      const harness = createHarness();

      await harness.router.handle(callback({ code: 'abc', state: VALID_STATE }));

      expect(harness.verified).toStrictEqual([VALID_STATE]);
    });
  });

  describe('échec de l’échange', () => {
    it('ramène à l’assistant avec un code d’erreur stable', async () => {
      const harness = createHarness({
        complete: () => Promise.reject(new Error('Twitch a répondu 400')),
      });

      const response = await harness.router.handle(callback({ code: 'abc', state: VALID_STATE }));

      expect(response.status).toBe(302);
      expect(response.headers['location']).toBe('http://127.0.0.1:3777/setup?oauth=failed');
    });

    it('ne reflète pas le message d’erreur dans l’URL', async () => {
      // Le détail appartient aux journaux, pas à une barre d'adresse.
      const harness = createHarness({
        complete: () => Promise.reject(new Error('client_secret invalide : abcdef')),
      });

      const response = await harness.router.handle(callback({ code: 'abc', state: VALID_STATE }));

      expect(JSON.stringify(response)).not.toContain('abcdef');
    });

    it('clôt tout de même le flux', async () => {
      // Le code d'autorisation est à usage unique : le rejouer échouerait de
      // toute façon. Laisser le serveur armé n'offrirait qu'une surface.
      const harness = createHarness({ complete: () => Promise.reject(new Error('échec')) });

      await harness.router.handle(callback({ code: 'abc', state: VALID_STATE }));

      expect(harness.settledCount).toBe(1);
    });
  });

  describe('surface', () => {
    it('ignore tout chemin autre que le rappel', async () => {
      const harness = createHarness();

      const response = await harness.router.handle(
        makeRequest({ path: '/', headers: { host: '127.0.0.1:37771' } }),
      );

      expect(response.status).toBe(404);
      expect(harness.settledCount).toBe(0);
    });

    it('n’accepte que la lecture', async () => {
      // Twitch redirige le navigateur : c'est un GET, et rien d'autre.
      const harness = createHarness();

      const response = await harness.router.handle(
        makeRequest({ method: 'POST', path: '/callback', headers: { host: '127.0.0.1:37771' } }),
      );

      expect(response.status).toBe(405);
    });

    it('interdit toute ressource sur ses réponses', async () => {
      const harness = createHarness();

      const response = await harness.router.handle(callback({ code: 'abc', state: VALID_STATE }));

      expect(response.headers['content-security-policy']).toBe("default-src 'none'");
      expect(response.headers['referrer-policy']).toBe('no-referrer');
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
    });

    it('ne journalise jamais le code d’autorisation', async () => {
      const records: string[] = [];
      const logger = createLogger({
        level: 'debug',
        sinks: [{ name: 'mémoire', write: (record) => records.push(JSON.stringify(record)) }],
      });

      const router = createOAuthCallbackRouter({
        verifyState: () => true,
        complete: () => Promise.resolve(),
        getAppPort: () => APP_PORT,
        onSettled: vi.fn(),
        logger,
      });

      await router.handle(callback({ code: 'code-tres-secret', state: VALID_STATE }));

      expect(records.join('\n')).not.toContain('code-tres-secret');
    });
  });
});
