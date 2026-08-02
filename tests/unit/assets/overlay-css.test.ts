import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Invariants de la feuille de l'overlay.
 *
 * Rien de ce qui suit ne se vérifie en exécutant l'application : il n'y a pas
 * de moteur de rendu dans le conteneur, et ces défauts **ne lèvent jamais**.
 * Ils se voient à l'œil, sur un poste, une fois l'installeur produit — et ils
 * se sont vus trois fois de suite sur le seul cadre du compteur.
 *
 * Ce fichier ne remplace pas un rendu. Il fige les deux ou trois décisions dont
 * la valeur exacte est contre-intuitive et dont l'erreur est silencieuse.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const overlayCss = (): Promise<string> =>
  readFile(resolve(ROOT, 'src/web/overlay/overlay.css'), 'utf8');

describe('feuille de l’overlay', () => {
  describe('cadre', () => {
    it('soustrait la boîte de contenu, et non la boîte de remplissage', async () => {
      /*
       * C'est l'erreur qui a rendu le cadre invisible, et elle est facile à
       * refaire : le nom `padding-box` **ne désigne pas** la boîte diminuée de
       * la marge intérieure. Il désigne la boîte diminuée des **bordures**.
       *
       * Le trait du cadre étant exprimé par un `padding` et non par une
       * bordure, les deux couches de masque avaient alors exactement la même
       * taille et ne différaient que par leurs rayons de coin : leur
       * soustraction ne laissait que les arcs des quatre angles.
       *
       * `content-box` est la boîte diminuée des bordures **et** de la marge
       * intérieure — la seule qui décrive l'intérieur du cadre.
       */
      const css = await overlayCss();
      const masks = [...css.matchAll(/^\s*-?(?:webkit-)?mask:.*$/gm)].map((match) => match[0]);

      expect(masks.length).toBeGreaterThan(0);
      for (const declaration of masks) {
        expect(declaration).toContain('content-box');
        expect(declaration).not.toContain('padding-box');
      }
    });

    it('garde la forme préfixée à côté de la forme standard', async () => {
      // Une Browser Source OBS n'est pas toujours à jour, et `mask-composite`
      // n'est arrivé que tardivement dans Chromium. Sans la forme préfixée, le
      // masque ne s'applique pas du tout sur les versions plus anciennes : le
      // cadre redevient un pavé plein, ce qu'aucun test ne verrait.
      const css = await overlayCss();

      expect(css).toContain('-webkit-mask-composite: xor');
      expect(css).toContain('mask-composite: exclude');
    });

    it('pose le masque sur le pseudo-élément, jamais sur l’enveloppe', async () => {
      // Un masque s'applique aussi aux descendants : posé sur `.frame`, il
      // effacerait les chiffres en même temps que l'intérieur du cadre.
      const css = await overlayCss();
      const frameRule = /\.frame\s*\{[^}]*\}/.exec(css)?.[0] ?? '';

      expect(frameRule).not.toContain('mask');
      expect(css).toContain('.frame::before');
    });
  });
});
