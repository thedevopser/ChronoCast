import { describe, expect, it } from 'vitest';

import {
  CSRF_HEADER,
  checkCsrf,
  createCsrfToken,
  isAllowedWebSocketOrigin,
  isMutatingMethod,
  verifyCsrfToken,
} from '../../src/core/server/security/csrf.js';
import { makeRequest } from '../helpers/http-request.js';

describe('createCsrfToken', () => {
  it('produit un jeton hexadécimal de 32 octets', () => {
    expect(createCsrfToken()).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produit un jeton différent à chaque appel', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => createCsrfToken()));
    expect(tokens.size).toBe(50);
  });
});

describe('isMutatingMethod', () => {
  it.each(['POST', 'PATCH', 'PUT', 'DELETE', 'post', 'patch'])('%s mute', (method) => {
    expect(isMutatingMethod(method)).toBe(true);
  });

  it.each(['GET', 'HEAD', 'OPTIONS', 'get'])('%s ne mute pas', (method) => {
    expect(isMutatingMethod(method)).toBe(false);
  });

  it('considère une méthode inconnue comme mutante', () => {
    expect(isMutatingMethod('TRACE')).toBe(true);
  });
});

describe('verifyCsrfToken', () => {
  const expected = 'a'.repeat(64);

  it('accepte le jeton exact', () => {
    expect(verifyCsrfToken(expected, expected)).toBe(true);
  });

  it('refuse un jeton différent de même longueur', () => {
    expect(verifyCsrfToken(expected, 'b'.repeat(64))).toBe(false);
  });

  it('refuse un jeton de longueur différente sans lever', () => {
    expect(verifyCsrfToken(expected, 'a'.repeat(63))).toBe(false);
    expect(verifyCsrfToken(expected, 'a'.repeat(65))).toBe(false);
  });

  it('refuse un jeton absent ou vide', () => {
    expect(verifyCsrfToken(expected, undefined)).toBe(false);
    expect(verifyCsrfToken(expected, '')).toBe(false);
  });

  it("refuse tout jeton lorsque le jeton attendu est vide", () => {
    expect(verifyCsrfToken('', '')).toBe(false);
    expect(verifyCsrfToken('', 'peu importe')).toBe(false);
  });

  it("n'est pas trompé par des octets non ASCII", () => {
    expect(verifyCsrfToken(expected, 'é'.repeat(64))).toBe(false);
  });
});

describe('checkCsrf', () => {
  const token = createCsrfToken();

  it('laisse passer une lecture sans jeton', () => {
    expect(checkCsrf(makeRequest({ method: 'GET' }), token)).toBeNull();
  });

  it('laisse passer une mutation portant le bon jeton', () => {
    const request = makeRequest({ method: 'POST', headers: { [CSRF_HEADER]: token } });
    expect(checkCsrf(request, token)).toBeNull();
  });

  it('répond 403 sur une mutation sans jeton', () => {
    expect(checkCsrf(makeRequest({ method: 'POST' }), token)?.status).toBe(403);
  });

  it('répond 403 sur une mutation portant un mauvais jeton', () => {
    const request = makeRequest({ method: 'POST', headers: { [CSRF_HEADER]: 'c'.repeat(64) } });
    expect(checkCsrf(request, token)?.status).toBe(403);
  });

  it.each(['PATCH', 'PUT', 'DELETE'])('protège aussi %s', (method) => {
    expect(checkCsrf(makeRequest({ method }), token)?.status).toBe(403);
  });
});

describe('isAllowedWebSocketOrigin', () => {
  it("accepte l'absence d'Origin", () => {
    expect(isAllowedWebSocketOrigin(undefined)).toBe(true);
  });

  it.each([
    'http://127.0.0.1:3777',
    'http://localhost:3777',
    'http://[::1]:3777',
    'http://127.0.0.1',
  ])('accepte %s', (origin) => {
    expect(isAllowedWebSocketOrigin(origin)).toBe(true);
  });

  it.each([
    'https://evil.com',
    'http://evil.com:3777',
    'http://127.0.0.1.evil.com',
    'http://localhost.evil.com',
    'null',
    'file://',
    'not-a-url',
  ])('rejette %s', (origin) => {
    expect(isAllowedWebSocketOrigin(origin)).toBe(false);
  });
});
