/**
 * Implémentation du port {@link BrowserOpener} sur le navigateur du système.
 *
 * `shell.openExternal` est **injecté** plutôt qu'importé d'`electron` : ce
 * module porte une garde de sécurité, et une garde qu'on ne peut pas exécuter
 * en test n'est qu'une intention.
 *
 * Le contrat du port l'exige : tout schéma autre que `https:` est refusé.
 * Demander au système d'ouvrir une URL, c'est lui demander de lancer
 * l'application enregistrée pour ce schéma — un `file://` ouvre l'explorateur,
 * et d'autres schémas déclenchent des programmes tiers. L'unique appelant
 * légitime est le flux OAuth, qui construit lui-même son URL Twitch ; la garde
 * est là pour le jour où ce chemin s'élargira sans qu'on y pense.
 */

import type { BrowserOpener } from '../core/app/ports.js';

export interface ExternalBrowserOpenerOptions {
  /** `shell.openExternal` d'Electron, ou tout équivalent. */
  openExternal(url: string): Promise<void>;
}

/** Vrai si l'URL est analysable et porte le schéma `https:`. */
function isHttps(url: string): boolean {
  try {
    // L'analyse fait foi plutôt qu'une comparaison de préfixe : elle accepte
    // `HTTPS://`, que les navigateurs traitent comme `https://`, et elle rejette
    // les chaînes qui n'ont d'URL que l'apparence.
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

export function createExternalBrowserOpener(
  options: ExternalBrowserOpenerOptions,
): BrowserOpener {
  return {
    open(url: string): Promise<void> {
      if (!isHttps(url)) {
        // Rejet, jamais de levée synchrone : le contrat renvoie une promesse, et
        // lever ici ferait passer l'erreur à côté du `.catch()` de l'appelant.
        return Promise.reject(new Error('seules les URL https peuvent être ouvertes'));
      }

      return options.openExternal(url);
    },
  };
}
