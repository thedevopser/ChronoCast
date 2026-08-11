/**
 * Géométrie de l'image d'affiche 9:16 du Microsoft Store.
 *
 * Elle est exprimée en fractions des dimensions de la toile, et non en pixels :
 * les deux tailles attendues par Partner Center (720 × 1080 et 1440 × 2160) sont
 * ainsi rendues nativement, sans qu'aucune ne soit la réduction de l'autre.
 *
 * Le badge est posé au tiers optique haut plutôt qu'au centre : le Store
 * surimprime le nom de l'application et le bouton d'installation sur le bas de
 * l'affiche, qui doit rester sombre et libre.
 */

const BADGE_FRACTION = 0.625;
const BADGE_CENTER_Y_FRACTION = 0.38;

export function posterGeometry(width, height) {
  const badgeSize = Math.round(width * BADGE_FRACTION);

  return {
    badgeSize,
    badgeX: Math.round((width - badgeSize) / 2),
    badgeY: Math.round(height * BADGE_CENTER_Y_FRACTION - badgeSize / 2),
  };
}
