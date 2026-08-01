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
 */

import type { HttpResponse } from '../http-types.js';
import { CSRF_PLACEHOLDER } from '../security/csrf.js';
import type { StaticHandler } from '../static-handler.js';

/** Forme d'un jeton engendré par `createCsrfToken` : 32 octets en hexadécimal. */
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

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

/** Retire la barre oblique finale, sauf pour la racine. */
function normalize(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}

export function createPageHandler(options: PageHandlerOptions): PageHandler {
  const { staticHandler, getCsrfToken } = options;

  return {
    async serve(pathname: string): Promise<HttpResponse | null> {
      const normalized = normalize(pathname);

      // La racine mène au panneau d'administration : c'est la page utile quand
      // on lance l'application, l'overlay n'étant destiné qu'à OBS.
      if (normalized === '/') {
        return { status: 302, headers: { location: '/admin' }, body: '' };
      }

      const page = PAGES[normalized];
      if (page === undefined) {
        return null;
      }

      const response = await staticHandler.serve(page.file);
      if (response.status !== 200) {
        return response;
      }

      if (!page.requiresToken) {
        return { ...response, headers: { ...response.headers, 'cache-control': 'no-cache' } };
      }

      // Un jeton mis en cache survivrait au redémarrage qui l'a invalidé : la
      // page semblerait fonctionner tout en échouant sur chaque mutation.
      const body = injectCsrfToken(response.body.toString(), getCsrfToken());

      return {
        status: 200,
        headers: {
          ...response.headers,
          'content-length': String(Buffer.byteLength(body, 'utf8')),
          'cache-control': 'no-store',
        },
        body,
      };
    },
  };
}
