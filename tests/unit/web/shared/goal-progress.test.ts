import { describe, expect, it } from 'vitest';

import { goalProgressRatio } from '../../../../src/web/shared/goal-progress.js';

describe('goalProgressRatio', () => {
  it('rend la part parcourue du palier courant', () => {
    expect(goalProgressRatio({ subs: 7, from: 5, to: 10 })).toBeCloseTo(0.4);
  });

  it('rend zéro au tout début d’un palier', () => {
    expect(goalProgressRatio({ subs: 5, from: 5, to: 10 })).toBe(0);
  });

  it('rend un quand le palier est atteint', () => {
    expect(goalProgressRatio({ subs: 10, from: 5, to: 10 })).toBe(1);
  });

  it('reste plein au-delà du dernier palier', () => {
    expect(goalProgressRatio({ subs: 500, from: 100, to: 200 })).toBe(1);
  });

  it('rend zéro sur un palier de largeur nulle plutôt que de diviser par zéro', () => {
    expect(goalProgressRatio({ subs: 0, from: 0, to: 0 })).toBe(0);
  });
});
