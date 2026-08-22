/**
 * Petites compositions de valeurs CSS, partagées par l'overlay du compteur et par la page `/goal`.
 *
 * Chacune prend la forme étroite dont elle a besoin, jamais une configuration entière : c'est ce
 * qui leur permet de servir deux sous-arbres de configuration qui n'ont pas les mêmes réglages.
 */

export interface ShadowSpec {
  readonly enabled: boolean;
  readonly color: string;
  readonly blur: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

export interface GlowSpec {
  readonly enabled: boolean;
  readonly color: string;
  readonly radius: number;
}

export interface GradientSpec {
  readonly angleDeg: number;
  readonly from: string;
  readonly to: string;
}

/** Empile ombre portée et halo dans un unique `text-shadow`, `none` quand les deux sont éteints. */
export function composeTextShadow(shadow: ShadowSpec, glow: GlowSpec): string {
  const layers: string[] = [];

  if (shadow.enabled) {
    layers.push(
      `${String(shadow.offsetX)}px ${String(shadow.offsetY)}px ${String(shadow.blur)}px ${shadow.color}`,
    );
  }

  if (glow.enabled) {
    layers.push(`0 0 ${String(glow.radius)}px ${glow.color}`);
  }

  return layers.length === 0 ? 'none' : layers.join(', ');
}

export function composeGradient(gradient: GradientSpec): string {
  return `linear-gradient(${String(gradient.angleDeg)}deg, ${gradient.from}, ${gradient.to})`;
}

/**
 * Recompose une couleur hexadécimale avec un canal alpha. Les formes courtes — `#abc`, `#abcd` —
 * sont d'abord dépliées, faute de quoi la concaténation rendrait une couleur inexistante.
 */
export function withOpacity(color: string, opacity: number): string {
  const digits = color.replace(/^#/, '');

  const expanded = digits.length <= 4 ? digits.replace(/./g, (digit) => `${digit}${digit}`) : digits;

  const rgb = expanded.slice(0, 6);
  const alpha = Math.round(Math.min(Math.max(opacity, 0), 1) * 255)
    .toString(16)
    .padStart(2, '0');

  return `#${rgb}${alpha}`;
}
