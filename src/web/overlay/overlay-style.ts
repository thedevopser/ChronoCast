/**
 * Configuration d'apparence vers variables CSS.
 *
 * La CSP servie par ChronoCast est stricte : `style-src 'self'`, sans
 * `unsafe-inline`. Ni balise `<style>`, ni attribut `style=` écrit dans le
 * HTML, donc aucune feuille de style ne peut être composée à partir de la
 * configuration. Le CSSOM, lui, n'est pas couvert par la directive : c'est par
 * lui que passe toute la personnalisation, sous forme de variables CSS que la
 * feuille statique consomme.
 *
 * Ce module est purement calculatoire — configuration en entrée, dictionnaire
 * en sortie — et n'écrit rien. La pose revient à `safe-dom.setCssVariables`,
 * seul point du front autorisé à toucher au document.
 *
 * Sur l'innocuité des valeurs : la configuration est écrite par le streamer,
 * pas par un spectateur, et `setProperty` rejette silencieusement une valeur
 * syntaxiquement invalide. Une chaîne biscornue dans `fontFamily` ne peut donc
 * pas s'échapper de sa déclaration ni en ouvrir une autre.
 */

import type { OverlayConfig } from '../shared/protocol.js';

/**
 * Compose `text-shadow`.
 *
 * L'ombre portée et la lueur sont deux réglages indépendants qui alimentent la
 * **même** propriété CSS. Les écrire l'un après l'autre ferait disparaître le
 * premier ; ils sont donc empilés en une liste, dans l'ordre où on les voit —
 * l'ombre au plus près du texte, la lueur autour.
 */
function composeTextShadow(config: OverlayConfig): string {
  const layers: string[] = [];

  if (config.shadow.enabled) {
    const { offsetX, offsetY, blur, color } = config.shadow;
    layers.push(`${String(offsetX)}px ${String(offsetY)}px ${String(blur)}px ${color}`);
  }

  if (config.glow.enabled) {
    // Une lueur est une ombre sans décalage : elle rayonne autour du glyphe.
    layers.push(`0 0 ${String(config.glow.radius)}px ${config.glow.color}`);
  }

  return layers.length === 0 ? 'none' : layers.join(', ');
}

/**
 * Compose le dégradé.
 *
 * Une seule définition, deux cibles indépendantes : c'est l'appelant qui décide
 * s'il l'applique au texte, au cadre, aux deux ou à rien. Dédoubler les
 * couleurs n'aurait servi qu'à donner l'occasion de les désaccorder.
 */
function composeGradient(config: OverlayConfig): string {
  const { angleDeg, from, to } = config.gradient;
  return `linear-gradient(${String(angleDeg)}deg, ${from}, ${to})`;
}

/**
 * Recompose une couleur et son opacité en une notation à huit chiffres.
 *
 * L'opacité est un réglage séparé parce que `<input type="color">` ne sait pas
 * exprimer la transparence. Deux précautions valent d'être signalées : la
 * notation courte `#RGB` est légale au schéma et doit être développée avant
 * qu'on y colle deux chiffres — sans quoi la couleur serait silencieusement
 * fausse — et une opacité déjà portée par la couleur est **remplacée**, faute
 * de quoi le réglage visible dans le panneau n'aurait aucun effet.
 */
function withOpacity(color: string, opacity: number): string {
  const digits = color.replace(/^#/, '');

  // `#RGB` et `#RGBA` : chaque chiffre vaut pour deux. Par `replace` et non par
  // un découpage caractère à caractère, qui casserait sur autre chose que de
  // l'ASCII — ce que le schéma interdit ici, mais la règle vaut par sa constance.
  const expanded = digits.length <= 4 ? digits.replace(/./g, (digit) => `${digit}${digit}`) : digits;

  const rgb = expanded.slice(0, 6);
  const alpha = Math.round(Math.min(Math.max(opacity, 0), 1) * 255)
    .toString(16)
    .padStart(2, '0');

  return `#${rgb}${alpha}`;
}

/** Peinture du trait du cadre : rien, le dégradé, ou sa couleur unie. */
function frameBackground(config: OverlayConfig): string {
  if (!config.frame.enabled) {
    return 'transparent';
  }

  return config.gradient.onFrame ? composeGradient(config) : config.frame.color;
}

/** Variables CSS décrivant l'apparence de l'overlay. */
export function overlayCssVariables(config: OverlayConfig): Record<string, string> {
  const gradient = composeGradient(config);
  const { frame } = config;

  return {
    /*
     * Peinture du texte.
     *
     * `color` n'accepte pas d'image : un dégradé ne peut être appliqué qu'en
     * découpant un fond à la forme des glyphes, ce qui impose de rendre la
     * couleur transparente. D'où le couple de variables, et la règle qui va
     * avec — la couleur doit redevenir opaque dès que le dégradé s'éteint,
     * sans quoi le compteur disparaît de la scène.
     */
    '--cc-text-background': config.gradient.onText ? gradient : 'none',
    '--cc-text-fill': config.gradient.onText ? 'transparent' : config.color,

    /*
     * Cadre.
     *
     * Le trait est un `padding` sur l'enveloppe, et non une bordure : c'est le
     * seul moyen d'avoir à la fois un dégradé et des coins arrondis, là où
     * `border-image` fait perdre le rayon. Le rayon intérieur est creusé de
     * l'épaisseur du trait, faute de quoi un liseré apparaît aux angles.
     */
    '--cc-frame-width': frame.enabled ? `${String(frame.width)}px` : '0px',
    '--cc-frame-radius': frame.enabled ? `${String(frame.radius)}px` : '0px',
    '--cc-frame-inner-radius': frame.enabled
      ? `${String(Math.max(frame.radius - frame.width, 0))}px`
      : '0px',
    '--cc-frame-padding-x': frame.enabled ? `${String(frame.paddingX)}px` : '0px',
    '--cc-frame-padding-y': frame.enabled ? `${String(frame.paddingY)}px` : '0px',
    '--cc-frame-background': frameBackground(config),
    '--cc-frame-fill': frame.enabled ? withOpacity(frame.fillColor, frame.fillOpacity) : 'transparent',

    '--cc-font-family': config.fontFamily,
    '--cc-font-size': `${String(config.fontSize)}px`,
    '--cc-font-weight': String(config.fontWeight),
    '--cc-letter-spacing': `${String(config.letterSpacing)}px`,
    '--cc-color': config.color,
    '--cc-text-align': config.textAlign,

    '--cc-text-shadow': composeTextShadow(config),

    // Le contour est neutralisé par une largeur nulle et non par sa couleur :
    // le fond d'une Browser Source est transparent, il n'y a donc aucune
    // couleur « invisible » sur laquelle se rabattre.
    '--cc-outline-width': config.outline.enabled ? `${String(config.outline.width)}px` : '0px',
    '--cc-outline-color': config.outline.color,

    '--cc-animation-duration': `${String(config.animation.durationMs)}ms`,

    '--cc-toast-color': config.toast.color,
    '--cc-toast-font-size': `${String(config.toast.fontSize)}px`,
    '--cc-toast-duration': `${String(config.toast.durationMs)}ms`,
  };
}
