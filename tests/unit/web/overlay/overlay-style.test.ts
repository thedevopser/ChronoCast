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

  describe('dégradé', () => {
    /*
     * Le dégradé ne peut pas être une simple couleur : `color` n'accepte pas
     * d'image. Le texte est donc peint par un fond découpé à la forme des
     * glyphes (`background-clip: text`), ce qui impose de rendre la couleur du
     * texte transparente — sans quoi elle recouvrirait le dégradé.
     *
     * Corollaire à ne jamais perdre de vue : la couleur de remplissage doit
     * redevenir opaque dès que le dégradé est éteint, faute de quoi le compteur
     * disparaît purement et simplement de la scène.
     */
    it('laisse la couleur unie peindre le texte quand il est éteint', () => {
      const variables = overlayCssVariables(BASE);

      expect(variables['--cc-text-background']).toBe('none');
      expect(variables['--cc-text-fill']).toBe('#FFFFFF');
    });

    it('peint le texte par un fond découpé quand il vise le texte', () => {
      const variables = overlayCssVariables({
        ...BASE,
        gradient: { ...BASE.gradient, onText: true },
      });

      expect(variables['--cc-text-background']).toBe('linear-gradient(100deg, #FF3D7F, #FF9A3D)');
      expect(variables['--cc-text-fill']).toBe('transparent');
    });

    it('laisse le texte tranquille quand il ne vise que le cadre', () => {
      // Les deux cibles sont indépendantes : un dégradé sur le cadre ne doit
      // pas rendre les chiffres transparents, sous peine de les faire
      // disparaître si le cadre est éteint.
      const variables = overlayCssVariables({
        ...BASE,
        gradient: { ...BASE.gradient, onFrame: true },
        frame: { ...BASE.frame, enabled: true },
      });

      expect(variables['--cc-text-background']).toBe('none');
      expect(variables['--cc-text-fill']).toBe('#FFFFFF');
    });
  });

  describe('cadre', () => {
    it('est parfaitement neutre quand il est éteint', () => {
      // Rien ne doit changer pour qui ne l'a pas demandé : la scène OBS est
      // déjà cadrée sur ce que le streamer voit aujourd'hui.
      const variables = overlayCssVariables(BASE);

      expect(variables['--cc-frame-width']).toBe('0px');
      expect(variables['--cc-frame-radius']).toBe('0px');
      expect(variables['--cc-frame-padding-x']).toBe('0px');
      expect(variables['--cc-frame-padding-y']).toBe('0px');
      expect(variables['--cc-frame-background']).toBe('transparent');
      expect(variables['--cc-frame-fill']).toBe('transparent');
    });

    it('reporte ses grandeurs et sa couleur quand il est actif', () => {
      const variables = overlayCssVariables({
        ...BASE,
        frame: { ...BASE.frame, enabled: true },
      });

      expect(variables['--cc-frame-width']).toBe('4px');
      expect(variables['--cc-frame-radius']).toBe('18px');
      expect(variables['--cc-frame-padding-x']).toBe('24px');
      expect(variables['--cc-frame-padding-y']).toBe('12px');
      expect(variables['--cc-frame-background']).toBe('#9146FF');
    });

    it('porte le dégradé quand celui-ci le vise', () => {
      const variables = overlayCssVariables({
        ...BASE,
        gradient: { ...BASE.gradient, onFrame: true },
        frame: { ...BASE.frame, enabled: true },
      });

      expect(variables['--cc-frame-background']).toBe('linear-gradient(100deg, #FF3D7F, #FF9A3D)');
    });

    it('garde sa couleur unie quand le dégradé ne vise que le texte', () => {
      const variables = overlayCssVariables({
        ...BASE,
        gradient: { ...BASE.gradient, onText: true },
        frame: { ...BASE.frame, enabled: true },
      });

      expect(variables['--cc-frame-background']).toBe('#9146FF');
    });

    it('partage la même définition que le texte quand les deux sont visés', () => {
      // Une seule paire de couleurs et un seul angle : les dédoubler n'aurait
      // servi qu'à donner l'occasion de les désaccorder.
      const variables = overlayCssVariables({
        ...BASE,
        gradient: { ...BASE.gradient, onText: true, onFrame: true },
        frame: { ...BASE.frame, enabled: true },
      });

      expect(variables['--cc-frame-background']).toBe(variables['--cc-text-background']);
    });

    it('laisse l’intérieur libre par défaut', () => {
      // Un cadre est un trait, pas un pavé : un remplissage opaque par défaut
      // masquerait la scène derrière lui, et c'est le contraire de ce qu'on
      // attend d'un cadre.
      const variables = overlayCssVariables({
        ...BASE,
        frame: { ...BASE.frame, enabled: true },
      });

      expect(variables['--cc-frame-fill']).toBe('#00000000');
    });

    it('creuse le rayon intérieur de l’épaisseur du trait', () => {
      // Sans cela, l'intérieur garde des coins plus ronds que le cadre et
      // laisse apparaître un liseré aux quatre angles.
      const variables = overlayCssVariables({
        ...BASE,
        frame: { ...BASE.frame, enabled: true, radius: 18, width: 4 },
      });

      expect(variables['--cc-frame-inner-radius']).toBe('14px');
    });

    it('ne creuse jamais le rayon intérieur sous zéro', () => {
      const variables = overlayCssVariables({
        ...BASE,
        frame: { ...BASE.frame, enabled: true, radius: 2, width: 10 },
      });

      expect(variables['--cc-frame-inner-radius']).toBe('0px');
    });

    describe('remplissage', () => {
      /*
       * L'opacité est un réglage à part parce que `<input type="color">` ne
       * sait pas exprimer la transparence : il rend toujours six chiffres
       * hexadécimaux. Les deux sont donc recomposés ici.
       */
      it('compose la couleur et l’opacité en une notation à huit chiffres', () => {
        const variables = overlayCssVariables({
          ...BASE,
          frame: { ...BASE.frame, enabled: true, fillColor: '#101820', fillOpacity: 0.4 },
        });

        expect(variables['--cc-frame-fill']).toBe('#10182066');
      });

      it('traite les deux extrêmes sans cas particulier', () => {
        const transparent = overlayCssVariables({
          ...BASE,
          frame: { ...BASE.frame, enabled: true, fillOpacity: 0 },
        });
        const opaque = overlayCssVariables({
          ...BASE,
          frame: { ...BASE.frame, enabled: true, fillOpacity: 1 },
        });

        expect(transparent['--cc-frame-fill']).toBe('#00000000');
        expect(opaque['--cc-frame-fill']).toBe('#000000ff');
      });

      it('développe la notation courte avant d’y ajouter l’opacité', () => {
        // `#RGB` est une notation légale que le schéma accepte ; y coller deux
        // chiffres de plus produirait une couleur silencieusement fausse.
        const variables = overlayCssVariables({
          ...BASE,
          frame: { ...BASE.frame, enabled: true, fillColor: '#1AF', fillOpacity: 1 },
        });

        expect(variables['--cc-frame-fill']).toBe('#11AAFFff');
      });

      it('remplace l’opacité déjà portée par la couleur', () => {
        // Une couleur venue d'une configuration importée peut déjà porter huit
        // chiffres. Le réglage visible dans le panneau doit l'emporter, sans
        // quoi le curseur d'opacité n'aurait aucun effet.
        const variables = overlayCssVariables({
          ...BASE,
          frame: { ...BASE.frame, enabled: true, fillColor: '#101820FF', fillOpacity: 0.4 },
        });

        expect(variables['--cc-frame-fill']).toBe('#10182066');
      });
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
