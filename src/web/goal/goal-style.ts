import { composeGradient, composeTextShadow, withOpacity } from '../shared/css-style.js';
import type { GoalOverlayConfig } from '../shared/protocol.js';

function barFill(config: GoalOverlayConfig): string {
  return config.gradient.onBar ? composeGradient(config.gradient) : config.bar.fillColor;
}

/**
 * Traduit l'apparence de la page `/goal` en variables CSS.
 *
 * Toutes préfixées `--cc-goal-` : les deux pages peuvent alors être visées par une même feuille
 * personnelle sans qu'un réglage de l'une déteigne sur l'autre.
 */
export function goalCssVariables(config: GoalOverlayConfig): Record<string, string> {
  const gradient = composeGradient(config.gradient);
  const { bar } = config;

  return {
    '--cc-goal-font-family': config.fontFamily,
    '--cc-goal-font-size': `${String(config.fontSize)}px`,
    '--cc-goal-font-weight': String(config.fontWeight),
    '--cc-goal-letter-spacing': `${String(config.letterSpacing)}px`,
    '--cc-goal-color': config.color,
    '--cc-goal-text-align': config.textAlign,

    '--cc-goal-text-background': config.gradient.onText ? gradient : 'none',
    '--cc-goal-text-fill': config.gradient.onText ? 'transparent' : config.color,

    '--cc-goal-text-shadow': composeTextShadow(config.shadow, config.glow),

    '--cc-goal-outline-width': config.outline.enabled ? `${String(config.outline.width)}px` : '0px',
    '--cc-goal-outline-color': config.outline.color,

    '--cc-goal-bar-height': `${String(bar.height)}px`,
    '--cc-goal-bar-radius': `${String(bar.radius)}px`,
    '--cc-goal-bar-fill': barFill(config),
    '--cc-goal-bar-track': withOpacity(bar.trackColor, bar.trackOpacity),
    '--cc-goal-bar-border-width': `${String(bar.borderWidth)}px`,
    '--cc-goal-bar-border-color': bar.borderColor,

    '--cc-goal-announce-color': config.announce.color,
    '--cc-goal-announce-duration': `${String(config.announce.durationMs)}ms`,
  };
}
