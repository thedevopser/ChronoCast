/**
 * Rédaction des secrets avant écriture dans les logs.
 *
 * ChronoCast manipule un `client_secret` Twitch et deux jetons OAuth. Les logs
 * sont persistés sur le disque de l'utilisateur et sont la première chose qu'il
 * transmettra en cas de problème : un jeton qui y fuite est un jeton compromis.
 *
 * Deux mécanismes complémentaires, parce qu'aucun des deux ne suffit seul :
 *
 *   1. **Par nom de clé** — attrape le cas courant où l'on journalise un objet
 *      de réponse OAuth entier. Ne couvre pas un secret glissé dans un message
 *      d'erreur ou une URL.
 *   2. **Par valeur enregistrée** — le magasin de jetons déclare ici les valeurs
 *      réellement détenues ; elles sont alors masquées où qu'elles apparaissent,
 *      y compris dans une pile d'appels ou une chaîne de requête inattendue.
 *
 * Ce module est pur et sans dépendance : il doit rester trivialement vérifiable.
 */

/** Marqueur substitué à toute valeur sensible. */
export const REDACTED = '[redacted]';

/** Marqueur substitué à une référence déjà visitée. */
const CIRCULAR = '[circular]';

/**
 * Longueur minimale d'une valeur acceptée comme secret.
 *
 * Enregistrer une valeur courte reviendrait à masquer des fragments de texte au
 * hasard dans tous les logs, ce qui les rendrait inexploitables — un secret
 * Twitch fait de toute façon plusieurs dizaines de caractères.
 */
const MIN_SECRET_LENGTH = 8;

/**
 * Profondeur maximale d'exploration.
 *
 * Une structure profonde ou hostile ne doit pas pouvoir provoquer un
 * débordement de pile depuis le chemin d'écriture des logs.
 */
const MAX_DEPTH = 12;

/** Nombre maximal d'éléments conservés dans un tableau journalisé. */
const MAX_ARRAY_LENGTH = 100;

/**
 * Noms de champs dont la valeur est toujours masquée.
 *
 * Comparés sous forme normalisée (minuscules, séparateurs retirés), ce qui rend
 * la liste insensible aux conventions `snake_case`, `camelCase` ou `kebab-case`.
 */
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

/**
 * Suffixes déclenchant le masquage.
 *
 * Couvre les champs que la liste explicite ne peut pas anticiper, par exemple
 * l'en-tête applicatif `X-ChronoCast-Token`.
 */
const SENSITIVE_KEY_SUFFIXES: readonly string[] = ['token', 'secret', 'password', 'apikey'];

/**
 * Paramètres de requête masqués dans toute chaîne ressemblant à une URL.
 *
 * `code` et `state` en font partie : ce sont les valeurs à usage unique du flux
 * OAuth, exploitables tant qu'elles n'ont pas été consommées.
 */
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

/** Jeton porteur dans un en-tête `Authorization` sérialisé. */
const BEARER_PATTERN = /\bBearer\s+[\w\-._~+/]+=*/gi;

/**
 * Rédacteur de secrets.
 *
 * L'enregistrement des valeurs est mutable parce que les jetons changent au fil
 * des renouvellements : le rédacteur doit toujours connaître les jetons courants.
 */
export interface Redactor {
  /**
   * Déclare une valeur à masquer partout où elle apparaît.
   * Les valeurs plus courtes que {@link MIN_SECRET_LENGTH} sont ignorées.
   */
  registerSecret(secret: string): void;

  /** Retire une valeur du registre, typiquement après révocation d'un jeton. */
  forgetSecret(secret: string): void;

  /** Renvoie une copie expurgée de la valeur, sans jamais modifier l'entrée. */
  redact(value: unknown): unknown;
}

/** Normalise un nom de champ pour le comparer sans dépendre de sa convention d'écriture. */
function normalizeKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

/** Indique si la valeur associée à ce champ doit être masquée. */
function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);

  if (SENSITIVE_KEYS.has(normalized)) {
    return true;
  }

  return SENSITIVE_KEY_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

export function createRedactor(): Redactor {
  /**
   * Trié par longueur décroissante : si deux secrets se chevauchent, le plus
   * long doit être substitué en premier, faute de quoi le second laisserait
   * apparaître une partie du premier.
   */
  const secrets = new Set<string>();

  function orderedSecrets(): string[] {
    return [...secrets].sort((left, right) => right.length - left.length);
  }

  function redactString(text: string): string {
    let result = text;

    for (const secret of orderedSecrets()) {
      // `split`/`join` plutôt qu'une expression régulière : aucun caractère du
      // secret n'a besoin d'être échappé, donc aucune erreur d'échappement possible.
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

    // Les propriétés additionnelles portent souvent le diagnostic utile
    // (`code: 'ECONNRESET'`, `status: 401`) : elles sont conservées, expurgées.
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
      // Nombres, booléens, undefined, bigint, symboles et fonctions : rien à masquer.
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
      // Retiré après traitement : deux occurrences d'un même objet dans des
      // branches distinctes ne constituent pas un cycle et doivent être rendues.
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
