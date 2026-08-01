/**
 * Aiguillage des requêtes.
 *
 * Le routeur est le seul chemin par lequel une requête entre dans l'application.
 * C'est donc le seul endroit où les gardes de sécurité peuvent être rendues
 * inévitables : posées ici, en amont de toute résolution de route, aucune route
 * ajoutée plus tard ne peut les oublier.
 *
 * L'ordre a été choisi, il n'est pas accidentel :
 *
 *   1. **`Host`** — refuse sans rien exécuter, y compris la lecture d'un fichier.
 *   2. **Jeton CSRF** — avant même de savoir si la route existe. Répondre `404` à
 *      une mutation non authentifiée dessinerait la carte de l'API à qui la
 *      demande ; un `403` uniforme n'apprend rien.
 *   3. **Résolution** — API, puis pages, puis ressources statiques.
 *   4. **En-têtes de sécurité** — appliqués à la sortie, sur toutes les réponses
 *      sans exception, y compris les erreurs.
 *
 * Le routeur ne connaît rien du métier : il reçoit ses routes en paramètre.
 */

import type { Logger } from '../logging/logger.js';
import {
  errorResponse,
  type HttpRequest,
  type HttpResponse,
} from './http-types.js';
import type { PageHandler } from './routes/pages.js';
import { checkCsrf } from './security/csrf.js';
import { withSecurityHeaders } from './security/headers.js';
import { checkHost } from './security/host-guard.js';
import type { StaticHandler } from './static-handler.js';

export type RouteHandler = (request: HttpRequest) => Promise<HttpResponse> | HttpResponse;

export interface Route {
  /** Méthode exacte, en majuscules. */
  readonly method: string;
  /** Chemin exact. Aucune route de ChronoCast n'a de segment variable. */
  readonly path: string;
  readonly handler: RouteHandler;
}

export interface Router {
  handle(request: HttpRequest): Promise<HttpResponse>;
}

export interface RouterOptions {
  readonly routes: readonly Route[];
  readonly pageHandler: PageHandler;
  readonly staticHandler: StaticHandler;
  /** Lu à chaque requête : le jeton est engendré au démarrage et peut changer. */
  readonly getCsrfToken: () => string;
  readonly logger: Logger;
}

/** Préfixe réservé à l'API. Tout ce qui commence ainsi ne touche jamais au disque. */
const API_PREFIX = '/api/';

/** Retire la barre oblique finale, sauf pour la racine. */
function normalizePath(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}

/**
 * Retire le corps d'une réponse en conservant les en-têtes.
 *
 * `content-length` reste annoncé : c'est tout l'intérêt d'un `HEAD`, savoir ce
 * que pèserait la ressource sans la télécharger.
 */
function stripBody(response: HttpResponse): HttpResponse {
  const length =
    typeof response.body === 'string'
      ? Buffer.byteLength(response.body, 'utf8')
      : response.body.byteLength;

  return {
    ...response,
    headers: { ...response.headers, 'content-length': String(length) },
    body: '',
  };
}

export function createRouter(options: RouterOptions): Router {
  const { routes, pageHandler, staticHandler, getCsrfToken, logger } = options;
  const scoped = logger.child('router');

  /** Méthodes acceptées pour un chemin donné, pour l'en-tête `Allow` d'un 405. */
  function methodsFor(path: string): string[] {
    return routes.filter((route) => route.path === path).map((route) => route.method);
  }

  async function dispatch(request: HttpRequest, method: string): Promise<HttpResponse> {
    const path = normalizePath(request.path);

    if (path.startsWith(API_PREFIX)) {
      const route = routes.find((entry) => entry.path === path && entry.method === method);
      if (route !== undefined) {
        return await route.handler(request);
      }

      const allowed = methodsFor(path);
      if (allowed.length > 0) {
        return {
          ...errorResponse(405, 'method_not_allowed', 'Méthode non autorisée sur cette route.'),
          headers: {
            'content-type': 'application/json; charset=utf-8',
            allow: allowed.join(', '),
          },
        };
      }

      return errorResponse(404, 'route_not_found', 'Route inconnue.');
    }

    // Les pages d'abord : elles seules savent injecter le jeton. Un `null`
    // signifie « ce chemin ne m'appartient pas », et le statique prend la suite.
    const page = await pageHandler.serve(request.path);
    if (page !== null) {
      return page;
    }

    return await staticHandler.serve(request.path);
  }

  return {
    async handle(request: HttpRequest): Promise<HttpResponse> {
      const hostRefusal = checkHost(request);
      if (hostRefusal !== null) {
        scoped.warning('requête refusée : Host non local', { path: request.path });
        return withSecurityHeaders(hostRefusal);
      }

      const csrfRefusal = checkCsrf(request, getCsrfToken());
      if (csrfRefusal !== null) {
        scoped.warning('mutation refusée : jeton absent ou invalide', {
          path: request.path,
          method: request.method,
        });
        return withSecurityHeaders(csrfRefusal);
      }

      const method = request.method.toUpperCase();

      try {
        // `HEAD` emprunte le chemin de `GET` : traiter les deux séparément
        // finirait par les faire diverger.
        const response = await dispatch(request, method === 'HEAD' ? 'GET' : method);
        return withSecurityHeaders(method === 'HEAD' ? stripBody(response) : response);
      } catch (error) {
        // Le détail va dans les logs, jamais dans la réponse : un message
        // d'exception renseigne sur l'implémentation autant que sur la panne.
        scoped.error('route en échec', {
          path: request.path,
          method: request.method,
          cause: error,
        });

        return withSecurityHeaders(
          errorResponse(500, 'internal_error', 'Erreur interne : consultez les journaux.'),
        );
      }
    },
  };
}
