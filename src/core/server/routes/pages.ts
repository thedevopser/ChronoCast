/**
 * Les trois pages de ChronoCast, et leurs deux régimes de sécurité.
 *
 * L'overlay est chargé par OBS, qui se contente de l'URL collée dans une Browser
 * Source : il ne reçoit aucun jeton, et n'en a pas besoin puisqu'il ne fait que
 * lire. Le panneau d'administration et l'assistant de première configuration,
 * eux, modifient l'état : le jeton anti-CSRF leur est substitué dans le HTML au
 * moment où la page est servie.
 *
 * Le jeton voyage dans une balise `meta`, jamais dans un script en ligne. C'est
 * précisément ce qui permet à la CSP de rester stricte : une seule exception
 * `unsafe-inline` accordée pour le confort annulerait la protection dont dépend
 * l'overlay, qui affiche des pseudos choisis par des inconnus.
 *
 * **Deux marqueurs, deux régimes.** Le port du WebSocket emprunte le même
 * mécanisme mais pas la même règle : il est substitué sur les trois pages,
 * overlay compris. Ce n'est pas un secret, et c'est l'overlay qui en a le plus
 * besoin — il doit savoir où se connecter avant d'ouvrir quoi que ce soit, et
 * le message `hello` qui porte ce port arrive, lui, sur la connexion qu'il
 * aurait fallu savoir joindre.
 */

import type { HttpResponse } from '../http-types.js';
import { CSRF_PLACEHOLDER } from '../security/csrf.js';
import type { StaticHandler } from '../static-handler.js';

/** Forme d'un jeton engendré par `createCsrfToken` : 32 octets en hexadécimal. */
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

/** Marqueur du port WebSocket. Doit rester aligné sur `web/shared/ws-url.ts`. */
export const WS_PORT_PLACEHOLDER = '__CHRONOCAST_WS_PORT__';

interface PageDefinition {
  /** Chemin du document, relatif à la racine web. */
  readonly file: string;
  /** Vrai si la page peut muter l'état et doit donc porter le jeton. */
  readonly requiresToken: boolean;
}

const PAGES: Readonly<Record<string, PageDefinition>> = {
  '/overlay': { file: '/overlay/index.html', requiresToken: false },
  '/admin': { file: '/admin/index.html', requiresToken: true },
  '/setup': { file: '/setup/index.html', requiresToken: true },
};

export interface PageHandler {
  /**
   * Sert une page, ou renvoie `null` si le chemin ne lui appartient pas.
   *
   * Le `null` est ce qui permet au routeur d'essayer ensuite l'API puis les
   * ressources statiques : la page ne décide pas à leur place.
   */
  serve(pathname: string): Promise<HttpResponse | null>;
}

export interface PageHandlerOptions {
  readonly staticHandler: StaticHandler;
  /** Lu à chaque requête : le jeton change à chaque démarrage. */
  readonly getCsrfToken: () => string;
  /** Port réel du WebSocket, lu à chaque requête : il dépend du port retenu. */
  readonly getWsPort: () => number;
  /**
   * État de l'assistant, lu à chaque requête.
   *
   * Il change en cours d'exécution, au moment précis où l'utilisateur termine
   * l'assistant : le figer au démarrage renverrait indéfiniment vers `/setup`.
   */
  readonly isSetupCompleted: () => boolean;
}

/**
 * Substitue le jeton au marqueur.
 *
 * La forme du jeton est vérifiée avant écriture. Il est toujours hexadécimal
 * puisqu'il vient de `createCsrfToken`, mais l'écrire dans un attribut HTML sans
 * contrôle laisserait la porte ouverte à une injection le jour où quelqu'un
 * fournirait ce jeton autrement.
 */
export function injectCsrfToken(html: string, token: string): string {
  if (!TOKEN_PATTERN.test(token)) {
    throw new Error('jeton CSRF de forme inattendue : injection refusée');
  }
  return html.replaceAll(CSRF_PLACEHOLDER, token);
}

/**
 * Substitue le port du WebSocket au marqueur.
 *
 * Même précaution que pour le jeton, et pour la même raison : la valeur finit
 * dans un attribut HTML. Elle vient d'un serveur qui écoute réellement sur ce
 * port, donc d'un entier — mais le vérifier coûte une ligne et ferme le sujet.
 */
export function injectWsPort(html: string, port: number): string {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('port WebSocket de forme inattendue : injection refusée');
  }
  return html.replaceAll(WS_PORT_PLACEHOLDER, String(port));
}

/** Retire la barre oblique finale, sauf pour la racine. */
function normalize(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}

export function createPageHandler(options: PageHandlerOptions): PageHandler {
  const { staticHandler, getCsrfToken, getWsPort, isSetupCompleted } = options;

  return {
    async serve(pathname: string): Promise<HttpResponse | null> {
      const normalized = normalize(pathname);

      if (normalized === '/') {
        // Tant que l'assistant n'a pas été mené à son terme, le panneau n'a
        // rien à montrer et rien à commander : sans jeton Twitch, il ouvrirait
        // sur un compteur muet. L'assistant, lui, sait quoi demander.
        return {
          status: 302,
          headers: { location: isSetupCompleted() ? '/admin' : '/setup' },
          body: '',
        };
      }

      const page = PAGES[normalized];
      if (page === undefined) {
        return null;
      }

      const response = await staticHandler.serve(page.file);
      if (response.status !== 200) {
        return response;
      }

      // Le port est substitué sur les trois pages. Le corps est donc réécrit
      // même pour l'overlay, ce qui impose de recalculer la longueur — le
      // `content-length` posé par le gestionnaire statique décrit le fichier,
      // pas ce qu'on s'apprête à envoyer.
      let body = injectWsPort(response.body.toString(), getWsPort());

      if (page.requiresToken) {
        body = injectCsrfToken(body, getCsrfToken());
      }

      return {
        status: 200,
        headers: {
          ...response.headers,
          'content-length': String(Buffer.byteLength(body, 'utf8')),
          // Un jeton mis en cache survivrait au redémarrage qui l'a invalidé :
          // la page semblerait fonctionner tout en échouant sur chaque
          // mutation. L'overlay, sans jeton, se contente d'un `no-cache`.
          'cache-control': page.requiresToken ? 'no-store' : 'no-cache',
        },
        body,
      };
    },
  };
}
