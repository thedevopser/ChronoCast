/**
 * Implémentation réelle du port {@link Ticker} du service compteur.
 *
 * Deux précautions, chacune pour un incident concret :
 *
 *   - **Un seul minuteur à la fois.** Redémarrer le cadenceur après un changement
 *     de période ne doit pas laisser l'ancien battre en parallèle, sous peine de
 *     voir le décompte avancer deux fois trop vite — un symptôme qu'on met
 *     longtemps à attribuer à sa vraie cause.
 *   - **`unref()`.** Sans cela, le minuteur retiendrait la boucle d'événements de
 *     Node et le processus refuserait de se terminer tant que le compteur bat,
 *     c'est-à-dire toujours.
 */

import type { Ticker } from '../counter/counter-service.js';

/** Cadenceur système, avec de quoi vérifier qu'il ne retient pas le processus. */
export interface SystemTicker extends Ticker {
  /** Vrai si le minuteur maintient la boucle d'événements en vie. */
  isReferenced(): boolean;
}

export function createSystemTicker(): SystemTicker {
  let timer: ReturnType<typeof setInterval> | null = null;

  function stop(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  return {
    start(intervalMs: number, onTick: () => void): void {
      // Un démarrage annule le précédent : c'est la seule façon de garantir
      // qu'un seul cadenceur bat, quel que soit l'ordre des appels.
      stop();

      const handle = setInterval(onTick, intervalMs);
      handle.unref();
      timer = handle;
    },

    stop,

    isReferenced(): boolean {
      return timer?.hasRef() ?? false;
    },
  };
}
