const CSRF_HEADER = 'x-chronocast-token';

const CSRF_PLACEHOLDER = '__CHRONOCAST_CSRF__';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function readCsrfToken(source: Document): string {
  const meta = source.querySelector('meta[name="chronocast-csrf"]');
  const token = meta?.getAttribute('content') ?? '';

  if (token === '' || token === CSRF_PLACEHOLDER) {
    throw new Error(
      'jeton CSRF absent du gabarit : cette page doit être servie par ChronoCast.',
    );
  }

  return token;
}

export interface ApiClientOptions {
  readonly token: string;
  readonly fetch: (input: string, init?: RequestInit) => Promise<Response>;
}

export interface ApiClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T | null>;
  patch<T>(path: string, body?: unknown): Promise<T | null>;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T | null> {
    const headers: Record<string, string> = {};

    if (method !== 'GET') {
      headers[CSRF_HEADER] = options.token;
    }

    if (body !== undefined) {
      headers['content-type'] = 'application/json';
    }

    let response: Response;
    try {
      response = await options.fetch(path, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new ApiError(
        'ChronoCast ne répond pas. Vérifiez que l’application est toujours ouverte.',
        'network_unreachable',
        0,
      );
    }

    if (response.status === 204) {
      return null;
    }

    const payload: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const failure = payload as { error?: unknown; code?: unknown } | null;
      throw new ApiError(
        typeof failure?.error === 'string' ? failure.error : 'ChronoCast a refusé la demande.',
        typeof failure?.code === 'string' ? failure.code : 'unknown_error',
        response.status,
      );
    }

    return payload as T;
  }

  return {
    async get<T>(path: string): Promise<T> {
      return (await request<T>('GET', path)) as T;
    },
    post<T>(path: string, body?: unknown): Promise<T | null> {
      return request<T>('POST', path, body);
    },
    patch<T>(path: string, body?: unknown): Promise<T | null> {
      return request<T>('PATCH', path, body);
    },
  };
}
