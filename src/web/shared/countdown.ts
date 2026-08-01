/**
 * Décompte local entre deux diffusions du serveur.
 *
 * Le hub ne diffuse l'érosion naturelle du compteur qu'une fois par seconde :
 * afficher directement ce qu'il envoie donnerait un compteur qui saute d'une
 * seconde à l'autre. L'overlay interpole donc localement, à la cadence de
 * l'écran, et ce module contient toute cette logique.
 *
 * Il ne connaît ni horloge, ni `requestAnimationFrame` : l'instant lui est
 * passé en argument à chaque appel. C'est ce qui permet de vérifier une coupure
 * de cinq minutes en une fraction de milliseconde, et ce qui rend le module
 * exécutable dans un conteneur sans navigateur.
 *
 * L'instant attendu vient d'une **horloge monotone** (`performance.now()` côté
 * navigateur) et non de `Date.now()`. Un passage à l'heure d'hiver offrirait
 * sinon une heure de subathon, ou en volerait une.
 *
 * ## La règle centrale
 *
 * Une resynchronisation `tick` ne peut que **confirmer ou rattraper à la
 * baisse**. L'interpolation locale dérive nécessairement de l'horloge du
 * serveur ; accepter une valeur plus haute ferait remonter le compteur à
 * l'écran une fois par seconde, indéfiniment.
 *
 * Une resynchronisation `authoritative` s'impose telle quelle, à la hausse
 * comme à la baisse. Elle correspond à un fait réel : un crédit de temps qu'un
 * spectateur vient de payer, une action manuelle du streamer, ou l'instantané
 * reçu au retour d'une coupure — où le mode gel fait que le serveur détient
 * plus de temps que l'overlay, qui a continué à décompter dans le vide.
 */

import type { CounterStatus } from './protocol.js';

/** Ce dont le décompte a besoin, extrait de `CounterState`. */
export interface CountdownState {
  readonly remainingMs: number;
  readonly status: CounterStatus;
}

/**
 * Nature d'une resynchronisation.
 *
 * - `tick` : érosion de routine, diffusée une fois par seconde ;
 * - `authoritative` : instantané complet, mutation, ou action manuelle.
 */
export type SyncMode = 'tick' | 'authoritative';

export interface Countdown {
  /** Prend en compte un état reçu du serveur, daté par l'horloge monotone locale. */
  sync(state: CountdownState, nowMs: number, mode: SyncMode): void;
  /** Temps restant à afficher à cet instant, en millisecondes. */
  remainingAt(nowMs: number): number;
  getStatus(): CounterStatus;
}

/** Seul état où le temps s'écoule. Partout ailleurs, l'affichage est figé. */
function isTicking(status: CounterStatus): boolean {
  return status === 'running';
}

export function createCountdown(): Countdown {
  let remainingMs = 0;
  let status: CounterStatus = 'idle';
  let syncedAtMs = 0;

  function remainingAt(nowMs: number): number {
    if (!isTicking(status)) {
      return remainingMs;
    }
    return Math.max(0, remainingMs - (nowMs - syncedAtMs));
  }

  return {
    sync(state: CountdownState, nowMs: number, mode: SyncMode): void {
      const displayed = remainingAt(nowMs);

      remainingMs =
        mode === 'tick'
          ? // Le serveur fait autorité à la baisse uniquement : il corrige une
            // dérive, il ne rend jamais du temps déjà consommé à l'écran.
            Math.min(displayed, state.remainingMs)
          : state.remainingMs;

      status = state.status;

      // La base de l'interpolation est rafraîchie même lorsque la valeur reçue
      // est écartée : sans cela, la dérive se cumulerait à partir d'un point de
      // référence de plus en plus ancien.
      syncedAtMs = nowMs;
    },

    remainingAt,

    getStatus(): CounterStatus {
      return status;
    },
  };
}
