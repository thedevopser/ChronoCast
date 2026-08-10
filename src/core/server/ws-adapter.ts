import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';

import { WebSocketServer, type WebSocket } from 'ws';

import type { Logger } from '../logging/logger.js';
import { isLoopbackHost } from './security/host-guard.js';
import type { HubSocket, WsHub } from './ws-hub.js';

export interface WsAdapter {
  readonly handleUpgrade: (request: IncomingMessage, socket: Duplex, head: Buffer) => void;

  listen(host: string, port: number): Promise<number>;

  close(): Promise<void>;
}

export interface WsAdapterOptions {
  readonly hub: WsHub;
  readonly logger: Logger;
  readonly path: string;
  readonly maxPayloadBytes: number;
}

function wrap(socket: WebSocket): HubSocket {
  return {
    send(data: string): void {
      socket.send(data);
    },
    close(code?: number, reason?: string): void {
      socket.close(code, reason);
    },
    ping(): void {
      socket.ping();
    },
    onMessage(handler): void {
      socket.on('message', (data: Buffer) => {
        handler(data.toString('utf8'));
      });
    },
    onClose(handler): void {
      socket.on('close', handler);
    },
    onPong(handler): void {
      socket.on('pong', handler);
    },
  };
}

function rejectHandshake(socket: Duplex, status: number, reason: string): void {
  socket.write(`HTTP/1.1 ${String(status)} ${reason}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

export function createWsAdapter(options: WsAdapterOptions): WsAdapter {
  const { hub, logger, path, maxPayloadBytes } = options;
  const scoped = logger.child('ws-adapter');

  const wss = new WebSocketServer({ noServer: true, maxPayload: maxPayloadBytes });

  let standalone: Server | null = null;

  function handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    if (!isLoopbackHost(request.headers.host)) {
      scoped.warning('poignée de main WebSocket refusée : Host non local');
      rejectHandshake(socket, 403, 'Forbidden');
      return;
    }

    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== path) {
      rejectHandshake(socket, 404, 'Not Found');
      return;
    }

    wss.handleUpgrade(request, socket, head, (client) => {
      client.on('error', (error: unknown) => {
        scoped.warning('socket WebSocket en erreur', { cause: error });
        client.terminate();
      });

      const origin = request.headers.origin;
      hub.accept(wrap(client), origin === undefined ? {} : { origin });
    });
  }

  return {
    handleUpgrade,

    listen(host: string, port: number): Promise<number> {
      return new Promise((resolve, reject) => {
        const server = createServer((_request, response) => {
          response.writeHead(426, { 'content-type': 'text/plain; charset=utf-8' });
          response.end('Upgrade requis.');
        });

        server.on('upgrade', handleUpgrade);
        server.once('error', reject);
        server.listen(port, host, () => {
          const address = server.address();
          if (address === null || typeof address === 'string') {
            reject(new Error('adresse d’écoute inattendue'));
            return;
          }
          standalone = server;
          scoped.info('serveur WebSocket autonome à l’écoute', { host, port: address.port });
          resolve(address.port);
        });
      });
    },

    close(): Promise<void> {
      for (const client of wss.clients) {
        client.terminate();
      }

      return new Promise((resolve, reject) => {
        wss.close(() => {
          if (standalone === null) {
            resolve();
            return;
          }
          standalone.close((error) => {
            standalone = null;
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        });
      });
    },
  };
}
