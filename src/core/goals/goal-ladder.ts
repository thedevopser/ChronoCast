import type { GoalTier } from '../config/schema.js';

export interface LadderPosition {
  /** Rang du palier visé, ou -1 sur une échelle sans palier. */
  readonly index: number;

  readonly total: number;

  /** Borne basse, dérivée du palier précédent : jamais stockée, donc jamais incohérente. */
  readonly from: number;

  readonly to: number;

  readonly label: string;

  /** Vrai au-delà du dernier palier, la position restant celle du dernier. */
  readonly complete: boolean;
}

const EMPTY: LadderPosition = {
  index: -1,
  total: 0,
  from: 0,
  to: 0,
  label: '',
  complete: false,
};

/**
 * Trie l'échelle et écarte les seuils en double. Appelée à la lecture, jamais à l'écriture : le
 * schéma n'a pas de `.refine()`, faute de quoi une échelle mal ordonnée ferait tomber toute la
 * configuration au chargement.
 */
export function normalizeLadder(tiers: readonly GoalTier[]): readonly GoalTier[] {
  const seen = new Set<number>();
  const kept: GoalTier[] = [];

  for (const tier of tiers) {
    if (seen.has(tier.target)) {
      continue;
    }
    seen.add(tier.target);
    kept.push(tier);
  }

  return kept.sort((left, right) => left.target - right.target);
}

export function positionAt(count: number, tiers: readonly GoalTier[]): LadderPosition {
  const ladder = normalizeLadder(tiers);
  if (ladder.length === 0) {
    return EMPTY;
  }

  const index = ladder.findIndex((tier) => tier.target > count);
  const complete = index === -1;
  const position = complete ? ladder.length - 1 : index;

  const tier = ladder[position];
  if (tier === undefined) {
    return EMPTY;
  }

  return {
    index: position,
    total: ladder.length,
    from: ladder[position - 1]?.target ?? 0,
    to: tier.target,
    label: tier.label,
    complete,
  };
}

/**
 * Les paliers dont le seuil tombe dans `]before, after]`. Rend la liste et non le dernier : un don
 * groupé de cent abonnements traverse l'échelle entière, et chaque promesse intermédiaire doit
 * pouvoir être annoncée.
 */
export function tiersCrossed(
  before: number,
  after: number,
  tiers: readonly GoalTier[],
): readonly GoalTier[] {
  return normalizeLadder(tiers).filter((tier) => tier.target > before && tier.target <= after);
}
