/**
 * Traduction de la configuration d'apparence en variables CSS.
 *
 * Le risque couvert est un contournement de la CSP. `style-src 'self'` interdit
 * la balise `<style>` comme l'attribut `style=` écrit dans le HTML : il est
 * donc impossible de composer une feuille de style à partir de la
 * configuration. La seule voie restante est le CSSOM, qui n'est pas couvert par
 * la directive — d'où un jeu de variables CSS, calculé ici et posé par
 * `safe-dom.setCssVariables`.
 *
 * Cette fonction est pure : elle prend une configuration et rend un
 * dictionnaire. Tout le comportement observable de l'apparence se vérifie donc
 * sans navigateur, sans feuille de style et sans rendu.
 *
 * Le point délicat est la composition de `text-shadow` : l'ombre portée et la
 * lueur sont deux réglages indépendants qui alimentent la **même** propriété
 * CSS. Activer l'un ne doit pas effacer l'autre.
 */

import { describe, expect, it } from 'vitest';

import type { OverlayConfig } from '../../../../src/web/shared/protocol.js';
import { overlayCssVariables } from '../../../../src/web/overlay/overlay-style.js';

/** Configuration par défaut du schéma, reproduite pour partir d'un socle connu. */
const BASE: OverlayConfig = {
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
  enableCustomCss: false,
};

describe('overlayCssVariables', () => {
  describe('typographie', () => {
    it('reporte la police, la graisse et la couleur', () => {
      const variables = overlayCssVariables(BASE);

      expect(variables['--cc-font-family']).toBe('Inter, Segoe UI, system-ui, sans-serif');
      expect(variables['--cc-font-weight']).toBe('700');
      expect(variables['--cc-color']).toBe('#FFFFFF');
      expect(variables['--cc-text-align']).toBe('center');
    });

    it('ajoute l’unité aux grandeurs, que le schéma stocke sans unité', () => {
      const variables = overlayCssVariables({ ...BASE, fontSize: 120, letterSpacing: 1.5 });

      expect(variables['--cc-font-size']).toBe('120px');
      expect(variables['--cc-letter-spacing']).toBe('1.5px');
    });
  });

  describe('ombre et lueur', () => {
    it('compose l’ombre portée à partir de ses quatre réglages', () => {
      const variables = overlayCssVariables({
        ...BASE,
        shadow: { enabled: true, color: '#000000CC', blur: 12, offsetX: 2, offsetY: 4 },
      });

      expect(variables['--cc-text-shadow']).toBe('2px 4px 12px #000000CC');
    });

    it('rend « none » quand ni l’ombre ni la lueur ne sont actives', () => {
      const variables = overlayCssVariables({
        ...BASE,
        shadow: { ...BASE.shadow, enabled: false },
      });

      expect(variables['--cc-text-shadow']).toBe('none');
    });

    it('compose la lueur seule, centrée et sans décalage', () => {
      const variables = overlayCssVariables({
        ...BASE,
        shadow: { ...BASE.shadow, enabled: false },
        glow: { enabled: true, color: '#9146FF', radius: 20 },
      });

      expect(variables['--cc-text-shadow']).toBe('0 0 20px #9146FF');
    });

    it('cumule l’ombre et la lueur sur la même propriété', () => {
      // Les deux réglages alimentent `text-shadow`. Activer l'un ne doit pas
      // effacer l'autre : c'est exactement ce qu'une écriture naïve ferait.
      const variables = overlayCssVariables({
        ...BASE,
        shadow: { enabled: true, color: '#000000CC', blur: 12, offsetX: 0, offsetY: 4 },
        glow: { enabled: true, color: '#9146FF', radius: 20 },
      });

      expect(variables['--cc-text-shadow']).toBe('0px 4px 12px #000000CC, 0 0 20px #9146FF');
    });
  });

  describe('contour', () => {
    it('reporte la largeur et la couleur quand il est actif', () => {
      const variables = overlayCssVariables({
        ...BASE,
        outline: { enabled: true, color: '#101010', width: 3 },
      });

      expect(variables['--cc-outline-width']).toBe('3px');
      expect(variables['--cc-outline-color']).toBe('#101010');
    });

    it('annule la largeur quand il est inactif', () => {
      // Neutraliser par la largeur plutôt que par la couleur : une largeur nulle
      // désactive `-webkit-text-stroke` sans dépendre du fond, qui est
      // transparent dans une Browser Source.
      const variables = overlayCssVariables({
        ...BASE,
        outline: { enabled: false, color: '#101010', width: 3 },
      });

      expect(variables['--cc-outline-width']).toBe('0px');
    });
  });

  describe('animation et bulles', () => {
    it('reporte la durée d’animation en millisecondes', () => {
      const variables = overlayCssVariables({
        ...BASE,
        animation: { onAdd: 'flash', durationMs: 900 },
      });

      expect(variables['--cc-animation-duration']).toBe('900ms');
    });

    it('reporte l’apparence des bulles', () => {
      const variables = overlayCssVariables({
        ...BASE,
        toast: { enabled: true, durationMs: 3_000, color: '#00FF00', fontSize: 32 },
      });

      expect(variables['--cc-toast-color']).toBe('#00FF00');
      expect(variables['--cc-toast-font-size']).toBe('32px');
      expect(variables['--cc-toast-duration']).toBe('3000ms');
    });
  });

  describe('contrat avec safe-dom', () => {
    it('ne produit que des noms de variables CSS', () => {
      // `setCssVariables` refuse tout nom qui n'est pas préfixé : cette
      // vérification évite de découvrir la faute de frappe à l'écran.
      const names = Object.keys(overlayCssVariables(BASE));

      expect(names.length).toBeGreaterThan(0);
      expect(names.every((name) => name.startsWith('--cc-'))).toBe(true);
    });

    it('ne produit que des valeurs textuelles', () => {
      const values = Object.values(overlayCssVariables(BASE));

      expect(values.every((value) => typeof value === 'string')).toBe(true);
    });
  });
});
