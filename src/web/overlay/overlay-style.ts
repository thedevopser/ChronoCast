import type { OverlayConfig } from '../shared/protocol.js';

function composeTextShadow(config: OverlayConfig): string {
  const layers: string[] = [];

  if (config.shadow.enabled) {
    const { offsetX, offsetY, blur, color } = config.shadow;
    layers.push(`${String(offsetX)}px ${String(offsetY)}px ${String(blur)}px ${color}`);
  }

  if (config.glow.enabled) {
    layers.push(`0 0 ${String(config.glow.radius)}px ${config.glow.color}`);
  }

  return layers.length === 0 ? 'none' : layers.join(', ');
}

function composeGradient(config: OverlayConfig): string {
  const { angleDeg, from, to } = config.gradient;
  return `linear-gradient(${String(angleDeg)}deg, ${from}, ${to})`;
}

function withOpacity(color: string, opacity: number): string {
  const digits = color.replace(/^#/, '');

  const expanded = digits.length <= 4 ? digits.replace(/./g, (digit) => `${digit}${digit}`) : digits;

  const rgb = expanded.slice(0, 6);
  const alpha = Math.round(Math.min(Math.max(opacity, 0), 1) * 255)
    .toString(16)
    .padStart(2, '0');

  return `#${rgb}${alpha}`;
}

function frameBackground(config: OverlayConfig): string {
  if (!config.frame.enabled) {
    return 'transparent';
  }

  return config.gradient.onFrame ? composeGradient(config) : config.frame.color;
}

export function overlayCssVariables(config: OverlayConfig): Record<string, string> {
  const gradient = composeGradient(config);
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

    '--cc-text-shadow': composeTextShadow(config),

    '--cc-outline-width': config.outline.enabled ? `${String(config.outline.width)}px` : '0px',
    '--cc-outline-color': config.outline.color,

    '--cc-animation-duration': `${String(config.animation.durationMs)}ms`,

    '--cc-toast-color': config.toast.color,
    '--cc-toast-font-size': `${String(config.toast.fontSize)}px`,
    '--cc-toast-duration': `${String(config.toast.durationMs)}ms`,
  };
}
