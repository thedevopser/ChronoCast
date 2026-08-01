import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createLogger, type LogRecord, type LogSink } from '../../../src/core/logging/logger.js';
import { createRedactor } from '../../../src/core/logging/redaction.js';
import { jsonResponse, type HttpResponse } from '../../../src/core/server/http-types.js';
import { createRouter, type Route, type Router } from '../../../src/core/server/router.js';
import type { PageHandler } from '../../../src/core/server/routes/pages.js';
import { CSRF_HEADER } from '../../../src/core/server/security/csrf.js';
import type { StaticHandler } from '../../../src/core/server/static-handler.js';
import { makeRequest } from '../../helpers/http-request.js';

/**
 * Le routeur est le seul chemin par lequel une requête entre dans l'application.
 * C'est donc le seul endroit où les gardes de sécurité peuvent être rendues
 * inévitables : posées ici, en amont de toute résolution de route, aucune route
 * ajoutée plus tard ne peut les oublier.
 *
 * L'ordre compte. La garde d'`Host` passe en premier parce qu'elle refuse la
 * requête sans rien exécuter. La garde CSRF vient ensuite, avant même de savoir
 * si la route existe : répondre `404` à une mutation non authentifiée
 * renseignerait un attaquant sur la carte de l'API.
 */

const TOKEN = 'f'.repeat(64);

function createMemorySink(): LogSink & { readonly records: LogRecord[] } {
  const records: LogRecord[] = [];
  return {
    name: 'memory',
    records,
    write(record: LogRecord): void {
      records.push(record);
    },
  };
}

