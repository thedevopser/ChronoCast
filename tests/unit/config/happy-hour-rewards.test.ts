import { describe, expect, it } from 'vitest';

import { withDerivedHappyHourRewards } from '../../../src/core/config/happy-hour-rewards.js';
import { configSchema } from '../../../src/core/config/schema.js';

const CUSTOM_REWARDS = {
  sub: { prime: 100, tier1: 300, tier2: 600, tier3: 900 },
  resub: { prime: 50, tier1: 150, tier2: 250, tier3: 350 },
  gift: { tier1: 200, tier2: 400, tier3: 800 },
};

function derived(raw: unknown) {
  const parsed = configSchema.safeParse(raw);
  const config = parsed.success ? parsed.data : configSchema.parse({});

  return withDerivedHappyHourRewards(raw, config).rewards.happyHourRewards;
}

describe('withDerivedHappyHourRewards', () => {
  it('double le barème du streamer quand le fichier ne porte pas de barème Happy Hour', () => {
    expect(derived({ schemaVersion: 5, rewards: CUSTOM_REWARDS })).toMatchObject({
      sub: { prime: 200, tier1: 600, tier2: 1_200, tier3: 1_800 },
      resub: { prime: 100, tier1: 300, tier2: 500, tier3: 700 },
      gift: { tier1: 400, tier2: 800, tier3: 1_600 },
    });
  });

  it('double les valeurs par défaut quand le fichier ne dit rien du barème', () => {
    expect(derived({ schemaVersion: 5 }).sub).toStrictEqual({
      prime: 360,
      tier1: 360,
      tier2: 480,
      tier3: 600,
    });
  });

  it.each([null, 'texte', 42, []])('tient sur un fichier de forme %o', (raw) => {
    expect(derived(raw).gift).toStrictEqual({ tier1: 360, tier2: 480, tier3: 600 });
  });

  it('ne touche pas à un barème Happy Hour déjà écrit', () => {
    const happyHourRewards = {
      sub: { prime: 1, tier1: 2, tier2: 3, tier3: 4 },
      resub: { prime: 5, tier1: 6, tier2: 7, tier3: 8 },
      gift: { tier1: 9, tier2: 10, tier3: 11 },
    };

    expect(derived({ rewards: { ...CUSTOM_REWARDS, happyHourRewards } })).toMatchObject(
      happyHourRewards,
    );
  });

  it('ne dérive que les barèmes absents', () => {
    const outcome = derived({
      rewards: { ...CUSTOM_REWARDS, happyHourRewards: { sub: { tier1: 999 } } },
    });

    expect(outcome.sub.tier1).toBe(999);
    expect(outcome.resub.tier1).toBe(300);
    expect(outcome.gift.tier3).toBe(1_600);
  });

  it('laisse le reste de la configuration et son argument intacts', () => {
    const config = configSchema.parse({ rewards: CUSTOM_REWARDS });
    const before = structuredClone(config);

    const outcome = withDerivedHappyHourRewards({ rewards: CUSTOM_REWARDS }, config);

    expect(config).toStrictEqual(before);
    expect({ ...outcome, rewards: { ...outcome.rewards, happyHourRewards: null } }).toStrictEqual({
      ...before,
      rewards: { ...before.rewards, happyHourRewards: null },
    });
  });

  describe('bits', () => {
    const CUSTOM_BITS = { unit: 50, seconds: 30 };

    it('double les secondes du taux et recopie tel quel son nombre de bits', () => {
      expect(derived({ schemaVersion: 6, rewards: { bits: CUSTOM_BITS } }).bits).toStrictEqual({
        unit: 50,
        seconds: 60,
      });
    });

    it('dérive les bits d’une configuration qui porte déjà le barème des abonnements', () => {
      const outcome = derived({
        schemaVersion: 6,
        rewards: { bits: CUSTOM_BITS, happyHourRewards: { sub: { tier1: 999 } } },
      });

      expect(outcome.sub.tier1).toBe(999);
      expect(outcome.bits.seconds).toBe(60);
    });

    it('ne touche pas à un taux déjà écrit', () => {
      const bits = { unit: 10, seconds: 1 };

      expect(derived({ rewards: { bits: CUSTOM_BITS, happyHourRewards: { bits } } }).bits).toStrictEqual(
        bits,
      );
    });
  });
});
