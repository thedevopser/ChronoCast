import type { HttpResponse } from '../http-types.js';
import { CSRF_PLACEHOLDER } from '../security/csrf.js';
import type { StaticHandler } from '../static-handler.js';

const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export const WS_PORT_PLACEHOLDER = '__CHRONOCAST_WS_PORT__';

interface PageDefinition {
  readonly file: string;
  readonly requiresToken: boolean;
}

const PAGES: Readonly<Record<string, PageDefinition>> = {
  '/overlay': { file: '/overlay/index.html', requiresToken: false },
  '/admin': { file: '/admin/index.html', requiresToken: true },
  '/setup': { file: '/setup/index.html', requiresToken: true },
};

export interface PageHandler {
  serve(pathname: string): Promise<HttpResponse | null>;
}

export interface PageHandlerOptions {
  readonly staticHandler: StaticHandler;
  readonly getCsrfToken: () => string;
  readonly getWsPort: () => number;
  readonly isSetupCompleted: () => boolean;
}

export function injectCsrfToken(html: string, token: string): string {
  if (!TOKEN_PATTERN.test(token)) {
    throw new Error('jeton CSRF de forme inattendue : injection refusée');
  }
  return html.replaceAll(CSRF_PLACEHOLDER, token);
}

export function injectWsPort(html: string, port: number): string {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('port WebSocket de forme inattendue : injection refusée');
  }
  return html.replaceAll(WS_PORT_PLACEHOLDER, String(port));
}

function normalize(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}

export function createPageHandler(options: PageHandlerOptions): PageHandler {
  const { staticHandler, getCsrfToken, getWsPort, isSetupCompleted } = options;

  return {
    async serve(pathname: string): Promise<HttpResponse | null> {
      const normalized = normalize(pathname);

      if (normalized === '/') {
        return {
          status: 302,
          headers: { location: isSetupCompleted() ? '/admin' : '/setup' },
          body: '',
        };
      }

      const page = PAGES[normalized];
      if (page === undefined) {
        return null;
      }

      const response = await staticHandler.serve(page.file);
      if (response.status !== 200) {
        return response;
      }

      let body = injectWsPort(response.body.toString(), getWsPort());

      if (page.requiresToken) {
        body = injectCsrfToken(body, getCsrfToken());
      }

      return {
        status: 200,
        headers: {
          ...response.headers,
          'content-length': String(Buffer.byteLength(body, 'utf8')),
          'cache-control': page.requiresToken ? 'no-store' : 'no-cache',
        },
        body,
      };
    },
  };
}
