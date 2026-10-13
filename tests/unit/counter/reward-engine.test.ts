import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '../../../src/core/config/defaults.js';
import { configSchema, type RewardsConfig } from '../../../src/core/config/schema.js';
import { computeReward } from '../../../src/core/counter/reward-engine.js';
import type {
  BitsEvent,
  CommandEvent,
  GiftEvent,
  ResubEvent,
  SubEvent,
} from '../../../src/core/events/domain-event.js';

const REWARDS: RewardsConfig = DEFAULT_CONFIG.rewards;

function rewardsWith(patch: unknown): RewardsConfig {
  return configSchema.parse({ rewards: patch }).rewards;
}

function baseEvent(): { id: string; occurredAt: number; userId: string; userName: string; source: 'eventsub' } {
  return {
    id: 'msg-1',
    occurredAt: 1_754_000_000_000,
    userId: '12345',
    userName: 'Spectateur',
    source: 'eventsub',
  };
}

describe('computeReward', () => {
  describe('abonnements', () => {
    it('crédite trois minutes pour un Tier 1', () => {
      const event: SubEvent = { ...baseEvent(), type: 'sub', tier: 'tier1' };

      expect(computeReward(event, REWARDS).seconds).toBe(180);
    });

    it('crédite quatre minutes pour un Tier 2', () => {
      const event: SubEvent = { ...baseEvent(), type: 'sub', tier: 'tier2' };

      expect(computeReward(event, REWARDS).seconds).toBe(240);
    });

    it('crédite cinq minutes pour un Tier 3', () => {
      const event: SubEvent = { ...baseEvent(), type: 'sub', tier: 'tier3' };

      expect(computeReward(event, REWARDS).seconds).toBe(300);
    });

    it('applique le barème Prime, distinct du Tier 1', () => {
      const rewards = rewardsWith({ sub: { prime: 90 } });
      const event: SubEvent = { ...baseEvent(), type: 'sub', tier: 'prime' };

      expect(computeReward(event, rewards).seconds).toBe(90);
    });

    it('applique au réabonnement son propre barème', () => {
      const rewards = rewardsWith({ resub: { tier1: 60 } });
      const event: ResubEvent = {
        ...baseEvent(),
        type: 'resub',
        tier: 'tier1',
        cumulativeMonths: 12,
      };

      expect(computeReward(event, rewards).seconds).toBe(60);
    });
  });

  describe('dons d\'abonnements', () => {
    it('multiplie la récompense par le nombre d\'abonnements offerts', () => {
      const event: GiftEvent = {
        ...baseEvent(),
        type: 'gift',
        tier: 'tier1',
        total: 5,
        isAnonymous: false,
      };

      expect(computeReward(event, REWARDS).seconds).toBe(900);
    });

    it.each([
      [20, 3_600],
      [200, 36_000],
      [1_000, 180_000],
    ])('crédite intégralement une salve de %i abonnements', (total, expected) => {
      const event: GiftEvent = {
        ...baseEvent(),
        type: 'gift',
        tier: 'tier1',
        total,
        isAnonymous: false,
      };

      expect(computeReward(event, REWARDS).seconds).toBe(expected);
    });

    it('crédite intégralement une salve massive de Tier 3', () => {
      const event: GiftEvent = {
        ...baseEvent(),
        type: 'gift',
        tier: 'tier3',
        total: 1_000,
        isAnonymous: false,
      };

      expect(computeReward(event, REWARDS).seconds).toBe(300_000);
    });

    it('ne mentionne aucun plafonnement dans le motif', () => {
      const event: GiftEvent = {
        ...baseEvent(),
        type: 'gift',
        tier: 'tier1',
        total: 1_000,
        isAnonymous: false,
      };

      expect(computeReward(event, REWARDS).reason).not.toContain('plafonné');
    });

    it('applique le palier des abonnements offerts', () => {
      const event: GiftEvent = {
        ...baseEvent(),
        type: 'gift',
        tier: 'tier3',
        total: 2,
        isAnonymous: false,
      };

      expect(computeReward(event, REWARDS).seconds).toBe(600);
    });

    it('ignore un total nul ou négatif', () => {
      const event: GiftEvent = {
        ...baseEvent(),
        type: 'gift',
        tier: 'tier1',
        total: 0,
        isAnonymous: false,
      };

      expect(computeReward(event, REWARDS).applied).toBe(false);
    });
  });

  describe('bits', () => {
    function bits(amount: number): BitsEvent {
      return { ...baseEvent(), type: 'bits', bits: amount };
    }

    it('crédite le taux par défaut : 100 bits pour 60 secondes', () => {
      expect(computeReward(bits(100), REWARDS).seconds).toBe(60);
    });

    it('crédite au bit près, et non par tranches entières', () => {
      expect(computeReward(bits(150), REWARDS).seconds).toBe(90);
      expect(computeReward(bits(50), REWARDS).seconds).toBe(30);
    });

    it('fait compter chaque bit : un seul ajoute 0,6 seconde', () => {
      const reward = computeReward(bits(1), REWARDS);

      expect(reward.applied).toBe(true);
      expect(reward.seconds).toBe(0.6);
    });

    it('garde les décimales d’un don qui ne tombe pas juste', () => {
      expect(computeReward(bits(7), REWARDS).seconds).toBe(4.2);
    });

    it('arrondit à la milliseconde un taux sans écriture décimale finie', () => {
      const thirds = rewardsWith({ bits: { unit: 3, seconds: 1 } });

      expect(computeReward(bits(1), thirds).seconds).toBe(0.333);
      expect(computeReward(bits(2), thirds).seconds).toBe(0.667);
    });

    it('suit le taux réglé', () => {
      expect(computeReward(bits(250), rewardsWith({ bits: { unit: 1, seconds: 2 } })).seconds).toBe(500);
    });

    it('crédite intégralement un don massif', () => {
      expect(computeReward(bits(100_000), REWARDS).seconds).toBe(60_000);
    });

    it('ne crédite rien quand le taux vaut zéro seconde', () => {
      const off = rewardsWith({ bits: { unit: 100, seconds: 0 } });

      expect(computeReward(bits(500), off)).toMatchObject({ seconds: 0, applied: false });
    });

    it('ne crédite rien quand le crédit n’atteint pas la milliseconde', () => {
      const tiny = rewardsWith({ bits: { unit: 1_000_000, seconds: 1 } });

      expect(computeReward(bits(1), tiny)).toMatchObject({ seconds: 0, applied: false });
    });

    it.each([0, -5])('refuse un nombre de bits de %d', (amount) => {
      expect(computeReward(bits(amount), REWARDS).applied).toBe(false);
    });
  });

  describe('motif de la récompense', () => {
    it('décrit un abonnement de façon exploitable dans l\'historique', () => {
      const event: SubEvent = { ...baseEvent(), type: 'sub', tier: 'tier2' };

      expect(computeReward(event, REWARDS).reason).toContain('tier2');
    });

    it('mentionne le nombre d\'abonnements offerts', () => {
      const event: GiftEvent = {
        ...baseEvent(),
        type: 'gift',
        tier: 'tier1',
        total: 5,
        isAnonymous: false,
      };

      expect(computeReward(event, REWARDS).reason).toContain('5');
    });

    it('explique pourquoi rien n\'a été crédité', () => {
      const event: GiftEvent = {
        ...baseEvent(),
        type: 'gift',
        tier: 'tier1',
        total: 0,
        isAnonymous: false,
      };

      expect(computeReward(event, REWARDS).applied).toBe(false);
      expect(computeReward(event, REWARDS).reason).not.toBe('');
    });
  });
});

