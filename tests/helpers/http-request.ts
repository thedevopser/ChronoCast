/**
 * Fabrique de requêtes normalisées pour les tests.
 *
 * Le routeur et les gardes travaillent sur une `HttpRequest` déjà normalisée par
 * l'adaptateur `node:http` — corps lu, en-têtes en minuscules, chemin décodé.
 * Les tester ne demande donc aucun socket : il suffit de construire l'objet.
 */

import type { HttpRequest } from '../../src/core/server/http-types.js';

export interface RequestOverrides {
  readonly method?: string;
  readonly path?: string;
  readonly query?: Record<string, string>;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}

/** Requête minimale valide : `GET /` depuis la boucle locale. */
export function makeRequest(overrides: RequestOverrides = {}): HttpRequest {
  const headers: Record<string, string> = {
    host: '127.0.0.1:3777',
    ...(overrides.headers ?? {}),
  };

  const query = new URLSearchParams(overrides.query ?? {});

  return {
    method: overrides.method ?? 'GET',
    path: overrides.path ?? '/',
    query,
    headers,
    body: overrides.body ?? '',
  };
}
