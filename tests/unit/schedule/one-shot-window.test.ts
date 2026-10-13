import { describe, expect, it } from 'vitest';

import {
  InvalidWindowError,
  assertSchedulable,
  stepWindow,
  type WindowState,
} from '../../../src/core/schedule/one-shot-window.js';

const START = 1_800_000_000_000;
const END = START + 3_600_000;

const PENDING: WindowState = { window: { startAt: START, endAt: END }, started: false };
const STARTED: WindowState = { ...PENDING, started: true };

describe('stepWindow', () => {
  it('ne doit rien avant le début', () => {
    expect(stepWindow(PENDING, START - 1)).toStrictEqual({ transitions: [], next: PENDING });
  });

  it('doit le début à l’instant exact du début, et le retient', () => {
    expect(stepWindow(PENDING, START)).toStrictEqual({ transitions: ['start'], next: STARTED });
  });

  it('doit le début à une application relancée au milieu de la plage', () => {
    expect(stepWindow(PENDING, START + 60_000).transitions).toStrictEqual(['start']);
  });

  it('ne redoit pas un début déjà consommé', () => {
    expect(stepWindow(STARTED, START + 60_000)).toStrictEqual({ transitions: [], next: STARTED });
  });

  it('doit la fin à l’instant exact de la fin, et efface la plage', () => {
    expect(stepWindow(STARTED, END)).toStrictEqual({ transitions: ['end'], next: null });
  });

  it('doit la fin à une application relancée après elle, le début ayant été consommé', () => {
    expect(stepWindow(STARTED, END + 86_400_000)).toStrictEqual({ transitions: ['end'], next: null });
  });

  it('efface sans rien devoir une plage entièrement manquée', () => {
    expect(stepWindow(PENDING, END + 1)).toStrictEqual({ transitions: [], next: null });
  });

  it('ne modifie pas l’état reçu', () => {
    const state: WindowState = { window: { startAt: START, endAt: END }, started: false };

    stepWindow(state, START);

    expect(state).toStrictEqual(PENDING);
  });
});

describe('assertSchedulable', () => {
  it('accepte une plage à venir', () => {
    expect(() => {
      assertSchedulable({ startAt: START, endAt: END }, START - 1);
    }).not.toThrow();
  });

  it('accepte une plage déjà commencée dont la fin est à venir', () => {
    expect(() => {
      assertSchedulable({ startAt: START, endAt: END }, START + 1);
    }).not.toThrow();
  });

  it.each([
    ['égale au début', START],
    ['antérieure au début', START - 1],
  ])('refuse une fin %s', (_case, endAt) => {
    expect(() => {
      assertSchedulable({ startAt: START, endAt }, START - 10);
    }).toThrow(InvalidWindowError);
  });

  it.each([
    ['passée', END + 1],
    ['atteinte à l’instant', END],
  ])('refuse une fin %s', (_case, now) => {
    expect(() => {
      assertSchedulable({ startAt: START, endAt: END }, now);
    }).toThrow(InvalidWindowError);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 1.5, -1])(
    'refuse un horodatage de %d',
    (startAt) => {
      expect(() => {
        assertSchedulable({ startAt, endAt: END }, START - 10);
      }).toThrow(InvalidWindowError);
    },
  );
});
