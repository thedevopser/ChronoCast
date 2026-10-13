import { describe, expect, it } from 'vitest';

import { normalizeTiers, tiersChange, type TierInput } from '../../../../src/web/admin/bits-tiers.js';

function rows(...pairs: [string, string][]): TierInput[] {
  return pairs.map(([minBits, seconds]) => ({ minBits, seconds }));
}

describe('normalizeTiers', () => {
  it('convertit des lignes valides', () => {
    const { tiers, errors } = normalizeTiers(rows(['100', '60'], ['500', '360']));

    expect(errors).toEqual([]);
    expect(tiers).toEqual([
      { minBits: 100, seconds: 60 },
      { minBits: 500, seconds: 360 },
    ]);
  });

  it('trie par seuil croissant', () => {
    const { tiers } = normalizeTiers(rows(['1000', '900'], ['100', '60'], ['500', '360']));

    expect(tiers.map((tier) => tier.minBits)).toEqual([100, 500, 1_000]);
  });

  it('accepte une récompense nulle', () => {
    const { tiers, errors } = normalizeTiers(rows(['100', '0']));

    expect(errors).toEqual([]);
    expect(tiers).toEqual([{ minBits: 100, seconds: 0 }]);
  });

  it('ignore les lignes entièrement vides', () => {
    const { tiers, errors } = normalizeTiers(rows(['100', '60'], ['', '']));

    expect(errors).toEqual([]);
    expect(tiers).toHaveLength(1);
  });

  it('refuse une liste vide', () => {
    const { tiers, errors } = normalizeTiers([]);

    expect(tiers).toEqual([]);
    expect(errors).toHaveLength(1);
  });

  it('refuse une liste réduite à des lignes vides', () => {
    expect(normalizeTiers(rows(['', ''])).errors).toHaveLength(1);
  });

  it.each([
    ['0', '60', 'un seuil nul'],
    ['-100', '60', 'un seuil négatif'],
    ['100.5', '60', 'un seuil décimal'],
    ['cent', '60', 'un seuil non numérique'],
    ['100', '-1', 'une récompense négative'],
    ['100', '1.5', 'une récompense décimale'],
    ['100', 'soixante', 'une récompense non numérique'],
    ['100', '', 'une récompense manquante'],
    ['', '60', 'un seuil manquant'],
  ])('refuse %o / %o : %s', (minBits, seconds) => {
    const { tiers, errors } = normalizeTiers(rows([minBits, seconds]));

    expect(errors).toHaveLength(1);
    expect(errors[0]).not.toBe('');
    expect(tiers).toEqual([]);
  });

  it('refuse deux paliers de même seuil', () => {
    const { errors } = normalizeTiers(rows(['100', '60'], ['100', '120']));

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('100');
  });

  it('rapporte chaque ligne fautive', () => {
    const { errors } = normalizeTiers(rows(['cent', '60'], ['200', 'x']));

    expect(errors).toHaveLength(2);
  });

  it('nomme la ligne en cause', () => {
    const { errors } = normalizeTiers(rows(['100', '60'], ['500', '360'], ['x', '900']));

    expect(errors[0]).toContain('3');
  });

  it('ne modifie pas les lignes reçues', () => {
    const input = rows(['500', '360'], ['100', '60']);
    const snapshot = JSON.stringify(input);

    normalizeTiers(input);

    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe('tiersChange', () => {
  const CURRENT = [
    { minBits: 100, seconds: 60 },
    { minBits: 500, seconds: 360 },
  ];

  it('rend les paliers à écrire quand ils diffèrent de la configuration', () => {
    const change = tiersChange(rows(['500', '400'], ['100', '60']), 'tiers', CURRENT);

    expect(change.errors).toStrictEqual([]);
    expect(change.tiers).toStrictEqual([
      { minBits: 100, seconds: 60 },
      { minBits: 500, seconds: 400 },
    ]);
  });

  it('n’écrit rien quand les paliers saisis sont ceux de la configuration', () => {
    expect(tiersChange(rows(['100', '60'], ['500', '360']), 'tiers', CURRENT)).toStrictEqual({
      tiers: null,
      errors: [],
    });
  });

  it('refuse le mode par paliers sans palier : le schéma rejetterait toute la configuration', () => {
    const change = tiersChange([], 'tiers', CURRENT);

    expect(change.tiers).toBeNull();
    expect(change.errors).toHaveLength(1);
  });

  it('laisse en paix une liste vide hors du mode par paliers', () => {
    expect(tiersChange(rows(['', '']), 'linear', CURRENT)).toStrictEqual({ tiers: null, errors: [] });
  });

  it('valide une liste remplie même hors du mode par paliers', () => {
    expect(tiersChange(rows(['abc', '60']), 'linear', CURRENT).errors).toHaveLength(1);
    expect(tiersChange(rows(['200', '5']), 'linear', CURRENT).tiers).toStrictEqual([
      { minBits: 200, seconds: 5 },
    ]);
  });
});
