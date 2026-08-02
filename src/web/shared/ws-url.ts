/**
 * Adresse du WebSocket local, telle qu'une page doit la construire.
 *
 * En mode `shared` — le défaut acté — le socket est attaché au serveur HTTP :
 * `window.location.host` suffit, et c'est ce que faisait l'overlay depuis la
 * PR A. En mode `separate`, il écoute sur un autre port, et la page n'a alors
 * aucun moyen de le deviner.
 *
 * Le porter dans le message `hello` ne résout rien : ce message arrive **sur**
 * la connexion qu'il aurait fallu savoir ouvrir. Le port est donc substitué
 * dans le HTML, exactement comme le jeton CSRF, et la page le connaît avant
 * d'ouvrir quoi que ce soit — sans aller-retour HTTP préalable, ce qui compte
 * pour un overlay chargé par OBS.
 *
 * Contrairement au jeton, ce marqueur n'est pas un secret : il est substitué
 * sur les trois pages, overlay compris. C'est même l'overlay qui en a le plus
 * besoin, puisqu'il n'a aucune autre voie pour interroger le serveur.
 *
 * Toute valeur inattendue fait retomber sur l'hôte courant. Un repli silencieux
 * est le bon comportement ici : le mode `shared` est le défaut, il marche, et
 * une page qui refuse de se connecter parce qu'un méta est mal formé serait un
 * overlay noir en plein direct.
 */

/** Nom du méta où `routes/pages.ts` dépose le port. */
export const WS_PORT_META = 'chronocast-ws-port';

/** Marqueur substitué au moment de servir la page. */
const WS_PORT_PLACEHOLDER = '__CHRONOCAST_WS_PORT__';

/** Chemin du WebSocket, aligné sur `WS_PATH` de la composition root. */
const DEFAULT_WS_PATH = '/ws';

/** Bornes d'un port TCP. */
const MIN_PORT = 1;
const MAX_PORT = 65_535;

/**
 * Lit le port substitué dans le gabarit.
 *
 * Renvoie `null` — et non une exception, contrairement à `readCsrfToken` —
 * dès que la valeur n'est pas un port exploitable. La différence est
 * délibérée : un jeton absent rend **toute** mutation impossible et doit se
 * signaler bruyamment au chargement, alors qu'un port absent a un repli
 * parfaitement fonctionnel dans le mode par défaut.
 */
export function readWebSocketPort(source: Document): number | null {
  const meta = source.querySelector(`meta[name="${WS_PORT_META}"]`);
  const raw = meta?.getAttribute('content')?.trim() ?? '';

  if (raw === '' || raw === WS_PORT_PLACEHOLDER) {
    return null;
  }

  // Comparaison à la forme canonique : `Number` accepterait « 3778.0 »,
  // « 0x1234 » ou « 3778 » suivi d'espaces, et un `parseInt` avalerait
  // « 3778/../evil » en n'en retenant que le début.
  if (!/^\d+$/.test(raw)) {
    return null;
  }

  const port = Number(raw);
  return port >= MIN_PORT && port <= MAX_PORT ? port : null;
}

export interface WebSocketUrlOptions {
  /** `window.location.host` : nom d'hôte, et port si la page en expose un. */
  readonly host: string;
  /** `window.location.protocol`, qui décide entre `ws:` et `wss:`. */
  readonly protocol: string;
  /** Port lu dans le gabarit, ou `null` pour rester sur l'hôte courant. */
  readonly port: number | null;
  readonly path?: string;
}

/**
 * Isole le nom d'hôte de son port.
 *
 * Une adresse IPv6 est encadrée de crochets, et le `:` qui la sépare de son
 * port n'est pas le seul du littéral : découper sur le premier produirait
 * `[` comme nom d'hôte.
 */
function hostnameOf(host: string): string {
  if (host.startsWith('[')) {
    const closing = host.indexOf(']');
    return closing < 0 ? host : host.slice(0, closing + 1);
  }

  const separator = host.indexOf(':');
  return separator < 0 ? host : host.slice(0, separator);
}

/** Construit l'URL du WebSocket à partir de l'emplacement de la page. */
export function resolveWebSocketUrl(options: WebSocketUrlOptions): string {
  const { host, protocol, port } = options;
  const path = options.path ?? DEFAULT_WS_PATH;

  // Le serveur local est en clair, mais la règle est posée une fois pour
  // toutes : une page servie en https ne peut pas ouvrir un socket en clair.
  const scheme = protocol === 'https:' ? 'wss' : 'ws';

  if (port === null) {
    return `${scheme}://${host}${path}`;
  }

  const hostname = hostnameOf(host);
  return `${scheme}://${hostname}:${String(port)}${path}`;
}