describe('createRouter', () => {
  let router: Router;
  let sink: LogSink & { readonly records: LogRecord[] };
  let pageResponse: HttpResponse | null;
  let staticResponse: HttpResponse;
  let handled: string[];

  const pageHandler: PageHandler = {
    serve: (pathname) => {
      handled.push(`page:${pathname}`);
      return Promise.resolve(pageResponse);
    },
  };

  const staticHandler: StaticHandler = {
    serve: (pathname) => {
      handled.push(`static:${pathname}`);
      return Promise.resolve(staticResponse);
    },
  };

  const routes: Route[] = [
    { method: 'GET', path: '/api/state', handler: () => jsonResponse(200, { ok: true }) },
    { method: 'POST', path: '/api/counter/pause', handler: () => jsonResponse(200, { paused: true }) },
    {
      method: 'POST',
      path: '/api/boom',
      handler: () => {
        throw new Error('détail interne très bavard');
      },
    },
  ];

  beforeEach(() => {
    handled = [];
    pageResponse = null;
    staticResponse = { status: 404, headers: {}, body: 'Ressource introuvable.' };
    sink = createMemorySink();

    router = createRouter({
      routes,
      pageHandler,
      staticHandler,
      getCsrfToken: () => TOKEN,
      logger: createLogger({ level: 'debug', sinks: [sink], redactor: createRedactor() }),
    });
  });

  describe('gardes de sécurité', () => {
    it('refuse un Host étranger avant toute exécution', async () => {
      const response = await router.handle(
        makeRequest({ path: '/api/state', headers: { host: 'evil.com' } }),
      );

      expect(response.status).toBe(403);
      expect(handled).toEqual([]);
    });

    it('refuse une mutation sans jeton', async () => {
      const response = await router.handle(
        makeRequest({ method: 'POST', path: '/api/counter/pause' }),
      );

      expect(response.status).toBe(403);
    });

    it("refuse une mutation sur une route inexistante sans révéler qu'elle n'existe pas", async () => {
      // Un 404 ici dessinerait la carte de l'API à qui la demande.
      const response = await router.handle(makeRequest({ method: 'POST', path: '/api/inconnue' }));

      expect(response.status).toBe(403);
    });

    it('applique les en-têtes de sécurité à toutes les réponses', async () => {
      const cases = [
        await router.handle(makeRequest({ path: '/api/state' })),
        await router.handle(makeRequest({ path: '/inconnu.html' })),
        await router.handle(makeRequest({ headers: { host: 'evil.com' } })),
      ];

      for (const response of cases) {
        expect(response.headers['content-security-policy']).toBeTypeOf('string');
        expect(response.headers['x-content-type-options']).toBe('nosniff');
      }
    });
  });

  describe('résolution', () => {
    it('exécute une route de lecture', async () => {
      const response = await router.handle(makeRequest({ path: '/api/state' }));

      expect(response.status).toBe(200);
      expect(JSON.parse(String(response.body))).toEqual({ ok: true });
    });

    it('exécute une mutation portant le bon jeton', async () => {
      const response = await router.handle(
        makeRequest({
          method: 'POST',
          path: '/api/counter/pause',
          headers: { [CSRF_HEADER]: TOKEN },
        }),
      );

      expect(response.status).toBe(200);
    });

    it('répond 405 sur une méthode non prévue pour une route existante', async () => {
      const response = await router.handle(makeRequest({ method: 'GET', path: '/api/counter/pause' }));

      expect(response.status).toBe(405);
      expect(response.headers['allow']).toBe('POST');
    });

    it('répond 404 en JSON sur une route API inconnue', async () => {
      const response = await router.handle(makeRequest({ path: '/api/inconnue' }));

      expect(response.status).toBe(404);
      expect(response.headers['content-type']).toContain('application/json');
    });

    it("ne consulte ni les pages ni le statique pour un chemin d'API", async () => {
      await router.handle(makeRequest({ path: '/api/inconnue' }));
      expect(handled).toEqual([]);
    });

    it('essaie la page avant le statique', async () => {
      pageResponse = { status: 200, headers: {}, body: '<p>admin</p>' };

      const response = await router.handle(makeRequest({ path: '/admin' }));

      expect(response.status).toBe(200);
      expect(handled).toEqual(['page:/admin']);
    });

    it('retombe sur le statique quand la page ne reconnaît pas le chemin', async () => {
      staticResponse = { status: 200, headers: {}, body: 'body{}' };

      const response = await router.handle(makeRequest({ path: '/admin/style.css' }));

      expect(response.status).toBe(200);
      expect(handled).toEqual(['page:/admin/style.css', 'static:/admin/style.css']);
    });
  });

  describe('HEAD', () => {
    it('répond comme un GET mais sans corps', async () => {
      const response = await router.handle(makeRequest({ method: 'HEAD', path: '/api/state' }));

      expect(response.status).toBe(200);
      expect(response.body).toBe('');
      // La longueur reste annoncée : c'est tout l'intérêt d'un HEAD.
      expect(response.headers['content-length']).toBe(String(JSON.stringify({ ok: true }).length));
    });
  });

  describe('erreurs', () => {
    it('transforme une exception en 500 sans divulguer le détail interne', async () => {
      const response = await router.handle(
        makeRequest({ method: 'POST', path: '/api/boom', headers: { [CSRF_HEADER]: TOKEN } }),
      );

      expect(response.status).toBe(500);
      expect(String(response.body)).not.toContain('bavard');
    });

    it("journalise le détail que la réponse tait", async () => {
      await router.handle(
        makeRequest({ method: 'POST', path: '/api/boom', headers: { [CSRF_HEADER]: TOKEN } }),
      );

      const errors = sink.records.filter((record) => record.level === 'error');
      expect(errors).toHaveLength(1);
      expect(JSON.stringify(errors[0]?.context)).toContain('bavard');
    });

    it('reste disponible après une route en échec', async () => {
      await router.handle(
        makeRequest({ method: 'POST', path: '/api/boom', headers: { [CSRF_HEADER]: TOKEN } }),
      );

      expect((await router.handle(makeRequest({ path: '/api/state' }))).status).toBe(200);
    });

    it("survit à un gestionnaire de page défaillant", async () => {
      const failing = createRouter({
        routes: [],
        pageHandler: { serve: () => Promise.reject(new Error('disque en panne')) },
        staticHandler,
        getCsrfToken: () => TOKEN,
        logger: createLogger({ level: 'debug', sinks: [sink], redactor: createRedactor() }),
      });

      expect((await failing.handle(makeRequest({ path: '/admin' }))).status).toBe(500);
    });
  });

  it('lit le jeton à chaque requête', async () => {
    // Le jeton est engendré au démarrage : un routeur qui le capturerait une fois
    // pour toutes casserait au premier redémarrage à chaud.
    const getToken = vi.fn(() => TOKEN);
    const fresh = createRouter({
      routes,
      pageHandler,
      staticHandler,
      getCsrfToken: getToken,
      logger: createLogger({ level: 'error', sinks: [sink] }),
    });

    await fresh.handle(
      makeRequest({ method: 'POST', path: '/api/counter/pause', headers: { [CSRF_HEADER]: TOKEN } }),
    );
    await fresh.handle(
      makeRequest({ method: 'POST', path: '/api/counter/pause', headers: { [CSRF_HEADER]: TOKEN } }),
    );

    expect(getToken).toHaveBeenCalledTimes(2);
  });
});
