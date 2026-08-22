import { describe, expect, it } from 'vitest';

import type { GoalTier } from '../../../src/core/config/schema.js';
import { normalizeLadder, positionAt, tiersCrossed } from '../../../src/core/goals/goal-ladder.js';

const LADDER: readonly GoalTier[] = [
  { target: 50, label: 'Je me rase la tête' },
  { target: 100, label: 'Karaoké' },
  { target: 200, label: 'Marathon 24 h' },
];

describe('normalizeLadder', () => {
  it('trie une échelle saisie en désordre', () => {
    const messy: readonly GoalTier[] = [
      { target: 200, label: 'Marathon 24 h' },
      { target: 50, label: 'Je me rase la tête' },
      { target: 100, label: 'Karaoké' },
    ];

    expect(normalizeLadder(messy)).toEqual(LADDER);
  });

  it('écarte un seuil en double en gardant le premier', () => {
    const duplicated: readonly GoalTier[] = [
      { target: 50, label: 'Premier' },
      { target: 50, label: 'Second' },
      { target: 100, label: 'Karaoké' },
    ];

    expect(normalizeLadder(duplicated)).toEqual([
      { target: 50, label: 'Premier' },
      { target: 100, label: 'Karaoké' },
    ]);
  });

  it('rend une échelle vide inchangée', () => {
    expect(normalizeLadder([])).toEqual([]);
  });

  it('ne modifie pas le tableau qu’on lui donne', () => {
    const source: GoalTier[] = [
      { target: 200, label: 'Marathon 24 h' },
      { target: 50, label: 'Je me rase la tête' },
    ];

    normalizeLadder(source);

    expect(source[0]?.target).toBe(200);
  });
});

describe('positionAt', () => {
  it('vise le premier palier quand rien n’est encore compté', () => {
    expect(positionAt(0, LADDER)).toEqual({
      index: 0,
      total: 3,
      from: 0,
      to: 50,
      label: 'Je me rase la tête',
      complete: false,
    });
  });

  it('dérive la borne basse du palier précédent', () => {
    expect(positionAt(120, LADDER)).toEqual({
      index: 2,
      total: 3,
      from: 100,
      to: 200,
      label: 'Marathon 24 h',
      complete: false,
    });
  });

  it('passe au palier suivant dès que le seuil est atteint', () => {
    expect(positionAt(50, LADDER).label).toBe('Karaoké');
    expect(positionAt(49, LADDER).label).toBe('Je me rase la tête');
  });

  it('reste plein sur le libellé final au-delà du dernier palier', () => {
    expect(positionAt(500, LADDER)).toEqual({
      index: 2,
      total: 3,
      from: 100,
      to: 200,
      label: 'Marathon 24 h',
      complete: true,
    });
  });

  it('marque le dernier palier comme franchi dès son seuil exact', () => {
    expect(positionAt(200, LADDER).complete).toBe(true);
  });

  it('rend une position vide sur une échelle sans palier', () => {
    expect(positionAt(42, [])).toEqual({
      index: -1,
      total: 0,
      from: 0,
      to: 0,
      label: '',
      complete: false,
    });
  });

  it('normalise l’échelle elle-même', () => {
    const messy: readonly GoalTier[] = [
      { target: 100, label: 'Karaoké' },
      { target: 50, label: 'Je me rase la tête' },
    ];

    expect(positionAt(0, messy).label).toBe('Je me rase la tête');
  });
});

describe('tiersCrossed', () => {
  it('rend le palier franchi par un abonnement', () => {
    expect(tiersCrossed(49, 50, LADDER)).toEqual([{ target: 50, label: 'Je me rase la tête' }]);
  });

  it('rend tous les paliers qu’un don groupé traverse, jamais le dernier seul', () => {
    expect(tiersCrossed(0, 250, LADDER)).toEqual(LADDER);
  });

  it('ne rend rien quand aucun seuil n’est atteint', () => {
    expect(tiersCrossed(10, 20, LADDER)).toEqual([]);
  });

  it('ne rejoue pas un palier déjà franchi', () => {
    expect(tiersCrossed(50, 60, LADDER)).toEqual([]);
  });

  it('ne rend rien quand le compte recule', () => {
    expect(tiersCrossed(120, 0, LADDER)).toEqual([]);
  });

  it('ne rend rien sur une échelle sans palier', () => {
    expect(tiersCrossed(0, 1_000, [])).toEqual([]);
  });

  it('rend les paliers dans l’ordre croissant, même sur une échelle en désordre', () => {
    const messy: readonly GoalTier[] = [
      { target: 100, label: 'Karaoké' },
      { target: 50, label: 'Je me rase la tête' },
    ];

    expect(tiersCrossed(0, 150, messy)).toEqual([
      { target: 50, label: 'Je me rase la tête' },
      { target: 100, label: 'Karaoké' },
    ]);
  });
});
