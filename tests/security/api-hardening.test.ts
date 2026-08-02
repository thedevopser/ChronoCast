import { beforeEach, describe, expect, it } from 'vitest';

import { createLogger, type LogSink } from '../../src/core/logging/logger.js';
import type { HttpResponse } from '../../src/core/server/http-types.js';
import { createRouter, type Router } from '../../src/core/server/router.js';
import { createApiRoutes } from '../../src/core/server/routes/api.js';
import type { PageHandler } from '../../src/core/server/routes/pages.js';
import { CSRF_HEADER } from '../../src/core/server/security/csrf.js';
import type { StaticHandler } from '../../src/core/server/static-handler.js';
import { createApiDoubles, type ApiDoubles } from '../helpers/api-context.js';
import { makeRequest } from '../helpers/http-request.js';

/**
 * Ces tests traversent le routeur complet, et non les routes seules. C'est la
 * seule façon de vérifier ce qui compte : que les gardes s'appliquent
 * effectivement à chaque route, y compris à celles ajoutées après coup.
 *
 * L'application est locale, sans authentification, et pilote un compteur affiché
 * en direct devant des milliers de personnes. Trois choses ne doivent jamais
 * arriver : qu'une page tierce la commande, qu'un secret en ressorte, et qu'un
 * fichier importé par l'utilisateur en modifie le comportement au-delà de ce que
 * le schéma autorise.
 */

const SILENT_SINK: LogSink = { name: 'silencieux', write: () => undefined };
const TOKEN = 'a'.repeat(64);

const NO_PAGE: PageHandler = { serve: () => Promise.resolve(null) };
const NO_STATIC: StaticHandler = {
  serve: () => Promise.resolve({ status: 404, headers: {}, body: 'introuvable' }),
};

/** Toutes les mutations de l'API, pour n'en oublier aucune. */
const MUTATIONS: readonly (readonly [string, string])[] = [
  ['PATCH', '/api/config'],
  ['POST', '/api/config/import'],
  ['POST', '/api/counter/pause'],
  ['POST', '/api/counter/resume'],
  ['POST', '/api/counter/reset'],
  ['POST', '/api/counter/add'],
  ['POST', '/api/counter/remove'],
  ['POST', '/api/counter/initial'],
  ['POST', '/api/twitch/connect'],
  ['POST', '/api/twitch/revoke'],
  ['POST', '/api/overlay/test'],
];

/** Toutes les lectures de l'API. */
const READS: readonly string[] = [
  '/api/state',
  '/api/config',
  '/api/config/export',
  '/api/twitch/status',
  '/api/twitch/subscriptions',
  '/api/history',
  '/api/logs',
];

