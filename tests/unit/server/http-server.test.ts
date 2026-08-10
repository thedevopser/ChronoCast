import { createServer, type Server } from 'node:http';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createLogger, type LogRecord, type LogSink } from '../../../src/core/logging/logger.js';
import { jsonResponse, type HttpRequest, type HttpResponse } from '../../../src/core/server/http-types.js';
import { createHttpServer, type HttpServer } from '../../../src/core/server/http-server.js';
import type { Router } from '../../../src/core/server/router.js';

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

function createRouterDouble() {
  const seen: HttpRequest[] = [];
  let next: HttpResponse = jsonResponse(200, { ok: true });

  const router: Router = {
    handle(request: HttpRequest): Promise<HttpResponse> {
      seen.push(request);
      return Promise.resolve(next);
    },
  };

  return {
    router,
    seen,
    respondWith(response: HttpResponse): void {
      next = response;
    },
  };
}

async function occupyPort(): Promise<{ port: number; release: () => Promise<void> }> {
  const blocker: Server = createServer();

  const port = await new Promise<number>((resolvePort, reject) => {
    blocker.once('error', reject);
    blocker.listen(0, '127.0.0.1', () => {
      const address = blocker.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('adresse inattendue'));
        return;
      }
      resolvePort(address.port);
    });
  });

  return {
    port,
    release: () =>
      new Promise<void>((done) => {
        blocker.close(() => {
          done();
        });
      }),
  };
}

describe('createHttpServer', () => {
  let server: HttpServer | null;
  let sink: LogSink & { readonly records: LogRecord[] };

  beforeEach(() => {
    server = null;
    sink = createMemorySink();
  });

  afterEach(async () => {
    await server?.stop();
  });

  function build(overrides: Partial<Parameters<typeof createHttpServer>[0]> = {}): HttpServer {
    const double = createRouterDouble();
    return createHttpServer({
      router: double.router,
      host: '127.0.0.1',
      port: 0,
      portFallbackAttempts: 5,
      maxBodyBytes: 64 * 1024,
      logger: createLogger({ level: 'debug', sinks: [sink] }),
      ...overrides,
    });
  }

  it('écoute sur la boucle locale et rapporte le port retenu', async () => {
    server = build();
    const port = await server.start();

    expect(port).toBeGreaterThan(0);
    expect(server.getPort()).toBe(port);
  });

  it('sert une réponse du routeur', async () => {
    const double = createRouterDouble();
    double.respondWith(jsonResponse(200, { compteur: 42 }));
    server = build({ router: double.router });
    const port = await server.start();

    const response = await fetch(`http://127.0.0.1:${String(port)}/api/state`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ compteur: 42 });
  });

  it('normalise la requête avant de la transmettre', async () => {
    const double = createRouterDouble();
    server = build({ router: double.router });
    const port = await server.start();

    await fetch(`http://127.0.0.1:${String(port)}/api/history?limit=10&level=info`, {
      method: 'POST',
      headers: { 'X-ChronoCast-Token': 'abc', 'Content-Type': 'application/json' },
      body: '{"a":1}',
    });

    const request = double.seen[0];
    expect(request?.method).toBe('POST');
    expect(request?.path).toBe('/api/history');
    expect(request?.query.get('limit')).toBe('10');
    expect(request?.headers['x-chronocast-token']).toBe('abc');
    expect(request?.body).toBe('{"a":1}');
  });

  it('décode le chemin une seule fois', async () => {
    const double = createRouterDouble();
    server = build({ router: double.router });
    const port = await server.start();

    await fetch(`http://127.0.0.1:${String(port)}/overlay/%252e%252e/config.json`);

    expect(double.seen[0]?.path).toBe('/overlay/%2e%2e/config.json');
  });

  it('répond 413 au-delà du plafond de corps, sans le mettre en mémoire', async () => {
    const double = createRouterDouble();
    server = build({ router: double.router, maxBodyBytes: 1_024 });
    const port = await server.start();

    const response = await fetch(`http://127.0.0.1:${String(port)}/api/config`, {
      method: 'POST',
      body: 'x'.repeat(4_096),
    });

    expect(response.status).toBe(413);
    expect(double.seen).toEqual([]);
  });

  it('sert un corps binaire sans le corrompre', async () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
    const double = createRouterDouble();
    double.respondWith({ status: 200, headers: { 'content-type': 'image/png' }, body: bytes });
    server = build({ router: double.router });
    const port = await server.start();

    const response = await fetch(`http://127.0.0.1:${String(port)}/logo.png`);

    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it('essaie le port suivant lorsque le port demandé est pris', async () => {
    const blocked = await occupyPort();
    try {
      server = build({ port: blocked.port, portFallbackAttempts: 5 });
      const port = await server.start();

      expect(port).not.toBe(blocked.port);
      expect(port).toBeGreaterThan(blocked.port);
      expect(sink.records.some((record) => record.level === 'warning')).toBe(true);
    } finally {
      await blocked.release();
    }
  });

  it('échoue explicitement quand aucun repli ne reste', async () => {
    const blocked = await occupyPort();
    try {
      server = build({ port: blocked.port, portFallbackAttempts: 0 });

      await expect(server.start()).rejects.toThrow(/port/i);
    } finally {
      await blocked.release();
    }
  });

  it('libère le port à l’arrêt', async () => {
    server = build();
    const port = await server.start();
    await server.stop();
    server = null;

    const second = build({ port });
    try {
      expect(await second.start()).toBe(port);
    } finally {
      await second.stop();
    }
  });

  it('reste debout après une erreur du routeur', async () => {
    const failing: Router = {
      handle: () => Promise.reject(new Error('routeur cassé')),
    };
    server = build({ router: failing });
    const port = await server.start();

    const response = await fetch(`http://127.0.0.1:${String(port)}/api/state`);
    expect(response.status).toBe(500);

    expect((await fetch(`http://127.0.0.1:${String(port)}/api/state`)).status).toBe(500);
  });
});
