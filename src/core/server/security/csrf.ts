/**
 * Jeton anti-CSRF.
 *
 * La garde d'`Host` empêche une page tierce de *lire* l'application. Elle ne la
 * protège pas de l'*écriture* : un formulaire HTML posté vers
 * `http://127.0.0.1:3777` porte un en-tête `Host` parfaitement légitime, et le
 * navigateur l'envoie sans rien demander. Sans seconde barrière, n'importe quel
 * site visité par le streamer pourrait remettre son compteur à zéro.
 *
 * Le jeton est ce qui manque à l'attaquant. Il est engendré au démarrage, injecté
 * dans le HTML du panneau d'administration, et exigé sur toute mutation. Aucune
 * route ne le renvoie : une page tierce ne peut donc ni le lire, ni le deviner.
 *
 * L'overlay reste accessible sans jeton, en lecture seule. C'est délibéré : OBS
 * charge l'URL telle quelle, sans possibilité d'y ajouter un en-tête.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';

import { errorResponse, type HttpRequest, type HttpResponse } from '../http-types.js';

/** En-tête portant le jeton. Nom en minuscules, comme toutes les clés d'en-tête normalisées. */
export const CSRF_HEADER = 'x-chronocast-token';

/**
 * Marqueur substitué dans le HTML au moment de servir la page d'administration.
 *
 * Le jeton voyage dans une balise `meta`, jamais dans un script en ligne : la CSP
 * de ChronoCast interdit `unsafe-inline`, et une exception ouverte pour le confort
 * annulerait la protection qu'elle apporte à l'overlay.
 */
export const CSRF_PLACEHOLDER = '__CHRONOCAST_CSRF__';

/** Méthodes sûres au sens de la RFC 9110 : elles ne modifient rien. */
const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Engendre un jeton de 32 octets, rendu en hexadécimal. */
export function createCsrfToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Indique si la méthode doit être protégée.
 *
 * Toute méthode non répertoriée comme sûre est traitée comme mutante : le doute
 * profite à la sécurité, et une méthode exotique n'a de toute façon aucune route.
 */
export function isMutatingMethod(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

/**
 * Compare deux jetons sans fuite temporelle.
 *
 * `timingSafeEqual` lève lorsque les tampons diffèrent en longueur : la longueur
 * est donc comparée avant, faute de quoi la garde planterait au lieu de refuser.
 * Cette comparaison-là révèle la longueur du jeton, information sans valeur
 * puisqu'elle est constante et publique.
 */
export function verifyCsrfToken(expected: string, provided: string | undefined): boolean {
  // Un jeton attendu vide signale un serveur mal initialisé. Tout accepter serait
  // le pire repli possible : on refuse tout.
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

/**
 * Garde de requête.
 *
 * Renvoie `null` lorsque la requête peut poursuivre, une réponse `403` sinon.
 */
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

/** Schémas admis pour une origine de WebSocket. `https` n'a pas de sens en local. */
const ALLOWED_ORIGIN_PROTOCOLS: ReadonlySet<string> = new Set(['http:']);

/** Noms d'hôte admis pour une origine, sous la forme normalisée d'`URL.hostname`. */
const ALLOWED_ORIGIN_HOSTNAMES: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * Vérifie l'origine d'une poignée de main WebSocket.
 *
 * L'absence d'`Origin` est acceptée : OBS et les clients non navigateur n'en
 * envoient pas, et les refuser interdirait l'overlay, c'est-à-dire l'usage
 * principal. Ce n'est pas un affaiblissement — un navigateur en envoie toujours
 * un, et c'est du navigateur que vient la menace.
 */
export function isAllowedWebSocketOrigin(origin: string | undefined): boolean {
  if (origin === undefined) {
    return true;
  }

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    // `null`, `file://` et les chaînes mal formées finissent ici : refusés.
    return false;
  }

  return (
    ALLOWED_ORIGIN_PROTOCOLS.has(parsed.protocol) && ALLOWED_ORIGIN_HOSTNAMES.has(parsed.hostname)
  );
}
