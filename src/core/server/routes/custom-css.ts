import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

import type { Logger } from '../../logging/logger.js';
import type { HttpResponse } from '../http-types.js';

const ROUTE_PATH = '/custom.css';
const FILE_NAME = 'custom.css';

const NOT_FOUND_BODY = 'Ressource introuvable.';

export interface CustomCssHandler {
  serve(pathname: string): Promise<HttpResponse | null>;
}

export interface CustomCssHandlerOptions {
  readonly dataDirectory: string;
  readonly isEnabled: () => boolean;
  readonly logger: Logger;
}

function isInside(root: string, candidate: string): boolean {
  const difference = relative(root, candidate);
  return difference !== '' && !difference.startsWith('..') && !isAbsolute(difference);
}

function normalize(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}

export function createCustomCssHandler(options: CustomCssHandlerOptions): CustomCssHandler {
  const { isEnabled, logger } = options;
  const root = resolve(options.dataDirectory);
  const filePath = join(root, FILE_NAME);
  const scoped = logger.child('custom-css');

  function notFound(): HttpResponse {
    return {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      body: NOT_FOUND_BODY,
    };
  }

  let canonicalRoot: Promise<string> | null = null;
  function resolveCanonicalRoot(): Promise<string> {
    canonicalRoot ??= realpath(root).catch(() => root);
    return canonicalRoot;
  }

  return {
    async serve(pathname: string): Promise<HttpResponse | null> {
      if (normalize(pathname) !== ROUTE_PATH) {
        return null;
      }

      if (!isEnabled()) {
        return notFound();
      }

      try {
        const canonical = await realpath(filePath);
        if (!isInside(await resolveCanonicalRoot(), canonical)) {
          scoped.warning('feuille personnelle refusée : lien sortant du répertoire de données');
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
            'content-type': 'text/css; charset=utf-8',
            'content-length': String(content.byteLength),
            'cache-control': 'no-store',
          },
          body: content,
        };
      } catch (error) {
        scoped.debug('feuille personnelle illisible', { cause: error });
        return notFound();
      }
    },
  };
}
