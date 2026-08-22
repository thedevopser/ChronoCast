import { describe, expect, it } from 'vitest';

import { GOAL_LABEL_MAX_LENGTH as CORE_LABEL_MAX_LENGTH } from '../../../../src/core/config/schema.js';
import {
  GOAL_LABEL_MAX_LENGTH,
  normalizeGoalTiers,
  type GoalTierInput,
} from '../../../../src/web/admin/goal-tiers.js';

function rows(...pairs: [string, string][]): GoalTierInput[] {
  return pairs.map(([target, label]) => ({ target, label }));
}

describe('GOAL_LABEL_MAX_LENGTH', () => {
  it('vaut ce que le schéma du noyau accepte : src/web ne peut rien lui importer', () => {
    expect(GOAL_LABEL_MAX_LENGTH).toBe(CORE_LABEL_MAX_LENGTH);
  });
});

describe('normalizeGoalTiers', () => {
  it('convertit des lignes valides', () => {
    const { tiers, errors } = normalizeGoalTiers(
      rows(['50', 'Je me rase la tête'], ['100', 'Karaoké']),
    );

    expect(errors).toEqual([]);
    expect(tiers).toEqual([
      { target: 50, label: 'Je me rase la tête' },
      { target: 100, label: 'Karaoké' },
    ]);
  });

  it('trie par seuil croissant', () => {
    const { tiers } = normalizeGoalTiers(
      rows(['200', 'Marathon'], ['50', 'Rasage'], ['100', 'Karaoké']),
    );

    expect(tiers.map((tier) => tier.target)).toEqual([50, 100, 200]);
  });

  it('ignore les lignes entièrement vides', () => {
    const { tiers, errors } = normalizeGoalTiers(rows(['50', 'Rasage'], ['', '']));

    expect(errors).toEqual([]);
    expect(tiers).toHaveLength(1);
  });

  it('accepte une échelle vide : c’est l’état éteint, pas une erreur', () => {
    const { tiers, errors } = normalizeGoalTiers([]);

    expect(errors).toEqual([]);
    expect(tiers).toEqual([]);
  });

  it('accepte une échelle entièrement effacée', () => {
    const { tiers, errors } = normalizeGoalTiers(rows(['', ''], ['', '']));

    expect(errors).toEqual([]);
    expect(tiers).toEqual([]);
  });

  it('rogne les espaces autour du libellé', () => {
    const { tiers } = normalizeGoalTiers(rows(['50', '  Rasage  ']));

    expect(tiers[0]?.label).toBe('Rasage');
  });

  describe('refus', () => {
    it('refuse un seuil qui n’est pas un entier', () => {
      const { tiers, errors } = normalizeGoalTiers(rows(['12.5', 'Rasage']));

      expect(tiers).toEqual([]);
      expect(errors[0]).toContain('Palier 1');
    });

    it('refuse un seuil nul', () => {
      expect(normalizeGoalTiers(rows(['0', 'Rasage'])).errors).toHaveLength(1);
    });

    it('refuse un seuil négatif', () => {
      expect(normalizeGoalTiers(rows(['-5', 'Rasage'])).errors).toHaveLength(1);
    });

    it('refuse un palier sans libellé : sans promesse, il n’y a pas d’objectif', () => {
      const { errors } = normalizeGoalTiers(rows(['50', '   ']));

      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('Palier 1');
    });

    it('refuse un libellé trop long pour tenir sur une ligne', () => {
      const { errors } = normalizeGoalTiers(rows(['50', 'x'.repeat(GOAL_LABEL_MAX_LENGTH + 1)]));

      expect(errors).toHaveLength(1);
    });

    it('accepte un libellé de la longueur maximale', () => {
      const { errors } = normalizeGoalTiers(rows(['50', 'x'.repeat(GOAL_LABEL_MAX_LENGTH)]));

      expect(errors).toEqual([]);
    });

    it('refuse deux paliers de même seuil, qui rendraient la promesse imprévisible', () => {
      const { tiers, errors } = normalizeGoalTiers(rows(['50', 'Premier'], ['50', 'Second']));

      expect(tiers).toEqual([]);
      expect(errors[0]).toContain('Palier 2');
    });

    it('ne rend aucun palier dès qu’une ligne est refusée', () => {
      const { tiers } = normalizeGoalTiers(rows(['50', 'Rasage'], ['0', 'Fautif']));

      expect(tiers).toEqual([]);
    });

    it('nomme la ligne fautive par sa position réelle', () => {
      const { errors } = normalizeGoalTiers(
        rows(['50', 'Rasage'], ['100', 'Karaoké'], ['abc', 'Fautif']),
      );

      expect(errors[0]).toContain('Palier 3');
    });
  });
});
