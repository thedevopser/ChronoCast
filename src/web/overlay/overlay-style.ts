import type { OverlayConfig } from '../shared/protocol.js';
import { composeGradient, composeTextShadow, withOpacity } from '../shared/css-style.js';

function frameBackground(config: OverlayConfig): string {
  if (!config.frame.enabled) {
    return 'transparent';
  }

  return config.gradient.onFrame ? composeGradient(config.gradient) : config.frame.color;
}

export function overlayCssVariables(config: OverlayConfig): Record<string, string> {
  const gradient = composeGradient(config.gradient);
  const { frame } = config;

  return {
    '--cc-text-background': config.gradient.onText ? gradient : 'none',
    '--cc-text-fill': config.gradient.onText ? 'transparent' : config.color,

    '--cc-frame-width': frame.enabled ? `${String(frame.width)}px` : '0px',
    '--cc-frame-radius': frame.enabled ? `${String(frame.radius)}px` : '0px',
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

    '--cc-text-shadow': composeTextShadow(config.shadow, config.glow),

    '--cc-outline-width': config.outline.enabled ? `${String(config.outline.width)}px` : '0px',
    '--cc-outline-color': config.outline.color,

    '--cc-animation-duration': `${String(config.animation.durationMs)}ms`,

    '--cc-toast-color': config.toast.color,
    '--cc-toast-font-size': `${String(config.toast.fontSize)}px`,
    '--cc-toast-duration': `${String(config.toast.durationMs)}ms`,
  };
}
