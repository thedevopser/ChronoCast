/**
 * Adaptateur `node:http`.
 *
 * C'est la seule partie du serveur qui touche à un socket. Tout ce qu'elle fait —
 * lire un corps, appeler le routeur, écrire une réponse — est mécanique ; ce qui
 * compte, ce sont ses trois refus.
 *
 *   - **Elle ne se lie qu'à la boucle locale.** Écouter sur `0.0.0.0` offrirait à
 *     tout le réseau du streamer un panneau d'administration capable de remettre
 *     son compteur à zéro. Ce n'est pas une préférence, c'est la raison pour
 *     laquelle l'application peut se passer d'authentification.
 *   - **Elle plafonne le corps des requêtes.** Sans plafond, un seul POST suffit
 *     à saturer la mémoire du processus, et le subathon s'arrête.
 *   - **Elle survit à un port déjà pris.** 3777 est un port banal ; un démarrage
 *     qui échoue sans explication est un incident que personne ne saura
 *     diagnostiquer, et le repli sur le port suivant coûte trois lignes.
 *
 * Le port effectivement retenu est publié : l'URL de l'overlay à coller dans OBS
 * en dépend.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';

import type { Logger } from '../logging/logger.js';
import type { HttpRequest, HttpResponse } from './http-types.js';
import type { Router } from './router.js';

export type UpgradeHandler = (request: IncomingMessage, socket: Duplex, head: Buffer) => void;

export interface HttpServer {
  /** Démarre l'écoute et renvoie le port retenu, éventuellement issu du repli. */
  start(): Promise<number>;

  /** Arrête l'écoute. Sans effet si le serveur n'a jamais démarré. */
  stop(): Promise<void>;

  /** Port retenu, ou `null` tant que le serveur n'écoute pas. */
  getPort(): number | null;

  /**
   * Serveur Node sous-jacent.
   *
   * Exposé pour le seul hub WebSocket en mode `shared`, qui doit s'y accrocher
   * pour intercepter les requêtes d'`upgrade`. Aucun autre usage n'est prévu.
   */
  getNodeServer(): Server;
}

export interface HttpServerOptions {
  readonly router: Router;
  /** Adresse d'écoute. Restreinte à la boucle locale par le schéma de configuration. */
  readonly host: string;
  readonly port: number;
  /** Nombre de ports consécutifs essayés si celui demandé est déjà pris. */
  readonly portFallbackAttempts: number;
  /** Plafond du corps des requêtes, en octets. */
  readonly maxBodyBytes: number;
  readonly logger: Logger;
  /** Branche le hub WebSocket en mode `shared`. */
  readonly onUpgrade?: UpgradeHandler;
}

/** Réponse de dernier recours, écrite sans passer par le routeur. */
const BODY_TOO_LARGE = JSON.stringify({
  error: 'Requête trop volumineuse.',
  code: 'payload_too_large',
});

const INTERNAL_ERROR = JSON.stringify({
  error: 'Erreur interne : consultez les journaux.',
  code: 'internal_error',
});

/**
 * Normalise une requête Node.
 *
 * Le chemin est décodé **une seule fois**. Décoder deux fois transformerait
 * `%252e%252e` en `..` et rouvrirait la traversée que le service statique
 * referme : c'est une erreur classique, et silencieuse.
 */
function normalizeRequest(incoming: IncomingMessage, body: string): HttpRequest {
  // La base est fictive : seuls le chemin et la requête nous intéressent, et
  // `URL` exige une base pour analyser une cible relative.
  const url = new URL(incoming.url ?? '/', 'http://127.0.0.1');

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (value === undefined) {
      continue;
    }
    // Un en-tête reçu plusieurs fois arrive sous forme de tableau. Le replier
    // avec des virgules reproduit ce que fait déjà `node:http` pour les autres,
    // et les gardes traitent une valeur repliée comme une anomalie.
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

/**
 * Lit le corps en refusant de dépasser le plafond.
 *
 * Le refus intervient **pendant** la lecture, pas après : accumuler puis mesurer
 * reviendrait à accepter exactement ce que le plafond doit empêcher.
 *
 * Une fois le plafond franchi, ce qui reste est purgé au fil de l'eau plutôt que
 * conservé, et la socket n'est **pas** détruite : la détruire empêcherait
 * d'écrire la réponse `413`, et le client ne verrait qu'une connexion coupée,
 * sans savoir pourquoi.
 */
function readBody(incoming: IncomingMessage, maxBytes: number): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    function onData(chunk: Buffer): void {
      size += chunk.byteLength;
      if (size > maxBytes) {
        incoming.removeListener('data', onData);
        // `resume()` consomme et jette le reste : la mémoire reste bornée, et le
        // flux atteint sa fin proprement au lieu d'être coupé net.
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
              // La connexion est close plutôt que réutilisée : le client peut
              // encore être en train d'émettre, et rien ne justifie de garder
              // ouvert un canal qui vient d'être refusé.
              connection: 'close',
            },
            body: BODY_TOO_LARGE,
          });
          return;
        }

        writeResponse(outgoing, await router.handle(normalizeRequest(incoming, body)));
      } catch (error) {
        // Le routeur intercepte déjà les erreurs de route ; parvenir ici signale
        // une panne de la couche transport. Le serveur doit rester debout : une
        // requête ratée ne met pas fin au subathon.
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

  /** Une tentative d'écoute. Résout à `null` si le port est déjà pris. */
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
      // Le port 0 demande une attribution automatique : il n'y a alors rien à
      // replier, le système garantit un port libre.
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
        // Sans cela, une connexion persistante — le WebSocket de l'overlay, par
        // exemple — retiendrait la fermeture jusqu'à son expiration.
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
