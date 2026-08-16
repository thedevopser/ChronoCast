/**
 * L'aperçu représente une toile OBS, pas la place dont dispose le panneau.
 *
 * L'overlay se rend à sa taille réelle — une police de 96 px reste 96 px — puis la toile entière
 * est réduite pour tenir dans la colonne. Sans cela, un compteur plus large que l'iframe est rogné
 * par l'`overflow: hidden` de l'overlay, et l'aperçu ment sur ce qu'OBS affichera.
 */
export const PREVIEW_CANVAS = { width: 1_920, height: 1_080 } as const;

/** En deçà, les chiffres deviennent illisibles ; autant garder une toile rognée mais lisible. */
const MIN_SCALE = 0.1;

export function previewScale(availableWidth: number): number {
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) {
    return MIN_SCALE;
  }

  const fitted = availableWidth / PREVIEW_CANVAS.width;

  return Math.min(1, Math.max(MIN_SCALE, fitted));
}
