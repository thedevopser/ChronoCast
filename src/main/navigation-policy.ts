/**
 * Politique de navigation de la fenêtre Electron.
 *
 * C'est la pièce de sécurité de la coquille, et c'est pourquoi elle est **pure**
 * et vit hors de `windows.ts` : celui-ci ne fait que lui poser la question et
 * appliquer la réponse. Une décision enfouie dans un gestionnaire d'événement
 * Electron ne serait vérifiable que sur un poste Windows, c'est-à-dire jamais
 * pendant qu'on l'écrit.
 *
 * Elle répond à `will-navigate` et à `setWindowOpenHandler`, qui sont les deux
 * seules portes par lesquelles une page peut emmener la fenêtre ailleurs.
 *
 * Trois réponses, dont une seule est permissive :
 *
 *   - `allow` : la page vient de notre propre serveur local. Seul cas où du
 *     contenu s'affiche dans la fenêtre.
 *   - `external` : Twitch, renvoyé au navigateur du système. La fenêtre ne rend
 *     jamais une page Twitch — le flux OAuth passe par le navigateur et le
 *     rappel loopback, elle n'a donc aucune raison légitime de le faire, et
 *     afficher une page d'authentification tierce dans une fenêtre applicative
 *     est précisément ce qu'on apprend aux utilisateurs à ne pas croire.
 *   - `block` : tout le reste, sans exception.
 */

export type NavigationDecision = 'allow' | 'external' | 'block';

export interface NavigationPolicyOptions {
  /**
   * Origine du serveur local, port réel compris — `http://127.0.0.1:3777`.
   *
   * Elle n'est connue qu'après le démarrage du serveur, le port pouvant se
   * replier : la fenêtre la reçoit, elle ne la devine pas.
   */
  readonly appOrigin: string;
}

/**
 * Hôtes Twitch renvoyés au navigateur du système.
 *
 * Liste close et comparée **exactement**, comme la garde d'`Host` de la Phase 4.
 * Aucune correspondance par suffixe : `id.twitch.tv.evil.test` se termine par
 * `twitch.tv` sans avoir le moindre rapport avec Twitch, et c'est l'usurpation
 * la plus banale qui soit.
 */
const TWITCH_HOSTS: ReadonlySet<string> = new Set([
  'id.twitch.tv',
  'dev.twitch.tv',
  'twitch.tv',
  'www.twitch.tv',
]);

/** Analyse une URL, sans jamais lever. */
function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function decideNavigation(
  url: string,
  options: NavigationPolicyOptions,
): NavigationDecision {
  const target = parse(url);
  if (target === null) {
    return 'block';
  }

  // L'origine attendue est analysée elle aussi : comparer deux chaînes brutes
  // ferait dépendre la décision d'un slash final ou d'une casse. Si elle est
  // inexploitable — fenêtre construite avant que le serveur ait annoncé son
  // port —, rien ne passe : mieux vaut une fenêtre vide qu'une fenêtre à tout
  // venant.
  const expected = parse(options.appOrigin);
  if (expected !== null && target.origin === expected.origin) {
    return 'allow';
  }

  // `hostname` et non `host` : il exclut le port, que l'on veut vérifier à
  // part. Il est déjà normalisé — minuscules, punycode — par l'analyse, et il
  // ignore l'identifiant d'utilisateur qui précéderait une arobase, lequel est
  // la façon la plus lisible de faire passer `evil.test` pour Twitch.
  if (target.protocol === 'https:' && target.port === '' && TWITCH_HOSTS.has(target.hostname)) {
    return 'external';
  }

  return 'block';
}