describe('durcissement de l’API', () => {
  let doubles: ApiDoubles;
  let router: Router;

  beforeEach(() => {
    doubles = createApiDoubles();
    router = createRouter({
      routes: createApiRoutes(doubles.context),
      pageHandler: NO_PAGE,
      // Aucune feuille personnelle : ce fichier n'audite que l'API.
      customCssHandler: NO_PAGE,
      staticHandler: NO_STATIC,
      getCsrfToken: () => TOKEN,
      logger: createLogger({ level: 'error', sinks: [SILENT_SINK] }),
    });
  });

  function authorized(method: string, path: string, body = '{}'): Promise<HttpResponse> {
    return router.handle(
      makeRequest({ method, path, body, headers: { [CSRF_HEADER]: TOKEN } }),
    );
  }

  describe('jeton anti-CSRF', () => {
    it.each(MUTATIONS)('%s %s exige le jeton', async (method, path) => {
      const response = await router.handle(makeRequest({ method, path, body: '{}' }));

      expect(response.status).toBe(403);
      // Aucune trace d'exécution : la garde intervient avant la route.
      expect(doubles.calls).toEqual([]);
    });

    it.each(MUTATIONS)('%s %s refuse un jeton falsifié', async (method, path) => {
      const response = await router.handle(
        makeRequest({ method, path, body: '{}', headers: { [CSRF_HEADER]: 'b'.repeat(64) } }),
      );

      expect(response.status).toBe(403);
    });

    it.each(READS)('%s reste lisible sans jeton', async (path) => {
      // L'overlay est chargé par OBS, qui ne peut pas ajouter d'en-tête : la
      // lecture doit rester ouverte, et c'est pourquoi elle ne divulgue rien.
      const response = await router.handle(makeRequest({ path }));

      expect(response.status).not.toBe(403);
    });
  });

  describe('garde d’hôte', () => {
    it.each([...READS])('%s refuse un Host étranger', async (path) => {
      const response = await router.handle(makeRequest({ path, headers: { host: 'evil.com' } }));

      expect(response.status).toBe(403);
    });
  });

  describe('secrets', () => {
    beforeEach(async () => {
      await authorized(
        'PATCH',
        '/api/config',
        JSON.stringify({ clientSecret: 'secret-tres-confidentiel' }),
      );
    });

    it.each(READS)('%s ne divulgue jamais le secret client', async (path) => {
      const response = await router.handle(makeRequest({ path }));

      expect(String(response.body)).not.toContain('secret-tres-confidentiel');
    });

    it("n'écrit pas le secret dans la configuration exportée", async () => {
      const response = await router.handle(makeRequest({ path: '/api/config/export' }));

      expect(String(response.body)).not.toContain('secret-tres-confidentiel');
      expect(String(response.body)).not.toContain('clientSecret');
    });
  });

  describe('import hostile', () => {
    it('neutralise une tentative de pollution de prototype', async () => {
      // Le JSON est écrit à la main, littéralement. Le passer par un littéral
      // d'objet ne testerait rien : `{ __proto__: … }` définit le prototype de
      // l'objet au lieu d'y créer une clé, et `JSON.stringify` ne l'émettrait pas.
      const hostileConfig = '{"__proto__":{"pollué":true},"counter":{"initialSeconds":60}}';

      await authorized(
        'POST',
        '/api/config/import',
        JSON.stringify({ content: hostileConfig }),
      );

      expect(({} as Record<string, unknown>)['pollué']).toBeUndefined();
      expect(Object.prototype).not.toHaveProperty('pollué');
      expect(JSON.stringify(doubles.config)).not.toContain('pollué');
    });

    it('neutralise une pollution passée par PATCH', async () => {
      await authorized(
        'PATCH',
        '/api/config',
        '{"config":{"__proto__":{"polluéPatch":true},"counter":{"initialSeconds":60}}}',
      );

      expect(({} as Record<string, unknown>)['polluéPatch']).toBeUndefined();
      expect(Object.prototype).not.toHaveProperty('polluéPatch');
    });

    it('écarte les clés inconnues au lieu de les conserver', async () => {
      await authorized(
        'POST',
        '/api/config/import',
        JSON.stringify({ content: JSON.stringify({ porteDérobée: 'oui' }) }),
      );

      expect(JSON.stringify(doubles.config)).not.toContain('porteDérobée');
    });

    it.each([
      { content: '{ tronqué' },
      { content: '[]' },
      { content: 'null' },
      { content: JSON.stringify({ server: { host: '0.0.0.0' } }) },
      { content: JSON.stringify({ counter: { initialSeconds: -1 } }) },
    ])('refuse %j en 400', async (payload) => {
      const response = await authorized('POST', '/api/config/import', JSON.stringify(payload));

      expect(response.status).toBe(400);
    });

    it("n'autorise jamais une écoute hors de la boucle locale", async () => {
      // Le point le plus sensible de tout le fichier de configuration : une
      // écoute sur 0.0.0.0 offrirait le panneau d'administration au réseau.
      await authorized(
        'PATCH',
        '/api/config',
        JSON.stringify({ config: { server: { host: '0.0.0.0', httpPort: 3_777 } } }),
      );

      expect(doubles.config.server.host).toBe('127.0.0.1');
    });
  });

  describe('en-têtes', () => {
    it.each(READS)('%s porte les en-têtes de sécurité', async (path) => {
      const response = await router.handle(makeRequest({ path }));

      expect(response.headers['content-security-policy']).toBeTypeOf('string');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(
        Object.keys(response.headers).filter((name) => name.startsWith('access-control-')),
      ).toEqual([]);
    });
  });
});
