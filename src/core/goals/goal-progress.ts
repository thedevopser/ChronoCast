import type { GoalsConfig } from '../config/schema.js';
import type { DomainEvent } from '../events/domain-event.js';

/**
 * Traduit un événement en abonnements gagnés. Ne connaît ni l'échelle, ni l'état, ni le compteur :
 * c'est `goal-ladder.ts` qui traduit ensuite un compte en position sur l'échelle.
 */
export function subsGained(event: DomainEvent, goals: GoalsConfig): number {
  switch (event.type) {
    // Le tier n'est pas pondéré. Twitch compte un Tier 3 pour six dans ses propres objectifs : la
    // barre avancerait de six sur un seul abonnement, et l'affichage cesserait d'être lisible.
    case 'sub':
    case 'resub':
      return 1;

    case 'gift':
      return event.total > 0 ? event.total : 0;

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