describe('commande de chat', () => {
  function commandEvent(seconds: number): CommandEvent {
    return { ...baseEvent(), source: 'chat-command', type: 'command', command: 'addtime', seconds };
  }

  it('crédite les secondes portées par la commande', () => {
    expect(computeReward(commandEvent(300), REWARDS).seconds).toBe(300);
    expect(computeReward(commandEvent(300), REWARDS).applied).toBe(true);
  });

  it('écrête au plafond configuré', () => {
    const rewards = rewardsWith({ chatCommand: { maxSeconds: 600 } });

    expect(computeReward(commandEvent(99_999), rewards).seconds).toBe(600);
  });

  it('refuse une durée nulle ou négative', () => {
    expect(computeReward(commandEvent(0), REWARDS).applied).toBe(false);
    expect(computeReward(commandEvent(-60), REWARDS).applied).toBe(false);
    expect(computeReward(commandEvent(-60), REWARDS).seconds).toBe(0);
  });

  it('nomme la commande dans le motif, pour l’historique', () => {
    expect(computeReward(commandEvent(300), REWARDS).reason).toContain('addtime');
  });
});

describe('origine d’une dépense de bits', () => {
  function bits(usage?: BitsEvent['usage']): BitsEvent {
    return { ...baseEvent(), type: 'bits', bits: 250, ...(usage === undefined ? {} : { usage }) };
  }

  it('crédite un Power-up comme un cheer du même montant', () => {
    expect(computeReward(bits('power_up'), REWARDS).seconds).toBe(
      computeReward(bits('cheer'), REWARDS).seconds,
    );
    expect(computeReward(bits('custom_power_up'), REWARDS).seconds).toBe(
      computeReward(bits(), REWARDS).seconds,
    );
  });

  it('laisse le motif d’un cheer tel qu’il était', () => {
    expect(computeReward(bits('cheer'), REWARDS).reason).toBe('250 bits');
    expect(computeReward(bits(), REWARDS).reason).toBe('250 bits');
  });

  it.each([
    ['power_up', '250 bits en Power-up'],
    ['custom_power_up', '250 bits en Power-up personnalisé'],
    ['unknown', '250 bits d’origine inconnue'],
  ] as const)('dit dans le motif qu’une dépense %s n’est pas un cheer', (usage, reason) => {
    expect(computeReward(bits(usage), REWARDS).reason).toBe(reason);
  });

  it('le dit aussi sur un refus', () => {
    const small: BitsEvent = { ...baseEvent(), type: 'bits', bits: 30, usage: 'power_up' };
    const off = rewardsWith({ bits: { unit: 100, seconds: 0 } });

    expect(computeReward(small, off).applied).toBe(false);
    expect(computeReward(small, off).reason).toContain('30 bits en Power-up');
  });
});

