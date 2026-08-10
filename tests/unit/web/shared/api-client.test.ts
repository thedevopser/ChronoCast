import { describe, expect, it } from 'vitest';

import { ApiError, createApiClient, readCsrfToken } from '../../../../src/web/shared/api-client.js';

const TOKEN = 'a'.repeat(64);

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

interface Call {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string | null;
}

function createHarness(respond: (call: Call) => Response = () => jsonResponse(200, { ok: true })) {
  const calls: Call[] = [];

  const client = createApiClient({
    token: TOKEN,
    fetch: (input: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const call: Call = {
        url: input,
        method: init?.method ?? 'GET',
        headers,
        body: typeof init?.body === 'string' ? init.body : null,
      };
      calls.push(call);
      return Promise.resolve(respond(call));
    },
  });

  return { client, calls };
}

describe('readCsrfToken', () => {
  it('lit le jeton injecté dans le gabarit', () => {
    const document_ = new DOMParser().parseFromString(
      `<!doctype html><html><head><meta name="chronocast-csrf" content="${TOKEN}"></head><body></body></html>`,
      'text/html',
    );

    expect(readCsrfToken(document_)).toBe(TOKEN);
  });

  it('lève quand le marqueur n’a pas été substitué', () => {
    const document_ = new DOMParser().parseFromString(
      '<!doctype html><html><head><meta name="chronocast-csrf" content="__CHRONOCAST_CSRF__"></head><body></body></html>',
      'text/html',
    );

    expect(() => readCsrfToken(document_)).toThrow(/jeton/iu);
  });

  it('lève quand le gabarit ne porte pas de jeton du tout', () => {
    const document_ = new DOMParser().parseFromString(
      '<!doctype html><html><head></head><body></body></html>',
      'text/html',
    );

    expect(() => readCsrfToken(document_)).toThrow(/jeton/iu);
  });
});

describe('createApiClient', () => {
  describe('lecture', () => {
    it('interroge la route demandée sans jeton', () => {
      const harness = createHarness();

      void harness.client.get('/api/state');

      expect(harness.calls[0]?.method).toBe('GET');
      expect(harness.calls[0]?.url).toBe('/api/state');
      expect(harness.calls[0]?.headers['x-chronocast-token']).toBeUndefined();
    });

    it('rend le corps décodé', async () => {
      const harness = createHarness(() => jsonResponse(200, { counter: { remainingMs: 42 } }));

      const body = await harness.client.get<{ counter: { remainingMs: number } }>('/api/state');

      expect(body.counter.remainingMs).toBe(42);
    });
  });

  describe('mutation', () => {
    it('porte le jeton CSRF', () => {
      const harness = createHarness();

      void harness.client.post('/api/counter/pause');

      expect(harness.calls[0]?.headers['x-chronocast-token']).toBe(TOKEN);
    });

    it('sérialise le corps et annonce son type', () => {
      const harness = createHarness();

      void harness.client.post('/api/counter/add', { seconds: 300 });

      expect(harness.calls[0]?.body).toBe('{"seconds":300}');
      expect(harness.calls[0]?.headers['content-type']).toBe('application/json');
    });

    it('n’envoie aucun corps quand il n’y en a pas', () => {
      const harness = createHarness();

      void harness.client.post('/api/counter/pause');

      expect(harness.calls[0]?.body).toBeNull();
    });

    it('accepte une réponse sans contenu', async () => {
      const harness = createHarness(() => new Response(null, { status: 204 }));

      await expect(harness.client.post('/api/twitch/revoke')).resolves.toBeNull();
    });

    it('transmet un correctif de configuration', () => {
      const harness = createHarness();

      void harness.client.patch('/api/config', { config: { counter: { initialMs: 1 } } });

      expect(harness.calls[0]?.method).toBe('PATCH');
      expect(harness.calls[0]?.body).toBe('{"config":{"counter":{"initialMs":1}}}');
    });
  });

  describe('erreurs', () => {
    it('relaie le message français du serveur', async () => {
      const harness = createHarness(() =>
        jsonResponse(400, { error: 'Durée invalide.', code: 'invalid_request' }),
      );

      await expect(harness.client.post('/api/counter/add', { seconds: -1 })).rejects.toThrow(
        'Durée invalide.',
      );
    });

    it('expose le code et le statut pour que l’appelant décide', async () => {
      const harness = createHarness(() =>
        jsonResponse(502, { error: 'Twitch n’a pas répondu.', code: 'twitch_unavailable' }),
      );

      const failure = await harness.client.get('/api/twitch/status').catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(ApiError);
      expect((failure as ApiError).code).toBe('twitch_unavailable');
      expect((failure as ApiError).status).toBe(502);
    });

    it('reste compréhensible quand la réponse n’est pas du JSON', async () => {
      const harness = createHarness(() => new Response('Ressource introuvable.', { status: 404 }));

      const failure = await harness.client.get('/api/absente').catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(ApiError);
      expect((failure as ApiError).status).toBe(404);
    });

    it('signale une coupure réseau sans laisser fuir l’erreur brute', async () => {
      const client = createApiClient({
        token: TOKEN,
        fetch: () => Promise.reject(new TypeError('Failed to fetch')),
      });

      const failure = await client.get('/api/state').catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(ApiError);
      expect((failure as ApiError).code).toBe('network_unreachable');
    });
  });
});
