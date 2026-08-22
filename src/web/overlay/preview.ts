import type { OverlayConfig } from '../shared/protocol.js';
import {
  matchesTree,
  readPreviewEnvelope,
  type PreviewSource,
  type Shape,
} from '../shared/preview.js';

export { PREVIEW_MESSAGE_TYPE, type PreviewSource } from '../shared/preview.js';

export type PreviewMessage =
  | { readonly kind: 'config'; readonly overlay: OverlayConfig }
  | { readonly kind: 'demo' };

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

export function readPreviewMessage(
  source: PreviewSource,
  expectedOrigin: string,
): PreviewMessage | null {
  const data = readPreviewEnvelope(source, expectedOrigin);
  if (data === null) {
    return null;
  }

  if (data['kind'] === 'demo') {
    return { kind: 'demo' };
  }

  if (data['kind'] !== 'config') {
    return null;
  }

  const overlay = data['overlay'];
  return matchesTree(overlay, ROOT, BRANCHES) ? { kind: 'config', overlay: overlay as OverlayConfig } : null;
}
