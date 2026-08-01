/**
 * Catalogue des événements circulant sur le bus applicatif.
 *
 * Contrat unique entre producteurs et consommateurs : le service compteur et le
 * client Twitch publient, le serveur WebSocket, l'historique et la coquille
 * Electron consomment. Personne ne connaît personne.
 *
 * Ce fichier ne contient que des types : rien à y tester.
 */

import type { CounterState } from '../counter/counter-state.js';
import type { RewardComputation } from '../counter/reward-engine.js';
import type { DomainEvent } from '../events/domain-event.js';

/** Origine d'une modification du compteur, pour l'historique et l'affichage. */
export type CounterChangeOrigin = 'tick' | 'manual' | 'twitch' | 'restore';

export interface CounterChangedPayload {
  readonly state: CounterState;
  readonly origin: CounterChangeOrigin;
  /** Variation appliquée, en millisecondes. Négative pour un retrait. */
  readonly deltaMs: number;
  readonly reason: string;
}

export interface CounterEventAppliedPayload {
  readonly event: DomainEvent;
  readonly reward: RewardComputation;
  readonly state: CounterState;
}

export interface CounterPersistFailedPayload {
  readonly state: CounterState;
  readonly error: unknown;
}

/**
 * Catalogue complet.
 *
 * Étendre le bus revient à ajouter une entrée ici : le typage impose ensuite la
 * bonne charge utile à chaque point d'émission et d'abonnement.
 */
export interface AppEvents extends Record<string, unknown> {
  /** Le compteur a changé de valeur ou d'état. */
  readonly 'counter:changed': CounterChangedPayload;

  /** Le compteur vient d'atteindre son plancher. Émis une seule fois. */
  readonly 'counter:finished': { readonly state: CounterState };

  /** Un événement Twitch a été évalué par le barème. */
  readonly 'counter:event-applied': CounterEventAppliedPayload;

  /**
   * L'état n'a pas pu être écrit sur le disque.
   *
   * Le compteur continue de fonctionner en mémoire : l'administration doit
   * pouvoir alerter l'utilisateur sans que le subathon ne s'interrompe.
   */
  readonly 'counter:persist-failed': CounterPersistFailedPayload;
}
