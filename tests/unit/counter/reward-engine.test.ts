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

  describe('bits en mode linéaire', () => {
    it('crédite une unité complète', () => {
      const event: BitsEvent = { ...baseEvent(), type: 'bits', bits: 100 };

      expect(computeReward(event, REWARDS).seconds).toBe(60);
    });

    it('ne crédite que les unités entières', () => {
      const event: BitsEvent = { ...baseEvent(), type: 'bits', bits: 250 };

      expect(computeReward(event, REWARDS).seconds).toBe(120);
    });

    it('ne crédite rien sous le seuil d\'une unité', () => {
      const event: BitsEvent = { ...baseEvent(), type: 'bits', bits: 50 };

      expect(computeReward(event, REWARDS).seconds).toBe(0);
      expect(computeReward(event, REWARDS).applied).toBe(false);
    });

    it('respecte un seuil minimal configuré', () => {
      const rewards = rewardsWith({
        bits: { mode: 'linear', linear: { unit: 1, secondsPerUnit: 1, minBits: 500 } },
      });
      const event: BitsEvent = { ...baseEvent(), type: 'bits', bits: 100 };

      expect(computeReward(event, rewards).applied).toBe(false);
    });

    it('crédite intégralement un don massif', () => {
      const rewards = rewardsWith({
        bits: { mode: 'linear', linear: { unit: 100, secondsPerUnit: 60 } },
      });
      const event: BitsEvent = { ...baseEvent(), type: 'bits', bits: 100_000 };

      expect(computeReward(event, rewards).seconds).toBe(60_000);
    });
  });

  describe('bits en mode paliers', () => {
    it('retient le palier le plus élevé atteint', () => {
      const rewards = rewardsWith({
        bits: {
          mode: 'tiers',
          tiers: [
            { minBits: 100, seconds: 60 },
            { minBits: 500, seconds: 360 },
            { minBits: 1_000, seconds: 900 },
          ],
        },
      });
      const event: BitsEvent = { ...baseEvent(), type: 'bits', bits: 700 };

      expect(computeReward(event, rewards).seconds).toBe(360);
    });

    it('ne crédite rien sous le premier palier', () => {
      const rewards = rewardsWith({
        bits: { mode: 'tiers', tiers: [{ minBits: 100, seconds: 60 }] },
      });
      const event: BitsEvent = { ...baseEvent(), type: 'bits', bits: 50 };

      expect(computeReward(event, rewards).applied).toBe(false);
    });

    it('retient le palier le plus élevé même si les paliers sont mal ordonnés', () => {
      const rewards = rewardsWith({
        bits: {
          mode: 'tiers',
          tiers: [
            { minBits: 1_000, seconds: 900 },
            { minBits: 100, seconds: 60 },
          ],
        },
      });
      const event: BitsEvent = { ...baseEvent(), type: 'bits', bits: 5_000 };

      expect(computeReward(event, rewards).seconds).toBe(900);
    });

    it('crédite intégralement un palier de plus d\'une heure', () => {
      const rewards = rewardsWith({
        bits: { mode: 'tiers', tiers: [{ minBits: 10_000, seconds: 36_000 }] },
      });
      const event: BitsEvent = { ...baseEvent(), type: 'bits', bits: 50_000 };

      expect(computeReward(event, rewards).seconds).toBe(36_000);
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
