import type { HttpResponse } from '../http-types.js';

const CSP_DIRECTIVES: Readonly<Record<string, readonly string[]>> = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'"],
  'font-src': ["'self'"],
  'img-src': ["'self'", 'data:'],
  'connect-src': ["'self'", 'ws://127.0.0.1:*', 'ws://localhost:*'],
  'object-src': ["'none'"],
  'base-uri': ["'none'"],
  'frame-ancestors': ["'self'"],
  'form-action': ["'none'"],
};

function serializeCsp(directives: Readonly<Record<string, readonly string[]>>): string {
  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(' ')}`)
    .join('; ');
}

export function securityHeaders(): Record<string, string> {
  return {
    'content-security-policy': serializeCsp(CSP_DIRECTIVES),
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'SAMEORIGIN',
  };
}

export function parseContentSecurityPolicy(policy: string): Record<string, string[]> {
  const directives: Record<string, string[]> = {};

  for (const rawDirective of policy.split(';')) {
    const parts = rawDirective.trim().split(/\s+/).filter(Boolean);
    const [name, ...sources] = parts;
    if (name !== undefined) {
      directives[name] = sources;
    }
  }

  return directives;
}

export function withSecurityHeaders(response: HttpResponse): HttpResponse {
  return {
    ...response,
    headers: { ...response.headers, ...securityHeaders() },
  };
}