describe('Happy Hour', () => {
  const DOUBLED: RewardsConfig = rewardsWith({ happyHour: true });

  function commandEvent(seconds: number): CommandEvent {
    return { ...baseEvent(), source: 'chat-command', type: 'command', command: 'addtime', seconds };
  }

  describe('ce qui double', () => {
    const CUSTOM: RewardsConfig = rewardsWith({
      happyHour: true,
      sub: { prime: 100, tier1: 300, tier2: 600, tier3: 900 },
      resub: { prime: 100, tier1: 300, tier2: 600, tier3: 900 },
      gift: { tier1: 300, tier2: 600, tier3: 900 },
      happyHourRewards: {
        sub: { prime: 110, tier1: 700, tier2: 710, tier3: 720 },
        resub: { prime: 120, tier1: 800, tier2: 810, tier3: 820 },
        gift: { tier1: 50, tier2: 60, tier3: 70 },
      },
    });

    it('crédite un abonnement selon le barème Happy Hour, et non le double du barème normal', () => {
      const event: SubEvent = { ...baseEvent(), type: 'sub', tier: 'tier1' };

      expect(computeReward(event, CUSTOM).seconds).toBe(700);
    });

    it('lit le tier et le Prime dans le barème Happy Hour', () => {
      const tier3: SubEvent = { ...baseEvent(), type: 'sub', tier: 'tier3' };
      const prime: SubEvent = { ...baseEvent(), type: 'sub', tier: 'prime' };

      expect(computeReward(tier3, CUSTOM).seconds).toBe(720);
      expect(computeReward(prime, CUSTOM).seconds).toBe(110);
    });

    it('crédite un réabonnement selon le barème Happy Hour', () => {
      const event: ResubEvent = {
        ...baseEvent(),
        type: 'resub',
        tier: 'tier2',
        cumulativeMonths: 12,
      };

      expect(computeReward(event, CUSTOM).seconds).toBe(810);
    });

    it('crédite une salve d’abonnements offerts au tarif Happy Hour du tier, fois le total', () => {
      const event: GiftEvent = {
        ...baseEvent(),
        type: 'gift',
        tier: 'tier1',
        total: 5,
        isAnonymous: false,
      };

      expect(computeReward(event, CUSTOM).seconds).toBe(250);
    });

    it('revient au barème normal une fois éteint', () => {
      const event: SubEvent = { ...baseEvent(), type: 'sub', tier: 'tier1' };

      expect(computeReward(event, { ...CUSTOM, happyHour: false }).seconds).toBe(300);
    });

    it('vaut le double du barème par défaut tant que rien n’est réglé', () => {
      const event: SubEvent = { ...baseEvent(), type: 'sub', tier: 'tier1' };

      expect(computeReward(event, DOUBLED).seconds).toBe(360);
    });

    it('vaut pour les bits le double du taux par défaut tant que rien n’est réglé', () => {
      const event: BitsEvent = { ...baseEvent(), type: 'bits', bits: 250 };

      expect(computeReward(event, DOUBLED).seconds).toBe(300);
    });

    it('évalue un don de bits au taux du Happy Hour, et non au taux normal', () => {
      const rewards = rewardsWith({
        happyHour: true,
        bits: { unit: 100, seconds: 60 },
        happyHourRewards: { bits: { unit: 50, seconds: 7 } },
      });
      const event: BitsEvent = { ...baseEvent(), type: 'bits', bits: 250 };

      expect(computeReward(event, rewards).seconds).toBe(35);
    });

    it('fait compter chaque bit en Happy Hour aussi', () => {
      const event: BitsEvent = { ...baseEvent(), type: 'bits', bits: 1 };

      expect(computeReward(event, DOUBLED).seconds).toBe(1.2);
    });
  });

  describe('ce qui ne double pas', () => {
    it('crédite la valeur littérale d’une commande de chat', () => {
      expect(computeReward(commandEvent(300), DOUBLED).seconds).toBe(300);
    });

    it('ne double pas le plafond d’une commande de chat', () => {
      const rewards = rewardsWith({ happyHour: true, chatCommand: { maxSeconds: 600 } });

      expect(computeReward(commandEvent(99_999), rewards).seconds).toBe(600);
    });

    it('laisse un refus à zéro seconde', () => {
      const event: GiftEvent = {
        ...baseEvent(),
        type: 'gift',
        tier: 'tier1',
        total: 0,
        isAnonymous: false,
      };

      expect(computeReward(event, DOUBLED).applied).toBe(false);
      expect(computeReward(event, DOUBLED).seconds).toBe(0);
    });
  });

  describe('motif', () => {
    it('dit que le crédit vient du barème Happy Hour, pour que l’historique ne mente pas sur le calcul', () => {
      const event: SubEvent = { ...baseEvent(), type: 'sub', tier: 'tier1' };

      expect(computeReward(event, DOUBLED).reason).toBe('abonnement tier1, Happy Hour');
    });

    it('dit de même pour les bits, sans plus annoncer de multiplicateur', () => {
      const event: BitsEvent = { ...baseEvent(), type: 'bits', bits: 250 };

      expect(computeReward(event, DOUBLED).reason).toBe('250 bits, Happy Hour');
    });

    it('conserve le motif de base devant la mention', () => {
      const event: SubEvent = { ...baseEvent(), type: 'sub', tier: 'tier2' };

      expect(computeReward(event, DOUBLED).reason).toContain('tier2');
    });

    it('ne mentionne rien sur un refus', () => {
      const event: BitsEvent = { ...baseEvent(), type: 'bits', bits: -50 };

      expect(computeReward(event, DOUBLED).reason).not.toContain('Happy Hour');
    });

    it('ne mentionne rien sur une commande de chat', () => {
      expect(computeReward(commandEvent(300), DOUBLED).reason).not.toContain('Happy Hour');
    });
  });

  it('ne change strictement rien lorsqu’il est éteint', () => {
    const event: SubEvent = { ...baseEvent(), type: 'sub', tier: 'tier1' };

    expect(computeReward(event, REWARDS)).toEqual({
      seconds: 180,
      applied: true,
      reason: 'abonnement tier1',
    });
  });
});
