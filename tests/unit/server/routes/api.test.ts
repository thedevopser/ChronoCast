import { beforeEach, describe, expect, it } from 'vitest';

import type { HttpResponse } from '../../../../src/core/server/http-types.js';
import { createApiRoutes } from '../../../../src/core/server/routes/api.js';
import type { Route } from '../../../../src/core/server/router.js';
import { createApiDoubles, type ApiDoubles } from '../../../helpers/api-context.js';
import { makeRequest, type RequestOverrides } from '../../../helpers/http-request.js';

/**
 * Les routes ne font que déléguer : le métier vit dans les services, déjà testés
 * pour eux-mêmes. Ce qui se joue ici est ailleurs.
 *
 * D'abord la **validation** : tout corps entrant vient d'une page, et une page
 * peut avoir été ouverte par un lien. Zod est la seule porte, et une valeur
 * refusée doit produire un `400` explicite plutôt qu'un `500` — la différence
 * entre « vous vous êtes trompé » et « le serveur est cassé ».
 *
 * Ensuite le **secret** : le secret client Twitch s'écrit et ne se lit jamais.
 * Il n'entre pas dans la configuration, ne ressort ni par `GET`, ni par
 * l'export, ni par le WebSocket.
 */

describe('createApiRoutes', () => {
  let doubles: ApiDoubles;
  let routes: Route[];

  beforeEach(() => {
    doubles = createApiDoubles();
    routes = createApiRoutes(doubles.context);
  });

  /** Exécute une route comme le ferait le routeur, gardes déjà franchies. */
  async function call(
    method: string,
    path: string,
    overrides: RequestOverrides = {},
  ): Promise<HttpResponse> {
    const route = routes.find((entry) => entry.method === method && entry.path === path);
    if (route === undefined) {
      throw new Error(`route absente : ${method} ${path}`);
    }
    return await route.handler(makeRequest({ method, path, ...overrides }));
  }

  function body(response: HttpResponse): Record<string, unknown> {
    return JSON.parse(String(response.body)) as Record<string, unknown>;
  }

  describe('GET /api/state', () => {
    it('renvoie le compteur, Twitch et le port retenu', async () => {
      const response = await call('GET', '/api/state');

      expect(response.status).toBe(200);
      expect(body(response)).toMatchObject({
        port: 3_777,
        appVersion: '0.1.0',
        twitch: { status: 'ready' },
      });
      expect(body(response)['counter']).toMatchObject({ status: 'idle' });
    });

    it("expose la configuration d'overlay dont la page a besoin", async () => {
      expect(body(await call('GET', '/api/state'))['overlay']).toBeTypeOf('object');
    });
  });

  describe('configuration', () => {
    it('renvoie la configuration complète', async () => {
      const response = await call('GET', '/api/config');

      expect(response.status).toBe(200);
      expect(body(response)['config']).toMatchObject({ schemaVersion: 1 });
    });

    it('indique si un secret client est enregistré, sans le renvoyer', async () => {
      expect(body(await call('GET', '/api/config'))['hasClientSecret']).toBe(false);

      await call('PATCH', '/api/config', {
        body: JSON.stringify({ clientSecret: 'secret-tres-confidentiel' }),
      });

      const response = await call('GET', '/api/config');
      expect(body(response)['hasClientSecret']).toBe(true);
      expect(String(response.body)).not.toContain('secret-tres-confidentiel');
    });

    it('applique une modification partielle', async () => {
      const response = await call('PATCH', '/api/config', {
        body: JSON.stringify({ config: { counter: { initialSeconds: 3_600 } } }),
      });

      expect(response.status).toBe(200);
      expect(doubles.calls).toContain('config.update');
      expect(doubles.config.counter.initialSeconds).toBe(3_600);
    });

    it('dirige le secret client vers le magasin chiffré, pas vers la configuration', async () => {
      // Le secret n'a pas de place dans un fichier JSON en clair : il est
      // sibling de `config` dans le corps, jamais dedans, pour que l'exclusion
      // soit structurelle plutôt qu'une exception à ne pas oublier.
      await call('PATCH', '/api/config', {
        body: JSON.stringify({ clientSecret: 'secret-tres-confidentiel' }),
      });

      expect(doubles.calls).toContain('twitch.setClientSecret');
      expect(JSON.stringify(doubles.config)).not.toContain('secret-tres-confidentiel');
    });

    it('refuse un corps illisible', async () => {
      expect((await call('PATCH', '/api/config', { body: 'pas du json' })).status).toBe(400);
    });

    it('refuse un secret client vide', async () => {
      const response = await call('PATCH', '/api/config', {
        body: JSON.stringify({ clientSecret: '' }),
      });

      expect(response.status).toBe(400);
    });

    it('exporte la configuration en JSON téléchargeable', async () => {
      const response = await call('GET', '/api/config/export');

      expect(response.status).toBe(200);
      expect(response.headers['content-disposition']).toContain('chronocast');
      expect(doubles.calls).toContain('config.export');
    });

    it('importe une configuration valide', async () => {
      const response = await call('POST', '/api/config/import', {
        body: JSON.stringify({ content: JSON.stringify({ counter: { initialSeconds: 7_200 } }) }),
      });

      expect(response.status).toBe(200);
      expect(doubles.config.counter.initialSeconds).toBe(7_200);
    });

    it("répond 400 — et non 500 — sur un import invalide", async () => {
      const response = await call('POST', '/api/config/import', {
        body: JSON.stringify({ content: '{ tronqué' }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe('compteur', () => {
    it.each([
      ['/api/counter/pause', 'counter.pause'],
      ['/api/counter/resume', 'counter.resume'],
      ['/api/counter/reset', 'counter.reset'],
    ])('%s délègue au service', async (path, expected) => {
      const response = await call('POST', path);

      expect(response.status).toBe(200);
      expect(doubles.calls).toContain(expected);
      expect(body(response)['counter']).toBeTypeOf('object');
    });

    it('ajoute du temps avec un motif', async () => {
      await call('POST', '/api/counter/add', {
        body: JSON.stringify({ seconds: 300, reason: 'cadeau du modérateur' }),
      });

      expect(doubles.calls).toContain('counter.addTime:300:cadeau du modérateur');
    });

    it('fournit un motif par défaut', async () => {
      // L'historique doit rester lisible même quand l'interface ne demande rien :
      // une entrée sans motif ne s'explique plus six heures après.
      await call('POST', '/api/counter/add', { body: JSON.stringify({ seconds: 60 }) });

      expect(doubles.calls.some((entry) => entry.startsWith('counter.addTime:60:'))).toBe(true);
      expect(doubles.calls).not.toContain('counter.addTime:60:');
    });

    it('retire du temps', async () => {
      await call('POST', '/api/counter/remove', {
        body: JSON.stringify({ seconds: 120, reason: 'correction' }),
      });

      expect(doubles.calls).toContain('counter.removeTime:120:correction');
    });

    it('change la valeur de départ', async () => {
      await call('POST', '/api/counter/initial', { body: JSON.stringify({ seconds: 21_600 }) });

      expect(doubles.calls).toContain('counter.setInitialSeconds:21600');
    });

    it.each([
      {},
      { seconds: 0 },
      { seconds: -60 },
      { seconds: 1.5 },
      { seconds: '300' },
      { seconds: Number.MAX_SAFE_INTEGER },
      { seconds: null },
    ])('refuse %j', async (payload) => {
      const response = await call('POST', '/api/counter/add', { body: JSON.stringify(payload) });

      expect(response.status).toBe(400);
      expect(doubles.calls).toEqual([]);
    });

    it('refuse un motif démesuré', async () => {
      // Le motif finit dans l'historique et sur le WebSocket : le borner évite
      // qu'une page locale ne remplisse le disque une requête à la fois.
      const response = await call('POST', '/api/counter/add', {
        body: JSON.stringify({ seconds: 60, reason: 'x'.repeat(5_000) }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe('twitch', () => {
    it('rapporte le statut sans divulguer de jeton', async () => {
      const response = await call('GET', '/api/twitch/status');

      expect(response.status).toBe(200);
      expect(body(response)).toMatchObject({ status: 'ready', connected: true });
      expect(String(response.body)).not.toContain('accessToken');
    });

    it("renvoie l'URL d'autorisation", async () => {
      const response = await call('POST', '/api/twitch/connect');

      expect(response.status).toBe(200);
      expect(String(body(response)['authorizationUrl'])).toContain('id.twitch.tv');
      expect(doubles.calls).toContain('twitch.startAuthorization');
    });

    it('révoque les jetons', async () => {
      expect((await call('POST', '/api/twitch/revoke')).status).toBe(204);
      expect(doubles.calls).toContain('twitch.revoke');
    });

    it('liste les souscriptions', async () => {
      const response = await call('GET', '/api/twitch/subscriptions');

      expect(body(response)['subscriptions']).toEqual([
        { id: 'sub-1', type: 'channel.subscribe', status: 'enabled' },
      ]);
    });

    it('traduit une panne Twitch en 502, sans détail interne', async () => {
      // Une erreur de Twitch n'est pas une erreur de ChronoCast : le 502 le dit,
      // et évite au streamer de chercher la panne du mauvais côté.
      doubles.failTwitch = true;

      const response = await call('GET', '/api/twitch/status');

      expect(response.status).toBe(502);
      expect(String(response.body)).not.toContain('injoignable');
    });
  });

  describe('historique et journaux', () => {
    it('renvoie les dernières entrées', async () => {
      const response = await call('GET', '/api/history');

      expect(response.status).toBe(200);
      expect(doubles.calls.some((entry) => entry.startsWith('history.list:'))).toBe(true);
    });

    it('respecte la limite demandée', async () => {
      await call('GET', '/api/history', { query: { limit: '25' } });
      expect(doubles.calls).toContain('history.list:25');
    });

    it.each(['0', '-5', 'beaucoup', '99999'])('ramène la limite %s dans les bornes', async (limit) => {
      await call('GET', '/api/history', { query: { limit } });

      const call_ = doubles.calls.find((entry) => entry.startsWith('history.list:'));
      const value = Number(call_?.split(':')[1]);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(500);
    });

    it('renvoie les journaux en mémoire', async () => {
      doubles.ringBuffer.write({
        timestamp: '2026-08-01T10:00:00.000Z',
        level: 'warning',
        scope: 'twitch',
        message: 'reconnexion',
      });

      const response = await call('GET', '/api/logs');

      expect(response.status).toBe(200);
      expect(body(response)['records']).toHaveLength(1);
    });

    it('filtre les journaux par niveau', async () => {
      for (const level of ['debug', 'info', 'warning', 'error'] as const) {
        doubles.ringBuffer.write({
          timestamp: '2026-08-01T10:00:00.000Z',
          level,
          scope: 'app',
          message: level,
        });
      }

      const response = await call('GET', '/api/logs', { query: { level: 'warning' } });

      // Un filtre par niveau minimal, pas par niveau exact : chercher les
      // avertissements sans voir les erreurs n'aurait aucun sens.
      expect(body(response)['records']).toHaveLength(2);
    });

    it('ignore un niveau inconnu plutôt que de refuser la requête', async () => {
      expect((await call('GET', '/api/logs', { query: { level: 'inexistant' } })).status).toBe(200);
    });
  });

  describe("test d'overlay", () => {
    it('injecte un événement de test dans le pipeline', async () => {
      const response = await call('POST', '/api/overlay/test', {
        body: JSON.stringify({ type: 'sub' }),
      });

      expect(response.status).toBe(200);
      expect(doubles.calls).toContain('manual:sub');
    });

    it('marque l’événement comme manuel', async () => {
      // Sans cette provenance, un test d'overlay serait indiscernable d'un vrai
      // abonnement dans l'historique.
      const response = await call('POST', '/api/overlay/test', {
        body: JSON.stringify({ type: 'bits' }),
      });

      expect(body(response)['event']).toMatchObject({ source: 'manual', type: 'bits' });
    });

    it.each(['sub', 'resub', 'gift', 'bits', 'raid', 'follow'])('accepte le type %s', async (type) => {
      expect((await call('POST', '/api/overlay/test', { body: JSON.stringify({ type }) })).status).toBe(
        200,
      );
    });

    it('refuse un type inconnu', async () => {
      const response = await call('POST', '/api/overlay/test', {
        body: JSON.stringify({ type: 'donation' }),
      });

      expect(response.status).toBe(400);
    });

    it('tronque un pseudo démesuré plutôt que de le refuser', async () => {
      // Le pseudo vient de l'interface ici, mais il vient de Twitch en
      // production : le même plafond doit s'appliquer aux deux chemins.
      const response = await call('POST', '/api/overlay/test', {
        body: JSON.stringify({ type: 'sub', userName: 'é'.repeat(500) }),
      });

      expect(response.status).toBe(200);
      const event = body(response)['event'] as { userName: string };
      expect(event.userName.length).toBeLessThanOrEqual(64);
    });
  });
});
