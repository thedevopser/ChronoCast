/**
 * Protection contre le rebinding DNS.
 *
 * Écouter sur `127.0.0.1` ne suffit pas à rendre l'application inaccessible depuis
 * le web. Un site visité par le streamer peut faire résoudre son propre nom de
 * domaine vers la boucle locale : le navigateur adresse alors ses requêtes à
 * ChronoCast tout en restant, de son point de vue, sur le site de l'attaquant.
 * Celui-ci lit la configuration, pilote le compteur, révoque les jetons.
 *
 * La seule information fiable dont dispose le serveur est l'en-tête `Host` : le
 * navigateur y écrit le nom réellement demandé, et une page web ne peut pas le
 * falsifier. Rejeter tout ce qui n'est pas littéralement la boucle locale referme
 * l'attaque, parce que l'attaquant a besoin de son propre nom de domaine pour
 * qu'elle fonctionne.
 *
 * La vérification est donc volontairement inflexible : correspondance exacte, et
 * jamais un « commence par » ni un « contient » — `127.0.0.1.attaquant.fr` est un
 * nom de domaine parfaitement enregistrable.
 */

import { errorResponse, type HttpRequest, type HttpResponse } from '../http-types.js';

/**
 * Noms d'hôte acceptés, en minuscules.
 *
 * La plage `127.0.0.0/8` entière n'est délibérément pas admise : le serveur ne se
 * lie qu'à `127.0.0.1`, il n'y a donc aucune raison légitime de voir passer
 * `127.0.0.2`, et un cas d'usage inexistant est une surface d'attaque gratuite.
 */
const ALLOWED_HOSTNAMES: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '::1']);

/** `nom` ou `nom:port`, sans caractère exotique. Les crochets IPv6 sont traités à part. */
const HOST_PORT_PATTERN = /^([a-z0-9.-]+)(?::([0-9]+))?$/;

/** `[adresse]` ou `[adresse]:port` : seule forme valide d'une IPv6 dans un en-tête Host. */
const BRACKETED_IPV6_PATTERN = /^\[([0-9a-f:]+)\](?::([0-9]+))?$/;

/** Un port valide s'écrit sans zéro initial et tient dans la plage TCP. */
function isValidPort(port: string): boolean {
  if (!/^[1-9][0-9]{0,4}$/.test(port)) {
    return false;
  }
  const value = Number.parseInt(port, 10);
  return value >= 1 && value <= 65_535;
}

/**
 * Indique si l'en-tête `Host` désigne la boucle locale.
 *
 * Aucune tolérance : ni espace, ni valeur repliée, ni forme non canonique. Une
 * valeur inattendue est refusée plutôt qu'interprétée, parce qu'interpréter est
 * précisément ce dont l'attaquant a besoin.
 */
export function isLoopbackHost(hostHeader: string | undefined): boolean {
  if (hostHeader === undefined || hostHeader === '') {
    return false;
  }

  // Une virgule signale un en-tête `Host` reçu plusieurs fois et replié par
  // `node:http`. Une requête légitime n'en porte qu'un seul.
  if (hostHeader.includes(',')) {
    return false;
  }

  // Le nom d'hôte est insensible à la casse ; rien d'autre ne l'est.
  const value = hostHeader.toLowerCase();

  const bracketed = BRACKETED_IPV6_PATTERN.exec(value);
  if (bracketed) {
    const [, address, port] = bracketed;
    if (port !== undefined && !isValidPort(port)) {
      return false;
    }
    return address !== undefined && ALLOWED_HOSTNAMES.has(address);
  }

  const matched = HOST_PORT_PATTERN.exec(value);
  if (!matched) {
    return false;
  }

  const [, hostname, port] = matched;
  if (port !== undefined && !isValidPort(port)) {
    return false;
  }

  // `::1` sans crochets ne peut pas parvenir jusqu'ici : les deux-points sont
  // absents du jeu de caractères du nom d'hôte, si bien que la forme non
  // canonique d'une IPv6 est rejetée faute de correspondance.
  return hostname !== undefined && ALLOWED_HOSTNAMES.has(hostname);
}

/**
 * Garde de requête.
 *
 * Renvoie `null` lorsque la requête peut poursuivre, une réponse `403` sinon.
 * Le corps ne contient jamais la valeur reçue : la réfléchir la renverrait vers
 * un contexte que l'attaquant contrôle.
 */
export function checkHost(request: HttpRequest): HttpResponse | null {
  if (isLoopbackHost(request.headers['host'])) {
    return null;
  }

  return errorResponse(
    403,
    'host_not_allowed',
    "Requête refusée : ChronoCast n'accepte que les connexions locales.",
  );
}
