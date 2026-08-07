/**
 * File d'attente des bulles d'événement.
 *
 * Une bulle annonce qu'un spectateur vient de créditer du temps. Le problème
 * qu'elle pose n'est pas l'affichage mais la **salve** : un don groupé de cent
 * abonnements produit cent événements en quelques secondes. Sans file, cent
 * bulles se superposeraient, illisibles, et l'overlay resterait encombré bien
 * après la fin de la salve.
 *
 * Deux règles, donc : une bulle à la fois, et une file plafonnée dont on écarte
 * les **plus anciennes** en attente. Le spectateur qui vient d'offrir doit se
 * voir remercié ; une bulle vieille de trois minutes n'intéresse plus personne,
 * et le compteur, lui, a déjà été crédité de toute façon.
 *
 * Aucun minuteur : l'instant est passé en argument, comme pour le décompte.
 * C'est la même raison — une durée d'affichage de quatre secondes doit se
 * vérifier en quelques microsecondes, et le module doit tourner dans un
 * conteneur sans navigateur.
 */

import type { DomainEventType } from '../shared/protocol.js';

export interface Toast {
  /** Identifiant de l'événement d'origine, utile pour éviter un réaffichage. */
  readonly id: string;
  /** Contenu hostile par défaut : n'est écrit qu'à travers `safe-dom`. */
  readonly userName: string;
  readonly rewardSeconds: number;
  readonly type: DomainEventType;

  /**
   * Libellé affiché au-dessus du pseudo, ou absent.
   *
   * La file ne l'interprète pas : elle le porte. Renseigné pour les seules
   * commandes de chat, il vient de la configuration locale et non du réseau —
   * ce qui ne dispense de rien : l'overlay l'écrit par `setText` comme tout le
   * reste.
   */
  readonly label?: string;
}

export interface ToastQueueOptions {
  /**
   * Nombre maximal de bulles gardées en attente.
   *
   * Vingt bulles de quatre secondes font déjà plus d'une minute de retard sur
   * l'événement annoncé : au-delà, l'information n'a plus de valeur.
   */
  readonly maxPending?: number;
}

export interface ToastQueue {
  /** Met une bulle en file, avec la durée d'affichage en vigueur à cet instant. */
  push(toast: Toast, nowMs: number, durationMs: number): void;
  /**
   * Bulle à afficher maintenant, ou `null`.
   *
   * **Fait avancer la file** : appelée à chaque image par la boucle de rendu,
   * c'est elle qui retire une bulle échue et promeut la suivante. Séparer la
   * lecture de l'avancement obligerait l'appelant à tenir cet ordre lui-même.
   */
  current(nowMs: number): Toast | null;
  pendingCount(): number;
  clear(): void;
}

const DEFAULT_MAX_PENDING = 20;

interface Scheduled {
  readonly toast: Toast;
  readonly durationMs: number;
}

export function createToastQueue(options: ToastQueueOptions = {}): ToastQueue {
  const maxPending = options.maxPending ?? DEFAULT_MAX_PENDING;

  let visible: { toast: Toast; expiresAtMs: number } | null = null;
  const pending: Scheduled[] = [];

  return {
    push(toast: Toast, nowMs: number, durationMs: number): void {
      if (visible === null) {
        visible = { toast, expiresAtMs: nowMs + durationMs };
        return;
      }

      pending.push({ toast, durationMs });

      // On écarte par la tête : les plus anciennes en attente sont celles dont
      // l'annonce a le moins de valeur.
      while (pending.length > maxPending) {
        pending.shift();
      }
    },

    current(nowMs: number): Toast | null {
      while (visible !== null && nowMs >= visible.expiresAtMs) {
        const next = pending.shift();
        visible =
          next === undefined
            ? null
            : // La durée court à partir de l'affichage réel, et non de la mise
              // en file : une bulle attendue trois secondes doit malgré tout
              // rester lisible pendant toute sa durée.
              { toast: next.toast, expiresAtMs: nowMs + next.durationMs };
      }

      return visible?.toast ?? null;
    },

    pendingCount(): number {
      return pending.length;
    },

    clear(): void {
      visible = null;
      pending.length = 0;
    },
  };
}
