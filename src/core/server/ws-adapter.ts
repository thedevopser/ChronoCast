/**
 * Adaptateur `ws` : le seul fichier de ChronoCast à connaître la bibliothèque.
 *
 * Toute la logique du canal vit dans `ws-hub.ts`, qui ne manipule qu'une
 * interface et se vérifie donc avec des sockets doubles, sans port ni attente.
 * Ce qui reste ici est du câblage — et une garde.
 *
 * **La garde est indispensable.** Une connexion WebSocket ne traverse pas le
 * routeur : elle arrive par l'événement `upgrade` du serveur HTTP, en amont de
 * tout ce qui protège l'API. Sans contrôle d'`Host` posé une seconde fois ici, le
 * rebinding DNS refermé côté HTTP resterait grand ouvert côté WebSocket, et une
 * page tierce lirait l'état du compteur en direct.
 *
 * Deux modes de fonctionnement, dictés par la configuration :
 *
 *   - `shared` — accroché au serveur HTTP, un seul port à configurer et à retenir
 *     pour OBS. C'est le mode par défaut ;
 *   - `separate` — serveur autonome, prévu pour les rares cas où le port HTTP est
 *     déjà utilisé par autre chose.
 */

import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';

import { WebSocketServer, type WebSocket } from 'ws';

import type { Logger } from '../logging/logger.js';
import { isLoopbackHost } from './security/host-guard.js';
import type { HubSocket, WsHub } from './ws-hub.js';

export interface WsAdapter {
  /**
   * Traite une requête d'`upgrade`.
   *
   * Passé tel quel à `HttpServerOptions.onUpgrade` en mode `shared`. La méthode
   * est liée : elle peut circuler sans son objet.
   */
  readonly handleUpgrade: (request: IncomingMessage, socket: Duplex, head: Buffer) => void;

  /** Démarre un serveur autonome en mode `separate`, et renvoie le port retenu. */
  listen(host: string, port: number): Promise<number>;

  /** Ferme les connexions et le serveur autonome s'il existe. */
  close(): Promise<void>;
}

export interface WsAdapterOptions {
  readonly hub: WsHub;
  readonly logger: Logger;
  /** Chemin de la poignée de main. Toute autre cible est refusée. */
  readonly path: string;
  /**
   * Plafond d'une trame entrante.
   *
   * Appliqué par `ws` lui-même, donc **avant** que la charge utile n'atteigne la
   * mémoire de l'application. Le hub replafonne ensuite le message désérialisé :
   * la première barrière protège le processus, la seconde le protocole.
   */
  readonly maxPayloadBytes: number;
}

/** Enveloppe une socket `ws` dans l'interface réduite que connaît le hub. */
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

/** Réponse d'échec de poignée de main : rien de plus que le strict nécessaire. */
function rejectHandshake(socket: Duplex, status: number, reason: string): void {
  socket.write(`HTTP/1.1 ${String(status)} ${reason}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

export function createWsAdapter(options: WsAdapterOptions): WsAdapter {
  const { hub, logger, path, maxPayloadBytes } = options;
  const scoped = logger.child('ws-adapter');

  // `noServer` : c'est nous qui décidons quelles requêtes méritent une poignée de
  // main, et non `ws`. C'est ce qui rend les gardes possibles.
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
      // Indispensable : sans écouteur d'`error`, une trame malformée ou trop
      // longue devient une exception non traitée qui abat le processus Node —
      // et donc le subathon. C'est exactement ce qu'une page hostile chercherait
      // à provoquer.
      client.on('error', (error: unknown) => {
        scoped.warning('socket WebSocket en erreur', { cause: error });
        client.terminate();
      });

      // L'origine est vérifiée par le hub, qui referme proprement avec un code
      // de fermeture : le client saura qu'il a été refusé, pas déconnecté.
      // OBS n'en envoie pas : la propriété est omise plutôt que mise à
      // `undefined`, distinction que `exactOptionalPropertyTypes` impose.
      const origin = request.headers.origin;
      hub.accept(wrap(client), origin === undefined ? {} : { origin });
    });
  }

  return {
    handleUpgrade,

    listen(host: string, port: number): Promise<number> {
      return new Promise((resolve, reject) => {
        const server = createServer((_request, response) => {
          // Le serveur autonome ne sert que des `upgrade` : une requête HTTP
          // ordinaire n'a rien à y faire.
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
        // `terminate` et non `close` : à l'arrêt, on ne négocie pas une
        // fermeture propre avec un client qui pourrait ne jamais répondre.
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
