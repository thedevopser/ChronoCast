import type { GoalsConfig } from '../config/schema.js';
import type { DomainEvent } from '../events/domain-event.js';

/**
 * Traduit un événement en points gagnés par la barre d'objectif, selon son barème de points. Ne
 * connaît ni l'échelle, ni l'état, ni le compteur, ni le barème de temps : c'est `goal-ladder.ts`
 * qui traduit ensuite un compte en position sur l'échelle.
 */
export function pointsGained(event: DomainEvent, goals: GoalsConfig): number {
  const countsSubsOnly = goals.mode === 'subs';
  const weights = countsSubsOnly ? goals.subWeights : goals.points;

  switch (event.type) {
    case 'sub':
      return weights.sub[event.tier];

    case 'resub':
      return weights.resub[event.tier];

    case 'gift':
      return event.total > 0 ? event.total * weights.gift[event.tier] : 0;

    // En mode points, un bit vaut un point, sans réglage : c'est le poids des abonnements qui se
    // règle. En mode subs, la barre ne compte que des abonnements.
    case 'bits':
      return countsSubsOnly || event.bits <= 0 ? 0 : event.bits;

    // Un crédit accordé à la main par un modérateur ne gonfle pas une promesse faite aux
    // spectateurs : elle en deviendrait mensongère.
    case 'command':
      return 0;
  }
}
