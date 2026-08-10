import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import type { AppEvents } from '../../src/core/app/app-events.js';
import { createEventBus, type EventBus } from '../../src/core/app/event-bus.js';
import { DEFAULT_CONFIG } from '../../src/core/config/defaults.js';
import { createInitialState } from '../../src/core/counter/counter-state.js';
import { createLogger, type LogSink } from '../../src/core/logging/logger.js';
import { createHttpServer, type HttpServer } from '../../src/core/server/http-server.js';
import { jsonResponse } from '../../src/core/server/http-types.js';
import type { Router } from '../../src/core/server/router.js';
import { createWsAdapter, type WsAdapter } from '../../src/core/server/ws-adapter.js';
import { createWsHub, type WsHub } from '../../src/core/server/ws-hub.js';

const SILENT_SINK: LogSink = { name: 'silencieux', write: () => undefined };
const NOOP_ROUTER: Router = { handle: () => Promise.resolve(jsonResponse(200, { ok: true })) };

function collect(socket: WebSocket) {
  const received: Record<string, unknown>[] = [];

  socket.on('message', (data: Buffer) => {
    received.push(JSON.parse(data.toString('utf8')) as Record<string, unknown>);
  });

  return {
    received,
    async waitFor(count: number): Promise<Record<string, unknown>[]> {
      const deadline = Date.now() + 2_000;
      while (received.length < count) {
        if (Date.now() > deadline) {
          throw new Error(
            `${String(count)} message(s) attendu(s), ${String(received.length)} reçu(s)`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return received;
    },
  };
}

function tryConnect(url: string, options: WebSocket.ClientOptions = {}): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new WebSocket(url, options);
    const settle = (opened: boolean): void => {
      socket.removeAllListeners();
      if (socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
      resolve(opened);
    };

    socket.once('open', () => {
      settle(true);
    });
    socket.once('error', () => {
      settle(false);
    });
    socket.once('unexpected-response', () => {
      settle(false);
    });
  });
}

function waitForClose(socket: WebSocket): Promise<number> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('connexion toujours ouverte'));
    }, 2_000);

    socket.once('close', (code: number) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
}

describe('createWsAdapter', () => {
  let bus: EventBus<AppEvents>;
  let hub: WsHub;
  let adapter: WsAdapter;
  let server: HttpServer;
  let port: number;
  const opened: WebSocket[] = [];

  beforeEach(async () => {
    bus = createEventBus<AppEvents>();
    const logger = createLogger({ level: 'error', sinks: [SILENT_SINK] });

    hub = createWsHub({
      bus,
      getConfig: () => DEFAULT_CONFIG,
      getSnapshot: () => ({
        counter: createInitialState({ initialMs: 43_200_000, now: 1_000 }),
        twitch: { status: 'ready' },
      }),
      clock: { now: () => 1_000, monotonicMs: () => 0 },
      timers: {
        setInterval: (handler, ms) => setInterval(handler, ms).unref() as unknown as number,
        clearInterval: () => undefined,
      },
      getPort: () => port,
      getWsPort: () => port,
      appVersion: '0.1.0',
      logger,
    });
    hub.start();

    adapter = createWsAdapter({ hub, logger, path: '/ws', maxPayloadBytes: 4_096 });

    server = createHttpServer({
      router: NOOP_ROUTER,
      host: '127.0.0.1',
      port: 0,
      portFallbackAttempts: 0,
      maxBodyBytes: 65_536,
      logger,
      onUpgrade: adapter.handleUpgrade,
    });

    port = await server.start();
  });

  afterEach(async () => {
    for (const socket of opened.splice(0)) {
      socket.removeAllListeners();
      if (socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
    }
    await adapter.close();
    hub.stop();
    await server.stop();
  });

  function connect(options: WebSocket.ClientOptions = {}): WebSocket {
    const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/ws`, options);
    opened.push(socket);
    return socket;
  }

  it('accueille un client sur le même port que le serveur HTTP', async () => {
    const messages = collect(connect());
    const [hello] = await messages.waitFor(1);

    expect(hello?.['type']).toBe('hello');
    expect(hello?.['port']).toBe(port);
  });

  it('transmet ensuite un instantané complet', async () => {
    const messages = collect(connect());

    expect((await messages.waitFor(2))[1]?.['type']).toBe('state');
  });

  it('diffuse un événement du bus au client réel', async () => {
    const messages = collect(connect());
    await messages.waitFor(2);

    bus.emit('twitch:status', { status: 'reconnecting', detail: 'session perdue' });

    expect((await messages.waitFor(3))[2]).toMatchObject({
      type: 'twitch:status',
      status: 'reconnecting',
    });
  });

  it('refuse un chemin autre que /ws', async () => {
    expect(await tryConnect(`ws://127.0.0.1:${String(port)}/autre`)).toBe(false);
  });

  it('refuse une poignée de main dont le Host n’est pas local', async () => {
    const refused = await tryConnect(`ws://127.0.0.1:${String(port)}/ws`, {
      headers: { host: 'evil.com' },
    });

    expect(refused).toBe(false);
  });

  it('ferme une connexion dont l’origine est étrangère', async () => {
    const socket = connect({ origin: 'https://evil.com' });

    expect(await waitForClose(socket)).toBe(1008);
  });

  it("accepte l'absence d'origine, cas d'OBS", async () => {
    const messages = collect(connect());
    expect((await messages.waitFor(1))[0]?.['type']).toBe('hello');
  });

  it('ferme la connexion sur un message hors protocole', async () => {
    const socket = connect();
    const messages = collect(socket);
    await messages.waitFor(2);

    socket.send(JSON.stringify({ type: 'reset-counter' }));

    expect(await waitForClose(socket)).toBeGreaterThan(0);
  });

  it('coupe une trame dépassant le plafond', async () => {
    const socket = connect();
    const messages = collect(socket);
    await messages.waitFor(2);

    socket.send('x'.repeat(8_192));

    expect(await waitForClose(socket)).toBeGreaterThan(0);
  });

  it('ferme les connexions restantes à l’arrêt', async () => {
    const socket = connect();
    const messages = collect(socket);
    await messages.waitFor(1);

    const closed = waitForClose(socket);
    await adapter.close();

    expect(await closed).toBeGreaterThan(0);
  });
});
