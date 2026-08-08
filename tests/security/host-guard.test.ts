import { describe, expect, it } from 'vitest';

import { checkHost, isLoopbackHost } from '../../src/core/server/security/host-guard.js';
import { makeRequest } from '../helpers/http-request.js';

describe('isLoopbackHost', () => {
  describe('accepte les formes légitimes', () => {
    const accepted = [
      '127.0.0.1',
      '127.0.0.1:3777',
      'localhost',
      'localhost:3777',
      '[::1]',
      '[::1]:3777',
      'LOCALHOST',
      'LocalHost:3777',
    ];

    it.each(accepted)('accepte %s', (host) => {
      expect(isLoopbackHost(host)).toBe(true);
    });
  });

  describe('rejette les formes trompeuses', () => {
    const rejected = [
      'evil.com',
      'evil.com:3777',
      '127.0.0.1.evil.com',
      'localhost.evil.com',
      '127.0.0.1.evil.com:3777',
      'evil.com/127.0.0.1',
      'notlocalhost',
      'xlocalhost',
      '127.0.0.1@evil.com',
      'localhost@evil.com',
      '127.0.0.2',
      '127.1.1.1',
      '0.0.0.0',
      '192.168.1.10',
      '[::]',
      '127.0.0.1,evil.com',
      'localhost, evil.com',
      '127.0.0.1:0',
      '127.0.0.1:99999',
      '127.0.0.1:abc',
      '127.0.0.1:',
      '',
      '   ',
      'localhost ',
      ' localhost',
      'local\thost',
      '::1',
      '::1:3777',
    ];

    it.each(rejected)('rejette %j', (host) => {
      expect(isLoopbackHost(host)).toBe(false);
    });
  });

  it("rejette un en-tête Host absent", () => {
    expect(isLoopbackHost(undefined)).toBe(false);
  });
});

describe('checkHost', () => {
  it('laisse passer une requête de la boucle locale', () => {
    expect(checkHost(makeRequest())).toBeNull();
  });

  it('répond 403 sur un Host étranger', () => {
    const response = checkHost(makeRequest({ headers: { host: 'evil.com' } }));

    expect(response).not.toBeNull();
    expect(response?.status).toBe(403);
  });

  it("ne révèle pas la valeur reçue dans le corps de la réponse", () => {
    const response = checkHost(makeRequest({ headers: { host: '<script>alert(1)</script>' } }));

    expect(response?.status).toBe(403);
    expect(String(response?.body)).not.toContain('script');
  });

  it('répond 403 lorsque le Host est absent', () => {
    const request = makeRequest();
    const headers: Record<string, string> = { ...request.headers };
    delete headers['host'];

    expect(checkHost({ ...request, headers })?.status).toBe(403);
  });
});
