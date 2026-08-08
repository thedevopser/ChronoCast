import { randomBytes, timingSafeEqual } from 'node:crypto';

import { errorResponse, type HttpRequest, type HttpResponse } from '../http-types.js';

export const CSRF_HEADER = 'x-chronocast-token';

export const CSRF_PLACEHOLDER = '__CHRONOCAST_CSRF__';

const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

export function createCsrfToken(): string {
  return randomBytes(32).toString('hex');
}

export function isMutatingMethod(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

export function verifyCsrfToken(expected: string, provided: string | undefined): boolean {
  if (expected === '' || provided === undefined || provided === '') {
    return false;
  }

  const expectedBytes = Buffer.from(expected, 'utf8');
  const providedBytes = Buffer.from(provided, 'utf8');

  if (expectedBytes.length !== providedBytes.length) {
    return false;
  }

  return timingSafeEqual(expectedBytes, providedBytes);
}

export function checkCsrf(request: HttpRequest, expectedToken: string): HttpResponse | null {
  if (!isMutatingMethod(request.method)) {
    return null;
  }

  if (verifyCsrfToken(expectedToken, request.headers[CSRF_HEADER])) {
    return null;
  }

  return errorResponse(
    403,
    'csrf_token_missing',
    'Jeton de session absent ou invalide : rechargez le panneau d’administration.',
  );
}

const ALLOWED_ORIGIN_PROTOCOLS: ReadonlySet<string> = new Set(['http:']);

const ALLOWED_ORIGIN_HOSTNAMES: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function isAllowedWebSocketOrigin(origin: string | undefined): boolean {
  if (origin === undefined) {
    return true;
  }

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  return (
    ALLOWED_ORIGIN_PROTOCOLS.has(parsed.protocol) && ALLOWED_ORIGIN_HOSTNAMES.has(parsed.hostname)
  );
}
