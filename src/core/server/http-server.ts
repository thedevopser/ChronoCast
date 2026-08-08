import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';

import type { Logger } from '../logging/logger.js';
import type { HttpRequest, HttpResponse } from './http-types.js';
import type { Router } from './router.js';

export type UpgradeHandler = (request: IncomingMessage, socket: Duplex, head: Buffer) => void;

export interface HttpServer {
  start(): Promise<number>;

  stop(): Promise<void>;

  getPort(): number | null;

  getNodeServer(): Server;
}

export interface HttpServerOptions {
  readonly router: Router;
  readonly host: string;
  readonly port: number;
  readonly portFallbackAttempts: number;
  readonly maxBodyBytes: number;
  readonly logger: Logger;
  readonly onUpgrade?: UpgradeHandler;
}

const BODY_TOO_LARGE = JSON.stringify({
  error: 'Requête trop volumineuse.',
  code: 'payload_too_large',
});

const INTERNAL_ERROR = JSON.stringify({
  error: 'Erreur interne : consultez les journaux.',
  code: 'internal_error',
});

function normalizeRequest(incoming: IncomingMessage, body: string): HttpRequest {
  const url = new URL(incoming.url ?? '/', 'http://127.0.0.1');

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (value === undefined) {
      continue;
    }
    headers[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
  }

  return {
    method: incoming.method ?? 'GET',
    path: decodeURIComponent(url.pathname),
    query: url.searchParams,
    headers,
    body,
  };
}

function readBody(incoming: IncomingMessage, maxBytes: number): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    function onData(chunk: Buffer): void {
      size += chunk.byteLength;
      if (size > maxBytes) {
        incoming.removeListener('data', onData);
        incoming.resume();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    }

    incoming.on('data', onData);

    incoming.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });

    incoming.on('error', reject);
  });
}

function writeResponse(outgoing: ServerResponse, response: HttpResponse): void {
  const body =
    typeof response.body === 'string' ? Buffer.from(response.body, 'utf8') : Buffer.from(response.body);

  const headers: Record<string, string> = { ...response.headers };
  headers['content-length'] = String(body.byteLength);

  outgoing.writeHead(response.status, headers);
  outgoing.end(body);
}

export function createHttpServer(options: HttpServerOptions): HttpServer {
  const { router, host, port, portFallbackAttempts, maxBodyBytes, logger, onUpgrade } = options;
  const scoped = logger.child('http');

  let boundPort: number | null = null;

  const server = createServer((incoming, outgoing) => {
    void (async () => {
      try {
        const body = await readBody(incoming, maxBodyBytes);

        if (body === null) {
          scoped.warning('corps de requête refusé : plafond dépassé', {
            path: incoming.url,
            maxBodyBytes,
          });
          writeResponse(outgoing, {
            status: 413,
            headers: {
              'content-type': 'application/json; charset=utf-8',
              connection: 'close',
            },
            body: BODY_TOO_LARGE,
          });
          return;
        }

        writeResponse(outgoing, await router.handle(normalizeRequest(incoming, body)));
      } catch (error) {
        scoped.error('requête non traitée', { path: incoming.url, cause: error });

        if (!outgoing.headersSent) {
          writeResponse(outgoing, {
            status: 500,
            headers: { 'content-type': 'application/json; charset=utf-8' },
            body: INTERNAL_ERROR,
          });
        } else {
          outgoing.end();
        }
      }
    })();
  });

  if (onUpgrade !== undefined) {
    server.on('upgrade', onUpgrade);
  }

  function listenOnce(candidate: number): Promise<number | null> {
    return new Promise((resolve, reject) => {
      function onError(error: NodeJS.ErrnoException): void {
        server.removeListener('listening', onListening);
        if (error.code === 'EADDRINUSE') {
          resolve(null);
          return;
        }
        reject(error);
      }

      function onListening(): void {
        server.removeListener('error', onError);
        const address = server.address();
        if (address === null || typeof address === 'string') {
          reject(new Error('adresse d’écoute inattendue'));
          return;
        }
        resolve(address.port);
      }

      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(candidate, host);
    });
  }

  return {
    async start(): Promise<number> {
      const attempts = port === 0 ? 1 : portFallbackAttempts + 1;

      for (let offset = 0; offset < attempts; offset += 1) {
        const candidate = port === 0 ? 0 : port + offset;

        if (candidate > 65_535) {
          break;
        }

        const bound = await listenOnce(candidate);
        if (bound !== null) {
          boundPort = bound;
          if (offset > 0) {
            scoped.warning('port occupé, repli sur le suivant', { demandé: port, retenu: bound });
          }
          scoped.info('serveur HTTP à l’écoute', { host, port: bound });
          return bound;
        }
      }

      throw new Error(
        `aucun port disponible : ${String(port)} et les ${String(portFallbackAttempts)} suivants sont occupés`,
      );
    },

    stop(): Promise<void> {
      if (boundPort === null) {
        return Promise.resolve();
      }

      return new Promise((resolve, reject) => {
        server.close((error) => {
          boundPort = null;
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
        server.closeIdleConnections();
      });
    },

    getPort(): number | null {
      return boundPort;
    },

    getNodeServer(): Server {
      return server;
    },
  };
}
