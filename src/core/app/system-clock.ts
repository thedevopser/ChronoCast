/**
 * Implémentation réelle du port {@link Clock}.
 *
 * Partagée par la coquille Electron et le point d'entrée headless : il n'y a
 * aucune raison d'avoir deux horloges, et deux implémentations finiraient par
 * diverger sur exactement le détail qui compte.
 *
 * Ce détail, c'est la séparation des deux sources de temps.
 *
 *   - `now()` s'appuie sur `Date.now()`, l'heure du système. Elle sert aux
 *     horodatages et **peut reculer** : changement d'heure, synchronisation NTP,
 *     réglage manuel de l'utilisateur.
 *   - `monotonicMs()` s'appuie sur `performance.now()`, qui ne recule jamais.
 *     C'est elle, et elle seule, qui fait décompter le compteur.
 *
 * Les confondre offrirait une heure de subathon chaque dernier dimanche
 * d'octobre — et en retirerait une chaque dernier dimanche de mars, ce qui se
 * remarquerait davantage.
 */

import type { Clock } from './ports.js';

export function createSystemClock(): Clock {
  return {
    now(): number {
      return Date.now();
    },

    monotonicMs(): number {
      // `performance.now()` est un global standard, disponible dans Node comme
      // dans le navigateur : le noyau n'a rien à importer pour l'obtenir.
      return performance.now();
    },
  };
}
