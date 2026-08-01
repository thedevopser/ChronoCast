/**
 * Représentation normalisée d'un échange HTTP.
 *
 * Le serveur de ChronoCast est découpé en deux moitiés qui ne se ressemblent pas :
 * d'un côté un adaptateur `node:http` qui manipule des sockets, de l'autre un
 * routeur, des gardes de sécurité et des routes qui n'en manipulent aucun.
 *
 * Ce fichier est la frontière entre les deux. L'adaptateur produit une
 * {@link HttpRequest} — corps déjà lu et plafonné, en-têtes en minuscules, chemin
 * décodé — et consomme une {@link HttpResponse}. Tout le reste du serveur n'est
 * qu'une fonction de l'une vers l'autre.
 *
 * Conséquence : l'intégralité du routage et des trois gardes de sécurité se
 * vérifie sans ouvrir un seul socket, donc sans attente réelle ni port occupé.
 */

/** Requête entrante, déjà normalisée par l'adaptateur. */
export interface HttpRequest {
  /** Méthode telle qu'annoncée par le client, sans normalisation de casse. */
  readonly method: string;

  /** Chemin décodé, sans chaîne de requête, toujours commencé par `/`. */
  readonly path: string;

  /** Paramètres de la chaîne de requête. */
  readonly query: URLSearchParams;

  /**
   * En-têtes, **noms en minuscules**.
   *
   * Un en-tête reçu plusieurs fois est replié en une valeur unique séparée par
   * des virgules, conformément à `node:http`. Les gardes en tiennent compte : une
   * valeur repliée est une anomalie, jamais une valeur légitime.
   */
  readonly headers: Readonly<Record<string, string>>;

  /** Corps brut, déjà lu et plafonné en taille. Chaîne vide s'il n'y en a pas. */
  readonly body: string;
}

/**
 * Réponse sortante.
 *
 * Le corps binaire est nécessaire : polices et images sont servies telles quelles,
 * et les transformer en chaîne les corromprait.
 */
export interface HttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | Uint8Array;
}

/** Corps d'erreur uniforme de l'API. */
export interface ErrorBody {
  readonly error: string;
  /** Code stable, destiné au code client plutôt qu'à l'utilisateur. */
  readonly code: string;
}

/** Réponse JSON. Le jeu de caractères est explicite : sans lui, certains clients devinent. */
export function jsonResponse(
  status: number,
  value: unknown,
  headers: Readonly<Record<string, string>> = {},
): HttpResponse {
  return {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
    body: JSON.stringify(value),
  };
}

/**
 * Réponse d'erreur.
 *
 * Le message est destiné à être affiché : il ne doit jamais contenir la valeur
 * reçue du client, sous peine de la réfléchir vers un contexte hostile, ni un
 * détail interne, qui renseignerait un attaquant sur l'implémentation.
 */
export function errorResponse(status: number, code: string, message: string): HttpResponse {
  return jsonResponse(status, { error: message, code } satisfies ErrorBody);
}

/** Réponse sans corps, pour les mutations dont le résultat n'apporte rien. */
export function noContentResponse(): HttpResponse {
  return { status: 204, headers: {}, body: '' };
}
