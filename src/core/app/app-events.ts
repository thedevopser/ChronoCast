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
import type { OAuthOutcome } from '../server/oauth-callback.js';
import type { UpdateStatus } from '../update/update-service.js';

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

/** États successifs de la connexion EventSub. */
export type TwitchConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'ready'
  | 'reconnecting';

export interface TwitchStatusPayload {
  readonly status: TwitchConnectionStatus;
  /** Précision destinée à l'affichage, par exemple la cause d'une reconnexion. */
  readonly detail?: string;
}

export interface TwitchRevocationPayload {
  readonly subscriptionType: string;
  /** Motif rapporté par Twitch : `authorization_revoked`, `user_removed`… */
  readonly status: string;
}

export interface TwitchSubscriptionFailedPayload {
  readonly subscriptionType: string;
  /** Vrai si l'absence de cette souscription compromet le fonctionnement. */
  readonly required: boolean;
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

  /** La connexion EventSub a changé d'état. */
  readonly 'twitch:status': TwitchStatusPayload;

  /**
   * Twitch a retiré une souscription.
   *
   * Sans notification, ce cas est invisible : la connexion reste ouverte, mais
   * les événements concernés cessent silencieusement d'arriver.
   */
  readonly 'twitch:revocation': TwitchRevocationPayload;

  /** Une souscription n'a pas pu être créée. */
  readonly 'twitch:subscription-failed': TwitchSubscriptionFailedPayload;

  /**
   * Le flux d'autorisation Twitch s'est achevé, quelle qu'en soit l'issue.
   *
   * Émis à l'arrivée du rappel, donc dans le navigateur système : la fenêtre de
   * l'application, elle, ne voit rien passer. C'est cet événement qui la ramène
   * au premier plan et la fait se recharger. Sans lui, elle resterait à l'étape
   * précédente pendant que l'utilisateur croirait avoir terminé.
   *
   * Distinct de `twitch:status` à dessein : celui-ci change à chaque
   * reconnexion, y compris en plein direct, et ramener la fenêtre au premier
   * plan à ce moment-là passerait par-dessus OBS.
   */
  readonly 'oauth:settled': { readonly outcome: OAuthOutcome };

  /**
   * L'état de la mise à jour automatique a changé.
   *
   * Émis à chaque transition — vérification, téléchargement, prêt, échec — et
   * consommé par deux abonnés qui n'ont rien à voir l'un avec l'autre : le hub
   * WebSocket, qui en fait le bandeau du panneau, et la coquille Electron, qui
   * en fait une entrée du menu du tray.
   *
   * Il n'annonce jamais qu'une installation a eu lieu : elle n'a lieu que sur
   * un clic, et l'application se ferme dans la foulée.
   */
  readonly 'update:status': UpdateStatus;
}
