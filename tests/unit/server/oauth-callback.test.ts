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
  readonly settled: string[];
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
  const settled: string[] = [];

  return {
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
      onSettled: (outcome) => {
        settled.push(outcome);
      },
      logger: createLogger({ level: 'error', sinks: [] }),
    }),
    exchanged,
    verified,
    settled,
  };
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

    it('rend une page terminale, sans renvoyer le navigateur dans l’assistant', async () => {
      const harness = createHarness();

      const response = await harness.router.handle(callback({ code: 'abc', state: VALID_STATE }));

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.headers['location']).toBeUndefined();
    });

    it('renvoie l’utilisateur vers ChronoCast', async () => {
      const harness = createHarness();

      const response = await harness.router.handle(callback({ code: 'abc', state: VALID_STATE }));

      expect(response.body.toString()).toContain('ChronoCast');
    });

    it('garde un lien vers l’assistant, seul retour du mode headless', async () => {
      const harness = createHarness();

      const response = await harness.router.handle(callback({ code: 'abc', state: VALID_STATE }));

      expect(response.body.toString()).toContain('http://127.0.0.1:3777/setup?oauth=ok');
    });

    it('signale l’issue du flux', async () => {
      const harness = createHarness();

      await harness.router.handle(callback({ code: 'abc', state: VALID_STATE }));

      expect(harness.settled).toStrictEqual(['ok']);
    });

    it('ne laisse jamais le code apparaître dans la page', async () => {
      const harness = createHarness();

      const response = await harness.router.handle(
        callback({ code: 'secret-code', state: VALID_STATE }),
      );

      expect(JSON.stringify(response)).not.toContain('secret-code');
    });

    it('omet le lien quand le port applicatif est inconnu', async () => {
      const harness = createHarness({ appPort: null });

      const response = await harness.router.handle(callback({ code: 'abc', state: VALID_STATE }));

      expect(response.status).toBe(200);
      expect(response.body.toString()).not.toContain('<a');
      expect(harness.exchanged).toStrictEqual(['abc']);
    });
  });

  describe('refus de l’utilisateur', () => {
    it('clôt le flux sans tenter d’échange', async () => {
      const harness = createHarness();

      const response = await harness.router.handle(
        callback({ error: 'access_denied', error_description: 'refusé', state: VALID_STATE }),
      );

      expect(response.status).toBe(200);
      expect(response.body.toString()).toContain('oauth=denied');
      expect(harness.exchanged).toStrictEqual([]);
      expect(harness.settled).toStrictEqual(['denied']);
    });

    it('ne reflète pas le message d’erreur de Twitch', async () => {
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
      const harness = createHarness({ verifyState: () => false });

      await harness.router.handle(callback({ code: 'abc', state: 'b'.repeat(64) }));

      expect(harness.settled).toStrictEqual([]);
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
    it('annonce l’échec avec un code stable', async () => {
      const harness = createHarness({
        complete: () => Promise.reject(new Error('Twitch a répondu 400')),
      });

      const response = await harness.router.handle(callback({ code: 'abc', state: VALID_STATE }));

      expect(response.status).toBe(200);
      expect(response.body.toString()).toContain('oauth=failed');
      expect(harness.settled).toStrictEqual(['failed']);
    });

    it('ne reflète pas le message d’erreur dans la page', async () => {
      const harness = createHarness({
        complete: () => Promise.reject(new Error('client_secret invalide : abcdef')),
      });

      const response = await harness.router.handle(callback({ code: 'abc', state: VALID_STATE }));

      expect(JSON.stringify(response)).not.toContain('abcdef');
    });

    it('clôt tout de même le flux', async () => {
      const harness = createHarness({ complete: () => Promise.reject(new Error('échec')) });

      await harness.router.handle(callback({ code: 'abc', state: VALID_STATE }));

      expect(harness.settled).toStrictEqual(['failed']);
    });
  });

  describe('surface', () => {
    it('ignore tout chemin autre que le rappel', async () => {
      const harness = createHarness();

      const response = await harness.router.handle(
        makeRequest({ path: '/', headers: { host: '127.0.0.1:37771' } }),
      );

      expect(response.status).toBe(404);
      expect(harness.settled).toStrictEqual([]);
    });

    it('n’accepte que la lecture', async () => {
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
