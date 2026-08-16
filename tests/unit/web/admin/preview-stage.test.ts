import { describe, expect, it } from 'vitest';

import { PREVIEW_CANVAS, previewScale } from '../../../../src/web/admin/preview-stage.js';

describe('PREVIEW_CANVAS', () => {
  it('représente une toile OBS en 16:9', () => {
    expect(PREVIEW_CANVAS.width / PREVIEW_CANVAS.height).toBeCloseTo(16 / 9, 5);
  });

  it('est la toile la plus répandue, en 1080p', () => {
    expect(PREVIEW_CANVAS).toStrictEqual({ width: 1_920, height: 1_080 });
  });
});

describe('previewScale', () => {
  it('ramène la toile à la largeur disponible', () => {
    expect(previewScale(1_920)).toBe(1);
    expect(previewScale(960)).toBe(0.5);
    expect(previewScale(384)).toBe(0.2);
  });

  it('ne grossit jamais la toile au-delà de sa taille réelle', () => {
    expect(previewScale(3_840)).toBe(1);
  });

  it('garde une échelle exploitable quand la place manque', () => {
    expect(previewScale(1)).toBeGreaterThan(0);
    expect(previewScale(0)).toBeGreaterThan(0);
  });

  it('se rabat sur une valeur sûre pour une largeur absurde', () => {
    for (const hostile of [Number.NaN, Number.POSITIVE_INFINITY, -100]) {
      const scale = previewScale(hostile);

      expect(Number.isFinite(scale), String(hostile)).toBe(true);
      expect(scale, String(hostile)).toBeGreaterThan(0);
      expect(scale, String(hostile)).toBeLessThanOrEqual(1);
    }
  });

  it('croît avec la place offerte', () => {
    expect(previewScale(800)).toBeGreaterThan(previewScale(400));
  });
});
