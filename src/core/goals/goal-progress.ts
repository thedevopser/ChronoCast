import type { GoalsConfig } from '../config/schema.js';
import type { DomainEvent } from '../events/domain-event.js';

/**
 * Traduit un événement en points gagnés par la barre d'objectif, selon son barème de points. Ne
 * connaît ni l'échelle, ni l'état, ni le compteur, ni le barème de temps : c'est `goal-ladder.ts`
 * qui traduit ensuite un compte en position sur l'échelle.
 */
export function pointsGained(event: DomainEvent, goals: GoalsConfig): number {
  switch (event.type) {
    case 'sub':
      return goals.points.sub[event.tier];

    case 'resub':
      return goals.points.resub[event.tier];

    case 'gift':
      return event.total > 0 ? event.total * goals.points.gift[event.tier] : 0;

    case 'bits': {
      if (event.bits <= 0) {
        return 0;
      }
      // Sans reste conservé : le garder demanderait un état de plus à persister, pour une barre
      // qui avancerait sans qu'aucun événement ne l'explique.
      return Math.floor(event.bits / goals.bitsPerSub);
    }

    // Un crédit accordé à la main par un modérateur ne gonfle pas une promesse faite aux
    // spectateurs : elle en deviendrait mensongère.
    case 'command':
      return 0;
  }
}
