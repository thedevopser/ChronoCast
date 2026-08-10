export const REDACTED = '[redacted]';

const CIRCULAR = '[circular]';

const MIN_SECRET_LENGTH = 8;

const MAX_DEPTH = 12;

const MAX_ARRAY_LENGTH = 100;

const SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'token',
  'clientsecret',
  'secret',
  'authorization',
  'password',
  'passwd',
  'apikey',
  'cookie',
  'setcookie',
  'sessionid',
  'authorizationcode',
]);

const SENSITIVE_KEY_SUFFIXES: readonly string[] = ['token', 'secret', 'password', 'apikey'];

const SENSITIVE_QUERY_PARAMETERS: readonly string[] = [
  'client_secret',
  'access_token',
  'refresh_token',
  'id_token',
  'token',
  'code',
  'state',
  'api_key',
  'password',
  'secret',
];

const SENSITIVE_QUERY_PATTERN = new RegExp(
  `([?&](?:${SENSITIVE_QUERY_PARAMETERS.join('|')})=)[^&\\s]+`,
  'gi',
);

const BEARER_PATTERN = /\bBearer\s+[\w\-._~+/]+=*/gi;

export interface Redactor {
  registerSecret(secret: string): void;

  forgetSecret(secret: string): void;

  redact(value: unknown): unknown;
}

function normalizeKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);

  if (SENSITIVE_KEYS.has(normalized)) {
    return true;
  }

  return SENSITIVE_KEY_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

export function createRedactor(): Redactor {
  const secrets = new Set<string>();

  function orderedSecrets(): string[] {
    return [...secrets].sort((left, right) => right.length - left.length);
  }

  function redactString(text: string): string {
    let result = text;

    for (const secret of orderedSecrets()) {
      if (result.includes(secret)) {
        result = result.split(secret).join(REDACTED);
      }
    }

    result = result.replace(SENSITIVE_QUERY_PATTERN, `$1${REDACTED}`);
    result = result.replace(BEARER_PATTERN, `Bearer ${REDACTED}`);

    return result;
  }

  function redactError(error: Error, seen: WeakSet<object>, depth: number): Record<string, unknown> {
    const result: Record<string, unknown> = {
      name: error.name,
      message: redactString(error.message),
    };

    if (typeof error.stack === 'string') {
      result['stack'] = redactString(error.stack);
    }

    for (const key of Object.keys(error)) {
      const value: unknown = Reflect.get(error, key);
      result[key] = isSensitiveKey(key) ? REDACTED : redactValue(value, seen, depth + 1);
    }

    if (error.cause !== undefined) {
      result['cause'] = redactValue(error.cause, seen, depth + 1);
    }

    return result;
  }

  function redactValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
    if (typeof value === 'string') {
      return redactString(value);
    }

    if (value === null || typeof value !== 'object') {
      return typeof value === 'function' ? '[function]' : value;
    }

    if (depth >= MAX_DEPTH) {
      return '[depth-limit]';
    }

    if (seen.has(value)) {
      return CIRCULAR;
    }
    seen.add(value);

    try {
      if (value instanceof Error) {
        return redactError(value, seen, depth);
      }

      if (Array.isArray(value)) {
        const truncated = value.length > MAX_ARRAY_LENGTH;
        const items: unknown[] = value
          .slice(0, MAX_ARRAY_LENGTH)
          .map((item) => redactValue(item, seen, depth + 1));

        if (truncated) {
          items.push(`[… ${String(value.length - MAX_ARRAY_LENGTH)} élément(s) omis]`);
        }

        return items;
      }

      if (value instanceof Date) {
        return value.toISOString();
      }

      if (value instanceof Map) {
        return Object.fromEntries(
          [...value.entries()].map(([key, entry]) => {
            const label = typeof key === 'string' ? key : String(key);
            return [label, isSensitiveKey(label) ? REDACTED : redactValue(entry, seen, depth + 1)];
          }),
        );
      }

      if (value instanceof Set) {
        return [...value].map((entry) => redactValue(entry, seen, depth + 1));
      }

      const result: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value)) {
        result[key] = isSensitiveKey(key) ? REDACTED : redactValue(entry, seen, depth + 1);
      }
      return result;
    } finally {
      seen.delete(value);
    }
  }

  return {
    registerSecret(secret: string): void {
      if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) {
        return;
      }
      secrets.add(secret);
    },

    forgetSecret(secret: string): void {
      secrets.delete(secret);
    },

    redact(value: unknown): unknown {
      return redactValue(value, new WeakSet<object>(), 0);
    },
  };
}
