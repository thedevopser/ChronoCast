import { describe, expect, it } from 'vitest';

import {
  parseContentSecurityPolicy,
  securityHeaders,
  withSecurityHeaders,
} from '../../src/core/server/security/headers.js';

describe('securityHeaders', () => {
  const headers = securityHeaders();

  it('interdit le reniflage de type MIME', () => {
    expect(headers['x-content-type-options']).toBe('nosniff');
  });

  it("n'envoie jamais de référent", () => {
    expect(headers['referrer-policy']).toBe('no-referrer');
  });

  it("n'expose aucun en-tête CORS", () => {
    const cors = Object.keys(headers).filter((name) => name.startsWith('access-control-'));
    expect(cors).toEqual([]);
  });

  it('déclare une politique de sécurité du contenu', () => {
    expect(headers['content-security-policy']).toBeTypeOf('string');
  });
});

describe('parseContentSecurityPolicy', () => {
  const directives = parseContentSecurityPolicy(securityHeaders()['content-security-policy'] ?? '');

  it("n'autorise ni unsafe-inline ni unsafe-eval nulle part", () => {
    const flattened = Object.values(directives).flat();
    expect(flattened).not.toContain("'unsafe-inline'");
    expect(flattened).not.toContain("'unsafe-eval'");
  });

  it('restreint la source par défaut à soi-même', () => {
    expect(directives['default-src']).toEqual(["'self'"]);
  });

  it('restreint les scripts et les styles à des fichiers servis par le serveur', () => {
    expect(directives['script-src']).toEqual(["'self'"]);
    expect(directives['style-src']).toEqual(["'self'"]);
  });

  it("n'autorise aucune police ni image distante", () => {
    expect(directives['font-src']).toEqual(["'self'"]);
    expect(directives['img-src']).toEqual(["'self'", 'data:']);
  });

  it('autorise le WebSocket local, et lui seul', () => {
    const connect = directives['connect-src'] ?? [];
    expect(connect).toContain("'self'");
    expect(connect.some((source) => source.includes('127.0.0.1'))).toBe(true);
    expect(connect.some((source) => source.startsWith('wss://'))).toBe(false);
  });

  it('interdit les objets et les plugins', () => {
    expect(directives['object-src']).toEqual(["'none'"]);
  });

  it("interdit la réécriture de l'URL de base", () => {
    expect(directives['base-uri']).toEqual(["'none'"]);
  });

  it("n'autorise l'encadrement que par l'application elle-même", () => {
    expect(directives['frame-ancestors']).toEqual(["'self'"]);
  });

  it('interdit la soumission de formulaires', () => {
    expect(directives['form-action']).toEqual(["'none'"]);
  });
});

describe('withSecurityHeaders', () => {
  const response = {
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: '{}',
  };

  it('ajoute les en-têtes de sécurité sans toucher au reste', () => {
    const hardened = withSecurityHeaders(response);

    expect(hardened.status).toBe(200);
    expect(hardened.body).toBe('{}');
    expect(hardened.headers['content-type']).toBe('application/json');
    expect(hardened.headers['x-content-type-options']).toBe('nosniff');
  });

  it("ne laisse pas une réponse écraser un en-tête de sécurité", () => {
    const hardened = withSecurityHeaders({
      ...response,
      headers: {
        ...response.headers,
        'content-security-policy': "default-src * 'unsafe-inline'",
        'x-content-type-options': 'permissif',
      },
    });

    expect(hardened.headers['content-security-policy']).toBe(
      securityHeaders()['content-security-policy'],
    );
    expect(hardened.headers['x-content-type-options']).toBe('nosniff');
  });

  it("ne modifie pas la réponse d'origine", () => {
    withSecurityHeaders(response);
    expect(Object.keys(response.headers)).toEqual(['content-type']);
  });
});
