import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const overlayCss = (): Promise<string> =>
  readFile(resolve(ROOT, 'src/web/overlay/overlay.css'), 'utf8');

describe('feuille de l’overlay', () => {
  describe('cadre', () => {
    it('soustrait la boîte de contenu, et non la boîte de remplissage', async () => {
      const css = await overlayCss();
      const masks = [...css.matchAll(/^\s*-?(?:webkit-)?mask:.*$/gm)].map((match) => match[0]);

      expect(masks.length).toBeGreaterThan(0);
      for (const declaration of masks) {
        expect(declaration).toContain('content-box');
        expect(declaration).not.toContain('padding-box');
      }
    });

    it('garde la forme préfixée à côté de la forme standard', async () => {
      const css = await overlayCss();

      expect(css).toContain('-webkit-mask-composite: xor');
      expect(css).toContain('mask-composite: exclude');
    });

    it('pose le masque sur le pseudo-élément, jamais sur l’enveloppe', async () => {
      const css = await overlayCss();
      const frameRule = /\.frame\s*\{[^}]*\}/.exec(css)?.[0] ?? '';

      expect(frameRule).not.toContain('mask');
      expect(css).toContain('.frame::before');
    });
  });
});
