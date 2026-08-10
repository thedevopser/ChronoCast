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
  readonly method: string;
  readonly path: string;
  readonly handler: RouteHandler;
}

export interface Router {
  handle(request: HttpRequest): Promise<HttpResponse>;
}

export interface RouterOptions {
  readonly routes: readonly Route[];
  readonly pageHandler: PageHandler;
  readonly customCssHandler: PageHandler;
  readonly staticHandler: StaticHandler;
  readonly getCsrfToken: () => string;
  readonly logger: Logger;
}

const API_PREFIX = '/api/';

function normalizePath(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}

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
  const { routes, pageHandler, customCssHandler, staticHandler, getCsrfToken, logger } = options;
  const scoped = logger.child('router');

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

    const page = await pageHandler.serve(request.path);
    if (page !== null) {
      return page;
    }

    const customCss = await customCssHandler.serve(request.path);
    if (customCss !== null) {
      return customCss;
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
        const response = await dispatch(request, method === 'HEAD' ? 'GET' : method);
        return withSecurityHeaders(method === 'HEAD' ? stripBody(response) : response);
      } catch (error) {
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
