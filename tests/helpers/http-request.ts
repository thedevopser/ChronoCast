import type { HttpRequest } from '../../src/core/server/http-types.js';

export interface RequestOverrides {
  readonly method?: string;
  readonly path?: string;
  readonly query?: Record<string, string>;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}

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
