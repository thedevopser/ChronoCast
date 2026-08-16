import type { OverlayConfig } from '../shared/protocol.js';

export const PREVIEW_MESSAGE_TYPE = 'chronocast:overlay-preview';

export type PreviewMessage =
  | { readonly kind: 'config'; readonly overlay: OverlayConfig }
  | { readonly kind: 'demo' };

export interface PreviewSource {
  readonly origin: string;
  readonly data: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type Shape = Readonly<Record<string, 'string' | 'number' | 'boolean'>>;

const ROOT: Shape = {
  fontFamily: 'string',
  fontSize: 'number',
  fontWeight: 'number',
  letterSpacing: 'number',
  color: 'string',
  showDays: 'boolean',
  hideEmptyHours: 'boolean',
  textAlign: 'string',
  enableCustomCss: 'boolean',
};

const BRANCHES: Readonly<Record<string, Shape>> = {
  shadow: { enabled: 'boolean', color: 'string', blur: 'number', offsetX: 'number', offsetY: 'number' },
  outline: { enabled: 'boolean', color: 'string', width: 'number' },
  glow: { enabled: 'boolean', color: 'string', radius: 'number' },
  gradient: {
    onText: 'boolean',
    onFrame: 'boolean',
    from: 'string',
    to: 'string',
    angleDeg: 'number',
  },
  frame: {
    enabled: 'boolean',
    color: 'string',
    width: 'number',
    radius: 'number',
    paddingX: 'number',
    paddingY: 'number',
    fillColor: 'string',
    fillOpacity: 'number',
  },
  animation: { onAdd: 'string', durationMs: 'number' },
  toast: { enabled: 'boolean', durationMs: 'number', color: 'string', fontSize: 'number' },
};

function matches(value: unknown, shape: Shape): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return Object.entries(shape).every(([key, kind]) => typeof value[key] === kind);
}

// Le panneau envoie toujours une configuration complète : une forme incomplète signale une page
// qui n'est pas celle qu'on croit, et `overlayCssVariables` lèverait en lisant une branche absente.
function isOverlayConfig(value: unknown): value is OverlayConfig {
  if (!matches(value, ROOT)) {
    return false;
  }

  return Object.entries(BRANCHES).every(([key, shape]) =>
    matches((value as Record<string, unknown>)[key], shape),
  );
}

export function readPreviewMessage(source: PreviewSource, expectedOrigin: string): PreviewMessage | null {
  if (source.origin !== expectedOrigin) {
    return null;
  }

  const { data } = source;
  if (!isRecord(data) || data['type'] !== PREVIEW_MESSAGE_TYPE) {
    return null;
  }

  if (data['kind'] === 'demo') {
    return { kind: 'demo' };
  }

  if (data['kind'] !== 'config') {
    return null;
  }

  const overlay = data['overlay'];
  return isOverlayConfig(overlay) ? { kind: 'config', overlay } : null;
}
