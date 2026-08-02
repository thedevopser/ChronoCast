/**
 * Retour dans la fenêtre après le rappel OAuth.
 *
 * Le flux d'autorisation part dans le navigateur système et y revient : Twitch
 * ne connaît que la boucle locale, et la fenêtre de l'application ne voit rien
 * passer. Prévenue par le bus, elle doit se recharger — l'assistant dérive son
 * étape de l'état réel, il suffit donc qu'il se rejoue.
 *
 * Ce module dit **quelle URL recharger**. Il est pur, donc testé dans le
 * conteneur ; `main/main.ts` se contente de l'appliquer.
 *
 * Deux exigences le gouvernent :
 *
 *   - **Rester où l'utilisateur était.** Le flux se déclenche depuis
 *     l'assistant comme depuis le panneau d'administration ; le ramener de
 *     force dans l'assistant le sortirait de la page qu'il avait ouverte.
 *   - **Ne jamais sortir de l'origine applicative.** Cette URL part dans
 *     `loadURL` : ce qu'on y met est ce que la fenêtre affichera. Plutôt que de
 *     filtrer les formes hostiles une à une — il y en a toujours une de plus —
 *     la destination est prise dans un **ensemble clos de deux pages**, et tout
 *     le reste retombe sur l'assistant.
 */

import type { OAuthOutcome } from '../core/server/oauth-callback.js';

/** Les seules pages qui peuvent avoir lancé un flux d'autorisation. */
const RETURNABLE_PATHS = new Set(['/setup', '/admin']);

/** Destination par défaut : la seule page qui sache quoi montrer sans jeton. */
const DEFAULT_PATH = '/setup';

export interface OAuthReturnOptions {
  /** Origine du serveur local, seule origine que la fenêtre affiche. */
  readonly appOrigin: string;
  /** URL affichée par la fenêtre au moment du rappel. */
  readonly currentUrl: string;
  readonly outcome: OAuthOutcome;
}

export function oauthReturnUrl(options: OAuthReturnOptions): string {
  const { appOrigin, currentUrl, outcome } = options;

  return `${appOrigin}${currentPath(appOrigin, currentUrl)}?oauth=${outcome}`;
}

/** Chemin à recharger : celui de la fenêtre s'il est admissible, sinon l'assistant. */
function currentPath(appOrigin: string, currentUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(currentUrl);
  } catch {
    // Fenêtre encore vide, ou URL qu'Electron n'a pas su former.
    return DEFAULT_PATH;
  }

  if (parsed.origin !== appOrigin) {
    return DEFAULT_PATH;
  }

  return RETURNABLE_PATHS.has(parsed.pathname) ? parsed.pathname : DEFAULT_PATH;
}
