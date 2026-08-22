import { describe, expect, it } from 'vitest';

import { configSchema } from '../../../../src/core/config/schema.js';
import { goalCssVariables } from '../../../../src/web/goal/goal-style.js';
import type { GoalOverlayConfig } from '../../../../src/web/shared/protocol.js';

function appearance(patch: Record<string, unknown> = {}): GoalOverlayConfig {
  return configSchema.parse({ goals: { overlay: patch } }).goals.overlay;
}

function variables(patch: Record<string, unknown> = {}): Record<string, string> {
  return goalCssVariables(appearance(patch));
}

describe('goalCssVariables', () => {
  it('n’émet que des variables préfixées, qui ne peuvent heurter celles de l’overlay', () => {
    for (const name of Object.keys(variables())) {
      expect(name.startsWith('--cc-goal-')).toBe(true);
    }
  });

  describe('texte', () => {
    it('reporte la police, la taille et la graisse', () => {
      const css = variables({ fontFamily: 'Georgia', fontSize: 40, fontWeight: 500 });

      expect(css['--cc-goal-font-family']).toBe('Georgia');
      expect(css['--cc-goal-font-size']).toBe('40px');
      expect(css['--cc-goal-font-weight']).toBe('500');
    });

    it('suffixe l’interlettrage, y compris négatif', () => {
      expect(variables({ letterSpacing: -2 })['--cc-goal-letter-spacing']).toBe('-2px');
    });

    it('reporte l’alignement dans la barre', () => {
      expect(variables({ textAlign: 'left' })['--cc-goal-text-align']).toBe('left');
    });
  });

  describe('barre', () => {
    it('reporte hauteur, arrondi et trait', () => {
      const css = variables({ bar: { height: 60, radius: 8, borderWidth: 3 } });

      expect(css['--cc-goal-bar-height']).toBe('60px');
      expect(css['--cc-goal-bar-radius']).toBe('8px');
      expect(css['--cc-goal-bar-border-width']).toBe('3px');
    });

    it('applique l’opacité au fond de la barre plutôt qu’à la barre entière', () => {
      expect(variables({ bar: { trackColor: '#112233', trackOpacity: 0.5 } })['--cc-goal-bar-track'])
        .toBe('#11223380');
    });

    it('déplie une couleur hexadécimale courte avant d’y joindre l’alpha', () => {
      expect(variables({ bar: { trackColor: '#abc', trackOpacity: 1 } })['--cc-goal-bar-track']).toBe(
        '#aabbccff',
      );
    });

    it('remplit la barre de sa couleur tant que le dégradé ne la recouvre pas', () => {
      expect(variables({ bar: { fillColor: '#00FF00' } })['--cc-goal-bar-fill']).toBe('#00FF00');
    });

    it('remplit la barre du dégradé quand il porte sur elle', () => {
      const css = variables({
        gradient: { onBar: true, from: '#FF0000', to: '#0000FF', angleDeg: 90 },
      });

      expect(css['--cc-goal-bar-fill']).toBe('linear-gradient(90deg, #FF0000, #0000FF)');
    });
  });

  describe('effets du texte', () => {
    it('empile l’ombre portée et le halo dans une seule déclaration', () => {
      const css = variables({
        shadow: { enabled: true, color: '#000000', blur: 4, offsetX: 1, offsetY: 2 },
        glow: { enabled: true, color: '#9146FF', radius: 10 },
      });

      expect(css['--cc-goal-text-shadow']).toBe('1px 2px 4px #000000, 0 0 10px #9146FF');
    });

    it('rend « none » quand les deux effets sont éteints', () => {
      const css = variables({ shadow: { enabled: false }, glow: { enabled: false } });

      expect(css['--cc-goal-text-shadow']).toBe('none');
    });

    it('annule l’épaisseur du contour quand il est éteint', () => {
      expect(variables({ outline: { enabled: false, width: 6 } })['--cc-goal-outline-width']).toBe(
        '0px',
      );
    });
  });

  describe('dégradé sur le texte', () => {
    it('laisse la couleur pleine tant que le dégradé ne porte pas sur le texte', () => {
      const css = variables({ color: '#FFCC00' });

      expect(css['--cc-goal-text-fill']).toBe('#FFCC00');
      expect(css['--cc-goal-text-background']).toBe('none');
    });

    it('rend le texte transparent pour laisser paraître le dégradé', () => {
      const css = variables({ gradient: { onText: true, from: '#FF0000', to: '#0000FF' } });

      expect(css['--cc-goal-text-fill']).toBe('transparent');
      expect(css['--cc-goal-text-background']).toContain('linear-gradient(');
    });
  });

  describe('annonce', () => {
    it('reporte la couleur et la durée', () => {
      const css = variables({ announce: { color: '#FFFFFF', durationMs: 8_000 } });

      expect(css['--cc-goal-announce-color']).toBe('#FFFFFF');
      expect(css['--cc-goal-announce-duration']).toBe('8000ms');
    });
  });
});
