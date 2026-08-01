/**
 * Client de l'API d'administration.
 *
 * Partagé par l'assistant de première configuration et par le panneau
 * d'administration. Il concentre les deux choses qu'on ne veut écrire qu'une
 * fois — le jeton CSRF et la lecture des erreurs — parce que les oublier ne se
 * voit qu'à l'exécution, et tard.
 *
 * **Le jeton CSRF** est exigé sur toute méthode autre qu'une lecture, faute de
 * quoi le serveur répond `403` **avant** de résoudre la route : une mutation
 * qui l'oublie ne se distingue donc pas d'une URL fautive. Il est injecté dans
 * le HTML par substitution du marqueur `__CHRONOCAST_CSRF__` et n'est exposé
 * par aucune route — une page tierce ne peut ni le lire ni le deviner.
 *
 * **Les erreurs** de l'API portent une phrase française destinée à
 * l'utilisateur et un code stable destiné au programme. Se contenter de
 * `response.ok` afficherait « Erreur 400 » là où le serveur a écrit « Durée
 * invalide. » : tout le soin mis côté serveur serait perdu sur la dernière
 * ligne.
 */

/** Nom de l'en-tête attendu par le serveur. Doit rester aligné sur `security/csrf.ts`. */
const CSRF_HEADER = 'x-chronocast-token';

/** Marqueur substitué par `routes/pages.ts` au moment de servir la page. */
const CSRF_PLACEHOLDER = '__CHRONOCAST_CSRF__';

/**
 * Échec d'un appel à l'API.
 *
 * Porte le message affichable **et** le code stable : l'appelant montre le
 * premier et se branche sur le second, sans avoir à analyser du texte.
 */
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

/**
 * Lit le jeton injecté dans le gabarit.
 *
 * Lève si le marqueur n'a pas été substitué : la page a alors été servie
 * autrement que par `/admin` ou `/setup`, et **toute** mutation échouerait en
 * `403` sans que rien n'explique pourquoi. Échouer ici, au chargement, est
 * infiniment plus lisible.
 */
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
  /** Injecté pour que les tests n'ouvrent aucune connexion. */
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

    // Une lecture n'a pas besoin du jeton : l'y joindre l'exposerait sans
    // contrepartie à tout ce qui observerait la requête.
    if (method !== 'GET') {
      headers[CSRF_HEADER] = options.token;
    }

    // `content-type` sur une requête sans corps serait un mensonge, et le
    // serveur traite de toute façon un corps vide comme `{}`.
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
      // Le serveur est local : une coupure signifie qu'il s'est arrêté. Relayer
      // le « Failed to fetch » du navigateur n'apprendrait rien à personne.
      throw new ApiError(
        'ChronoCast ne répond pas. Vérifiez que l’application est toujours ouverte.',
        'network_unreachable',
        0,
      );
    }

    if (response.status === 204) {
      return null;
    }

    // Une réponse d'erreur n'est pas toujours du JSON : le gestionnaire statique
    // répond en texte brut, et une analyse ratée masquerait le vrai problème.
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
