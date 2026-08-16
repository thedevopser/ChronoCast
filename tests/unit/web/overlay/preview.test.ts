import { describe, expect, it } from 'vitest';

import type { OverlayConfig } from '../../../../src/web/shared/protocol.js';
import { PREVIEW_MESSAGE_TYPE, readPreviewMessage } from '../../../../src/web/overlay/preview.js';

const ORIGIN = 'http://127.0.0.1:3777';

const OVERLAY: OverlayConfig = {
  fontFamily: 'Inter, Segoe UI, system-ui, sans-serif',
  fontSize: 96,
  fontWeight: 700,
  letterSpacing: 0,
  color: '#FFFFFF',
  showDays: true,
  hideEmptyHours: false,
  textAlign: 'center',
  shadow: { enabled: true, color: '#000000CC', blur: 12, offsetX: 0, offsetY: 4 },
  outline: { enabled: false, color: '#000000', width: 2 },
  glow: { enabled: false, color: '#9146FF', radius: 20 },
  animation: { onAdd: 'pulse', durationMs: 600 },
  toast: { enabled: true, durationMs: 4_000, color: '#9146FF', fontSize: 28 },
  gradient: { onText: false, onFrame: false, from: '#FF3D7F', to: '#FF9A3D', angleDeg: 100 },
  frame: {
    enabled: false,
    color: '#9146FF',
    width: 4,
    radius: 18,
    paddingX: 24,
    paddingY: 12,
    fillColor: '#000000',
    fillOpacity: 0,
  },
  enableCustomCss: false,
};

function read(data: unknown, origin = ORIGIN) {
  return readPreviewMessage({ origin, data }, ORIGIN);
}

describe('readPreviewMessage', () => {
  it('accepte une configuration complète venue de la même origine', () => {
    const outcome = read({ type: PREVIEW_MESSAGE_TYPE, kind: 'config', overlay: OVERLAY });

    expect(outcome).toStrictEqual({ kind: 'config', overlay: OVERLAY });
  });

  it('accepte la demande de démonstration', () => {
    expect(read({ type: PREVIEW_MESSAGE_TYPE, kind: 'demo' })).toStrictEqual({ kind: 'demo' });
  });

  it('refuse une origine étrangère', () => {
    const message = { type: PREVIEW_MESSAGE_TYPE, kind: 'config', overlay: OVERLAY };

    expect(read(message, 'https://evil.test')).toBeNull();
    expect(read(message, 'http://localhost:3777')).toBeNull();
    expect(read(message, 'null')).toBeNull();
  });

  it('refuse un message sans le marqueur attendu', () => {
    expect(read({ kind: 'config', overlay: OVERLAY })).toBeNull();
    expect(read({ type: 'autre-chose', kind: 'config', overlay: OVERLAY })).toBeNull();
  });

  it('refuse une donnée qui n’est pas un objet', () => {
    for (const hostile of [null, undefined, 42, 'texte', [], true]) {
      expect(read(hostile)).toBeNull();
    }
  });

  it('refuse un genre inconnu', () => {
    expect(read({ type: PREVIEW_MESSAGE_TYPE, kind: 'reset' })).toBeNull();
    expect(read({ type: PREVIEW_MESSAGE_TYPE })).toBeNull();
  });

  it('refuse une configuration incomplète plutôt que de la laisser casser l’overlay', () => {
    const { shadow: _shadow, ...withoutShadow } = OVERLAY;

    expect(read({ type: PREVIEW_MESSAGE_TYPE, kind: 'config', overlay: withoutShadow })).toBeNull();
    expect(read({ type: PREVIEW_MESSAGE_TYPE, kind: 'config', overlay: {} })).toBeNull();
    expect(read({ type: PREVIEW_MESSAGE_TYPE, kind: 'config' })).toBeNull();
    expect(read({ type: PREVIEW_MESSAGE_TYPE, kind: 'config', overlay: 'tout blanc' })).toBeNull();
  });

  it('refuse une configuration dont une feuille a le mauvais type', () => {
    const message = {
      type: PREVIEW_MESSAGE_TYPE,
      kind: 'config',
      overlay: { ...OVERLAY, fontSize: '96px' },
    };

    expect(read(message)).toBeNull();
  });

  it('ne lève jamais', () => {
    for (const hostile of [{ type: PREVIEW_MESSAGE_TYPE, kind: 'config', overlay: null }, []]) {
      expect(() => read(hostile)).not.toThrow();
    }
  });
});
