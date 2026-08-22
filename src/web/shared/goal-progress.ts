/**
 * Part parcourue du palier courant, entre 0 et 1. Pilote la barre par une variable CSS.
 *
 * Partagée par le panneau et par la page `/goal` : `src/web/goal/` ne peut pas importer du panneau
 * sans le traîner en entier dans une Browser Source.
 */
export function goalProgressRatio(goal: {
  readonly subs: number;
  readonly from: number;
  readonly to: number;
}): number {
  const span = goal.to - goal.from;
  if (span <= 0) {
    return 0;
  }

  const walked = (goal.subs - goal.from) / span;
  return Math.min(1, Math.max(0, walked));
}
