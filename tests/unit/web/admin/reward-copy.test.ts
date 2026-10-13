import { describe, expect, it } from 'vitest';

import { fieldsOf } from '../../../../src/web/admin/fields.js';
import type { RawValue } from '../../../../src/web/admin/form-binding.js';
import { copyReward } from '../../../../src/web/admin/reward-copy.js';

const FIELDS = fieldsOf('rewards');

const SUB = 'rewards.sub.';
const RESUB = 'rewards.resub.';
const GIFT = 'rewards.gift.';

const DRAFT: Readonly<Record<string, RawValue>> = {
  '#reward-sub-prime': '100',
  '#reward-sub-tier1': '200',
  '#reward-sub-tier2': '300',
  '#reward-sub-tier3': '400',
  '#reward-resub-prime': '11',
  '#reward-resub-tier1': '12',
  '#reward-resub-tier2': '13',
  '#reward-resub-tier3': '14',
  '#reward-gift-tier1': '21',
  '#reward-gift-tier2': '22',
  '#reward-gift-tier3': '23',
};

function copied(source: string, targets: readonly string[], draft = DRAFT): Record<string, RawValue> {
  const outcome = copyReward(FIELDS, draft, source, targets);
  if (!outcome.ok) {
    throw new Error('copie refusée');
  }
  return outcome.values;
}

describe('copyReward', () => {
  it('recopie un barème tier par tier dans les deux autres', () => {
    expect(copied(SUB, [RESUB, GIFT])).toStrictEqual({
      '#reward-resub-prime': '100',
      '#reward-resub-tier1': '200',
      '#reward-resub-tier2': '300',
      '#reward-resub-tier3': '400',
      '#reward-gift-tier1': '200',
      '#reward-gift-tier2': '300',
      '#reward-gift-tier3': '400',
    });
  });

  it('recopie le Prime entre abonnements et réabonnements', () => {
    expect(copied(RESUB, [SUB, GIFT])['#reward-sub-prime']).toBe('11');
  });

  it('laisse le Prime des deux autres intact depuis les sub offerts, qui n’en ont pas', () => {
    expect(copied(GIFT, [SUB, RESUB])).toStrictEqual({
      '#reward-sub-tier1': '21',
      '#reward-sub-tier2': '22',
      '#reward-sub-tier3': '23',
      '#reward-resub-tier1': '21',
      '#reward-resub-tier2': '22',
      '#reward-resub-tier3': '23',
    });
  });

  it('ne touche à aucun champ hors des barèmes visés', () => {
    const values = copied(SUB, [RESUB], { ...DRAFT, '#reward-bits-seconds': '5' });

    expect(Object.keys(values).every((selector) => selector.startsWith('#reward-resub-'))).toBe(true);
  });

  it('pose la valeur débarrassée de ses espaces', () => {
    expect(copied(SUB, [GIFT], { ...DRAFT, '#reward-sub-tier1': ' 250 ' })['#reward-gift-tier1']).toBe(
      '250',
    );
  });

  it.each(['', 'abc', '-5', '1.5', '86401'])(
    'refuse la copie quand la source porte la valeur invalide « %s »',
    (value) => {
      const outcome = copyReward(FIELDS, { ...DRAFT, '#reward-sub-tier2': value }, SUB, [RESUB, GIFT]);

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.errors.map((error) => error.selector)).toStrictEqual(['#reward-sub-tier2']);
        expect(outcome.errors[0]?.path).toBe('rewards.sub.tier2');
      }
    },
  );

  it('ignore une valeur invalide dans une carte cible : elle va être remplacée', () => {
    const values = copied(SUB, [RESUB], { ...DRAFT, '#reward-resub-tier1': 'abc' });

    expect(values['#reward-resub-tier1']).toBe('200');
  });

  it('recopie de même entre les cartes du barème Happy Hour, sans toucher au barème normal', () => {
    const values = copied(
      'rewards.happyHourRewards.gift.',
      ['rewards.happyHourRewards.sub.', 'rewards.happyHourRewards.resub.'],
      {
        ...DRAFT,
        '#reward-hh-gift-tier1': '31',
        '#reward-hh-gift-tier2': '32',
        '#reward-hh-gift-tier3': '33',
      },
    );

    expect(values).toStrictEqual({
      '#reward-hh-sub-tier1': '31',
      '#reward-hh-sub-tier2': '32',
      '#reward-hh-sub-tier3': '33',
      '#reward-hh-resub-tier1': '31',
      '#reward-hh-resub-tier2': '32',
      '#reward-hh-resub-tier3': '33',
    });
  });

  it('sert aussi les cartes du barème de points de la barre', () => {
    const outcome = copyReward(
      fieldsOf('goals'),
      {
        '#goal-points-sub-prime': '200',
        '#goal-points-sub-tier1': '250',
        '#goal-points-sub-tier2': '500',
        '#goal-points-sub-tier3': '1250',
      },
      'goals.points.sub.',
      ['goals.points.resub.', 'goals.points.gift.'],
    );

    expect(outcome).toStrictEqual({
      ok: true,
      values: {
        '#goal-points-resub-prime': '200',
        '#goal-points-resub-tier1': '250',
        '#goal-points-resub-tier2': '500',
        '#goal-points-resub-tier3': '1250',
        '#goal-points-gift-tier1': '250',
        '#goal-points-gift-tier2': '500',
        '#goal-points-gift-tier3': '1250',
      },
    });
  });
});
