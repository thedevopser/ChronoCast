/**
 * Service des ressources statiques : overlay, panneau d'administration, polices.
 *
 * C'est l'opération la plus banale d'un serveur et la plus facile à rater. Un
 * chemin venu du réseau qui traverse la racine donne accès à tout ce que le
 * processus peut lire, et ChronoCast tourne sous le compte du streamer, avec ses
 * jetons Twitch chiffrés dans le répertoire voisin.
 *
 * La défense tient en une règle appliquée sans exception : **on résout, puis on
 * vérifie que le chemin résolu reste sous la racine**. Filtrer la chaîne d'entrée
 * ne fonctionne jamais — il y a toujours un encodage de plus. Et parce que la
 * résolution ne voit pas les liens symboliques, le contrôle est refait après
 * canonisation.
 *
 * Toute erreur, quelle qu'en soit la cause, produit la même réponse `404`. Un
 * `403` distinct confirmerait à l'attaquant que le fichier visé existe.
 */

import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';

import type { Logger } from '../logging/logger.js';
import type { HttpResponse } from './http-types.js';

/**
 * Extensions servies, associées à leur type MIME.
 *
 * Une liste blanche, jamais une liste noire : un fichier d'un type inattendu ne
 * doit pas pouvoir être servi par accident, et c'est aussi cette liste qui
 * empêche de servir un `.env` ou un `.json` de sauvegarde déposé par erreur dans
 * la racine web.
 */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/** Corps de la réponse `404`, constant : il ne renseigne sur rien. */
const NOT_FOUND_BODY = 'Ressource introuvable.';

export interface StaticHandler {
  /** Sert le chemin demandé, ou une `404` indifférenciée. */
  serve(pathname: string): Promise<HttpResponse>;
}

export interface StaticHandlerOptions {
  /** Racine des ressources servies. Rien au-dessus n'est accessible. */
  readonly rootDirectory: string;
  readonly logger: Logger;
}

/** Type MIME associé à l'extension, ou `null` si elle n'est pas servie. */
export function contentTypeFor(filePath: string): string | null {
  return CONTENT_TYPES[extname(filePath).toLowerCase()] ?? null;
}

/**
 * Traduit un chemin d'URL en chemin de fichier, ou `null` s'il est refusé.
 *
 * Le chemin reçu a **déjà été décodé une fois** par l'adaptateur HTTP. Un `%`
 * résiduel signale donc un double encodage — jamais un nom de fichier de
 * ChronoCast — et suffit à refuser. De même pour l'antislash : il ne sépare rien
 * sous Linux, mais la cible de la V1 est Windows, où il sépare.
 */
export function resolveStaticPath(rootDirectory: string, pathname: string): string | null {
  if (pathname.includes('\0') || pathname.includes('%') || pathname.includes('\\')) {
    return null;
  }

  if (contentTypeFor(pathname) === null) {
    return null;
  }

  // La barre oblique initiale est retirée : dans une URL elle désigne la racine
  // du site, pas celle du disque. Sans cela, `join` produirait un chemin absolu.
  const relativePath = pathname.replace(/^\/+/, '');
  if (relativePath === '' || isAbsolute(relativePath)) {
    return null;
  }

  const root = resolve(rootDirectory);
  const candidate = resolve(join(root, relativePath));

  return isInside(root, candidate) ? candidate : null;
}

/**
 * Vérifie qu'un chemin est bien sous la racine.
 *
 * La comparaison passe par `relative` plutôt que par un préfixe de chaîne : un
 * répertoire voisin nommé `public-sauvegarde` commence par `public` sans être
 * dedans.
 */
function isInside(root: string, candidate: string): boolean {
  if (candidate === root) {
    return false;
  }
  const difference = relative(root, candidate);
  return difference !== '' && !difference.startsWith('..') && !isAbsolute(difference);
}

export function createStaticHandler(options: StaticHandlerOptions): StaticHandler {
  const { logger } = options;
  const root = resolve(options.rootDirectory);
  const scoped = logger.child('static');

  /**
   * Forme canonique de la racine, résolue une fois puis mémorisée.
   *
   * Elle est indispensable : le contrôle anti-lien-symbolique compare un chemin
   * passé par `realpath` à la racine, et comparer une forme canonique à une
   * forme qui ne l'est pas refuse **tout**. C'est ce qui est arrivé au premier
   * build Windows, où le répertoire temporaire du runner s'appelle
   * `C:\Users\RUNNER~1\...` — un nom court 8.3 — quand `realpath` rend
   * `C:\Users\runneradmin\...`. Les noms courts, les jonctions et un `%TEMP%`
   * redirigé produisent le même écart sur un poste réel : l'application
   * n'aurait servi ni overlay, ni panneau, ni assistant.
   *
   * Mémorisée parce que la racine ne change pas de la vie du serveur, et qu'un
   * appel système par ressource servie serait payé à chaque image de l'overlay.
   *
   * Repli sur `root` si la racine n'existe pas encore : mieux vaut se comporter
   * comme avant que refuser de démarrer. Le contrôle reste alors strictement
   * aussi sévère qu'auparavant.
   */
  let canonicalRoot: Promise<string> | null = null;
  function resolveCanonicalRoot(): Promise<string> {
    canonicalRoot ??= realpath(root).catch(() => root);
    return canonicalRoot;
  }

  function notFound(): HttpResponse {
    return {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      body: NOT_FOUND_BODY,
    };
  }

  return {
    async serve(pathname: string): Promise<HttpResponse> {
      const filePath = resolveStaticPath(root, pathname);

      if (filePath === null) {
        // Journalisé en `warning` : une traversée n'arrive pas par hasard, et
        // c'est la seule trace dont disposera le streamer.
        scoped.warning('chemin statique refusé', { pathname });
        return notFound();
      }

      try {
        // Canonisation : la résolution précédente ne voit pas les liens
        // symboliques. Sans ce second contrôle, un lien déposé dans la racine
        // ouvrirait l'ensemble du disque.
        const canonical = await realpath(filePath);
        // Les deux côtés de la comparaison sont canoniques : c'est la seule
        // façon de n'accepter que ce qui est réellement sous la racine, sans
        // refuser ce qui y est par un chemin d'un autre nom.
        if (!isInside(await resolveCanonicalRoot(), canonical)) {
          scoped.warning('lien symbolique sortant de la racine refusé', { pathname });
          return notFound();
        }

        const stats = await stat(canonical);
        if (!stats.isFile()) {
          // Aucun listing de répertoire, jamais : c'est une carte du disque
          // offerte à qui la demande.
          return notFound();
        }

        const content = await readFile(canonical);

        return {
          status: 200,
          headers: {
            'content-type': contentTypeFor(canonical) ?? 'text/plain; charset=utf-8',
            'content-length': String(content.byteLength),
          },
          body: content,
        };
      } catch (error) {
        // Fichier absent, droits insuffisants, disque en erreur : la réponse est
        // la même. Le détail va dans les logs, pas sur le réseau.
        scoped.debug('ressource statique illisible', { pathname, cause: error });
        return notFound();
      }
    },
  };
}
