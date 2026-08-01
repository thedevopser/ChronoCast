/**
 * En-têtes de sécurité appliqués à **toutes** les réponses.
 *
 * L'overlay affiche des pseudos et des messages écrits par des inconnus, dans une
 * Browser Source OBS qui est un navigateur complet. Le code applicatif n'insère
 * jamais que du texte, et ESLint interdit mécaniquement `innerHTML` ; la politique
 * de sécurité du contenu est la barrière suivante, celle qui vaut si une injection
 * franchit malgré tout les deux premières : sans `unsafe-inline`, un `<script>`
 * injecté ne s'exécute tout simplement pas.
 *
 * C'est aussi la raison pour laquelle scripts et styles sont servis en fichiers et
 * jamais en ligne. Une CSP stricte n'a de valeur que si l'application n'a jamais
 * besoin de l'assouplir : la première exception accordée pour le confort annule le
 * bénéfice de toutes les directives.
 */

import type { HttpResponse } from '../http-types.js';

/**
 * Directives de la politique de sécurité du contenu.
 *
 * `connect-src` autorise le WebSocket local et lui seul. Aucune entrée `wss://`
 * n'y figure : ChronoCast ne se connecte à Twitch que depuis le processus Node,
 * jamais depuis une page.
 */
const CSP_DIRECTIVES: Readonly<Record<string, readonly string[]>> = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'"],
  // Les polices sont embarquées : une CDN violerait la CSP et surtout l'exigence
  // de fonctionnement hors ligne.
  'font-src': ["'self'"],
  // `data:` sert aux petites icônes intégrées ; aucun hôte distant n'est admis.
  'img-src': ["'self'", 'data:'],
  'connect-src': ["'self'", 'ws://127.0.0.1:*', 'ws://localhost:*'],
  'object-src': ["'none'"],
  // Sans cette directive, une balise `<base>` injectée détournerait vers un
  // serveur distant chaque chemin relatif de la page.
  'base-uri': ["'none'"],
  // L'aperçu d'apparence du panneau d'administration est une iframe locale.
  'frame-ancestors': ["'self'"],
  // Aucune page de ChronoCast ne soumet de formulaire : tout passe par l'API.
  'form-action': ["'none'"],
};

function serializeCsp(directives: Readonly<Record<string, readonly string[]>>): string {
  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(' ')}`)
    .join('; ');
}

/**
 * En-têtes de sécurité, noms en minuscules.
 *
 * Aucun en-tête `Access-Control-Allow-*` n'y figure et aucun ne doit y être
 * ajouté : un seul suffirait à annuler la garde d'`Host`, en autorisant une page
 * tierce à lire les réponses qu'elle provoque.
 */
export function securityHeaders(): Record<string, string> {
  return {
    'content-security-policy': serializeCsp(CSP_DIRECTIVES),
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'SAMEORIGIN',
  };
}

/** Analyse une politique sérialisée. Exposé pour que les tests portent sur la valeur réelle. */
export function parseContentSecurityPolicy(policy: string): Record<string, string[]> {
  const directives: Record<string, string[]> = {};

  for (const rawDirective of policy.split(';')) {
    const parts = rawDirective.trim().split(/\s+/).filter(Boolean);
    const [name, ...sources] = parts;
    if (name !== undefined) {
      directives[name] = sources;
    }
  }

  return directives;
}

/**
 * Applique les en-têtes de sécurité à une réponse.
 *
 * L'ordre de fusion est ce qui compte : les en-têtes de sécurité sont écrits
 * **après** ceux de la réponse, si bien qu'aucune route ne peut désactiver la CSP,
 * même par accident.
 */
export function withSecurityHeaders(response: HttpResponse): HttpResponse {
  return {
    ...response,
    headers: { ...response.headers, ...securityHeaders() },
  };
}
