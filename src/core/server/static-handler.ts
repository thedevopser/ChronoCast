import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';

import type { Logger } from '../logging/logger.js';
import type { HttpResponse } from './http-types.js';

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const NOT_FOUND_BODY = 'Ressource introuvable.';

export interface StaticHandler {
  serve(pathname: string): Promise<HttpResponse>;
}

export interface StaticHandlerOptions {
  readonly rootDirectory: string;
  readonly logger: Logger;
}

export function contentTypeFor(filePath: string): string | null {
  return CONTENT_TYPES[extname(filePath).toLowerCase()] ?? null;
}

export function resolveStaticPath(rootDirectory: string, pathname: string): string | null {
  if (pathname.includes('\0') || pathname.includes('%') || pathname.includes('\\')) {
    return null;
  }

  if (contentTypeFor(pathname) === null) {
    return null;
  }

  const relativePath = pathname.replace(/^\/+/, '');
  if (relativePath === '' || isAbsolute(relativePath)) {
    return null;
  }

  const root = resolve(rootDirectory);
  const candidate = resolve(join(root, relativePath));

  return isInside(root, candidate) ? candidate : null;
}

function isInside(root: string, candidate: string): boolean {
  if (candidate === root) {
    return false;
  }
  const difference = relative(root, candidate);
  return difference !== '' && !difference.startsWith('..') && !isAbsolute(difference);
}

export function createStaticHandler(options: StaticHandlerOptions): StaticHandler {
  const { logger } = options;
  const root = resolve(options.rootDirectory);
  const scoped = logger.child('static');

  let canonicalRoot: Promise<string> | null = null;
  function resolveCanonicalRoot(): Promise<string> {
    canonicalRoot ??= realpath(root).catch(() => root);
    return canonicalRoot;
  }

  function notFound(): HttpResponse {
    return {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      body: NOT_FOUND_BODY,
    };
  }

  return {
    async serve(pathname: string): Promise<HttpResponse> {
      const filePath = resolveStaticPath(root, pathname);

      if (filePath === null) {
        scoped.warning('chemin statique refusé', { pathname });
        return notFound();
      }

      try {
        const canonical = await realpath(filePath);
        if (!isInside(await resolveCanonicalRoot(), canonical)) {
          scoped.warning('lien symbolique sortant de la racine refusé', { pathname });
          return notFound();
        }

        const stats = await stat(canonical);
        if (!stats.isFile()) {
          return notFound();
        }

        const content = await readFile(canonical);

        return {
          status: 200,
          headers: {
            'content-type': contentTypeFor(canonical) ?? 'text/plain; charset=utf-8',
            'content-length': String(content.byteLength),
          },
          body: content,
        };
      } catch (error) {
        scoped.debug('ressource statique illisible', { pathname, cause: error });
        return notFound();
      }
    },
  };
}
