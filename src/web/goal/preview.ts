import type { GoalOverlayConfig } from '../shared/protocol.js';
import {
  matchesTree,
  readPreviewEnvelope,
  type PreviewSource,
  type Shape,
} from '../shared/preview.js';

const ROOT: Shape = {
  fontFamily: 'string',
  fontSize: 'number',
  fontWeight: 'number',
  letterSpacing: 'number',
  color: 'string',
  textAlign: 'string',
  showCount: 'boolean',
};

const BRANCHES: Readonly<Record<string, Shape>> = {
  bar: {
    height: 'number',
    radius: 'number',
    fillColor: 'string',
    trackColor: 'string',
    trackOpacity: 'number',
    borderWidth: 'number',
    borderColor: 'string',
  },
  shadow: { enabled: 'boolean', color: 'string', blur: 'number', offsetX: 'number', offsetY: 'number' },
  outline: { enabled: 'boolean', color: 'string', width: 'number' },
  glow: { enabled: 'boolean', color: 'string', radius: 'number' },
  gradient: {
    onText: 'boolean',
    onBar: 'boolean',
    from: 'string',
    to: 'string',
    angleDeg: 'number',
  },
  announce: { enabled: 'boolean', durationMs: 'number', color: 'string', text: 'string' },
};

/**
 * Le brouillon d'apparence poussé par le panneau, ou `null`.
 *
 * La page `/goal` n'a pas de message de démonstration : une annonce d'essai passe par le canal
 * WebSocket, si bien qu'elle joue dans l'aperçu **et** dans OBS du même geste.
 */
export function readGoalPreviewMessage(
  source: PreviewSource,
  expectedOrigin: string,
): GoalOverlayConfig | null {
  const data = readPreviewEnvelope(source, expectedOrigin);
  if (data?.['kind'] !== 'config') {
    return null;
  }

  const goalOverlay = data['goalOverlay'];
  return matchesTree(goalOverlay, ROOT, BRANCHES) ? (goalOverlay as GoalOverlayConfig) : null;
}
