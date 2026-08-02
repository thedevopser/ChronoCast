/**
 * Feuille de style personnelle de l'overlay.
 *
 * `overlay.enableCustomCss` existe au schéma depuis la Phase 1 et n'avait
 * jusqu'ici aucune route : `static-handler.ts` ne sert que la racine web, et
 * rien ne lisait le répertoire de données. Le réglage promettait donc un
 * comportement qu'il ne produisait pas.
 *
 * **Un seul fichier, à un seul chemin.** Aucun segment ne vient de l'URL, ce
 * qui écarte d'emblée la traversée de chemin classique. Reste le lien
 * symbolique, qui est ici la vraie surface : le répertoire de données
 * appartient à l'utilisateur, il y dépose ce qu'il veut, et `tokens.json` — les
 * jetons Twitch chiffrés — en est le voisin immédiat. Un lien pointant dessus
 * ferait servir ce fichier à quiconque ouvre l'overlay.
 *
 * D'où le même contrôle que le gestionnaire statique : on canonise, puis on
 * vérifie que le résultat est resté sous la racine. Filtrer le nom ne servirait
 * à rien, il n'y a pas de nom à filtrer.
 *
 * **Toute erreur produit la même `404`**, quelle qu'en soit la cause : fichier
 * absent, réglage inactif, lien sortant, droits insuffisants. Une réponse
 * distincte dessinerait la carte du répertoire de données à qui la demande.
 */

import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

import type { Logger } from '../../logging/logger.js';
import type { HttpResponse } from '../http-types.js';

/** Chemin servi, et nom du fichier attendu dans le répertoire de données. */
const ROUTE_PATH = '/custom.css';
const FILE_NAME = 'custom.css';

/** Corps de la réponse `404`, identique à celui du gestionnaire statique. */
const NOT_FOUND_BODY = 'Ressource introuvable.';

export interface CustomCssHandler {
  /**
   * Sert la feuille, ou renvoie `null` si le chemin ne lui appartient pas.
   *
   * Même contrat que `PageHandler` : le `null` laisse le routeur essayer les
   * pages puis les ressources statiques.
   */
  serve(pathname: string): Promise<HttpResponse | null>;
}

export interface CustomCssHandlerOptions {
  /** Racine des données. Rien au-dessus n'est accessible. */
  readonly dataDirectory: string;
  /** Lu à chaque requête : le réglage se change depuis le panneau. */
  readonly isEnabled: () => boolean;
  readonly logger: Logger;
}

/** Vérifie qu'un chemin est bien sous la racine, sans se fier à un préfixe. */
function isInside(root: string, candidate: string): boolean {
  const difference = relative(root, candidate);
  return difference !== '' && !difference.startsWith('..') && !isAbsolute(difference);
}

/** Retire la barre oblique finale, sauf pour la racine. */
function normalize(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}

export function createCustomCssHandler(options: CustomCssHandlerOptions): CustomCssHandler {
  const { isEnabled, logger } = options;
  const root = resolve(options.dataDirectory);
  const filePath = join(root, FILE_NAME);
  const scoped = logger.child('custom-css');

  function notFound(): HttpResponse {
    return {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      body: NOT_FOUND_BODY,
    };
  }

  return {
    async serve(pathname: string): Promise<HttpResponse | null> {
      if (normalize(pathname) !== ROUTE_PATH) {
        return null;
      }

      if (!isEnabled()) {
        return notFound();
      }

      try {
        // Canonisation avant tout : la composition du chemin ne voit pas les
        // liens symboliques, et c'est par là que le fichier peut sortir.
        const canonical = await realpath(filePath);
        if (!isInside(root, canonical)) {
          // En `warning` : un lien sortant n'apparaît pas par hasard, et c'est
          // la seule trace dont disposera le streamer.
          scoped.warning('feuille personnelle refusée : lien sortant du répertoire de données');
          return notFound();
        }

        const stats = await stat(canonical);
        if (!stats.isFile()) {
          return notFound();
        }

        const content = await readFile(canonical);

        return {
          status: 200,
          headers: {
            'content-type': 'text/css; charset=utf-8',
            'content-length': String(content.byteLength),
            // Le streamer modifie sa feuille puis recharge sa Browser Source :
            // lui servir la version précédente lui ferait croire à une panne.
            'cache-control': 'no-store',
          },
          body: content,
        };
      } catch (error) {
        // Fichier absent, droits insuffisants, disque en erreur : même réponse.
        scoped.debug('feuille personnelle illisible', { cause: error });
        return notFound();
      }
    },
  };
}
