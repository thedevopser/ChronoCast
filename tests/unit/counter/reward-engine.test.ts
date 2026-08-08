import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '../../../src/core/config/defaults.js';
import { configSchema, type RewardsConfig } from '../../../src/core/config/schema.js';
import { computeReward } from '../../../src/core/counter/reward-engine.js';
import type {
  BitsEvent,
  CommandEvent,
  FollowEvent,
  GiftEvent,
  RaidEvent,
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

    it('plafonne une salve massive', () => {
      const rewards = rewardsWith({ gift: { tier1: 180, maxPerEvent: 600 } });
      const event: GiftEvent = {
        ...baseEvent(),
        type: 'gift',
        tier: 'tier1',
        total: 100,
        isAnonymous: false,
      };

      expect(computeReward(event, rewards).seconds).toBe(600);
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

    it('plafonne un don massif', () => {
      const rewards = rewardsWith({
        bits: { mode: 'linear', linear: { unit: 100, secondsPerUnit: 60 }, maxPerEvent: 300 },
      });
      const event: BitsEvent = { ...baseEvent(), type: 'bits', bits: 100_000 };

      expect(computeReward(event, rewards).seconds).toBe(300);
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
  });

  describe('raid', () => {
    it('ne crédite rien tant que le raid est désactivé', () => {
      const event: RaidEvent = { ...baseEvent(), type: 'raid', viewers: 100 };

      expect(computeReward(event, REWARDS).applied).toBe(false);
    });

    it('crédite proportionnellement aux spectateurs une fois activé', () => {
      const rewards = rewardsWith({
        raid: { enabled: true, secondsPerViewer: 2, minViewers: 5, maxSeconds: 600 },
      });
      const event: RaidEvent = { ...baseEvent(), type: 'raid', viewers: 50 };

      expect(computeReward(event, rewards).seconds).toBe(100);
    });

    it('ignore un raid sous le seuil de spectateurs', () => {
      const rewards = rewardsWith({ raid: { enabled: true, minViewers: 10 } });
      const event: RaidEvent = { ...baseEvent(), type: 'raid', viewers: 3 };

      expect(computeReward(event, rewards).applied).toBe(false);
    });

    it('plafonne un raid massif', () => {
      const rewards = rewardsWith({
        raid: { enabled: true, secondsPerViewer: 2, minViewers: 1, maxSeconds: 60 },
      });
      const event: RaidEvent = { ...baseEvent(), type: 'raid', viewers: 10_000 };

      expect(computeReward(event, rewards).seconds).toBe(60);
    });
  });

  describe('follow', () => {
    it('ne crédite rien tant que le follow est désactivé', () => {
      const event: FollowEvent = { ...baseEvent(), type: 'follow' };

      expect(computeReward(event, REWARDS).applied).toBe(false);
    });

    it('crédite le montant configuré une fois activé', () => {
      const rewards = rewardsWith({ follow: { enabled: true, seconds: 10, maxPerHour: 60 } });
      const event: FollowEvent = { ...baseEvent(), type: 'follow' };

      expect(computeReward(event, rewards, { followsInLastHour: 0 }).seconds).toBe(10);
    });

    it('cesse de créditer au-delà du quota horaire', () => {
      const rewards = rewardsWith({ follow: { enabled: true, seconds: 10, maxPerHour: 5 } });
      const event: FollowEvent = { ...baseEvent(), type: 'follow' };

      expect(computeReward(event, rewards, { followsInLastHour: 5 }).applied).toBe(false);
    });

    it('crédite encore juste sous le quota horaire', () => {
      const rewards = rewardsWith({ follow: { enabled: true, seconds: 10, maxPerHour: 5 } });
      const event: FollowEvent = { ...baseEvent(), type: 'follow' };

      expect(computeReward(event, rewards, { followsInLastHour: 4 }).applied).toBe(true);
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
      const event: FollowEvent = { ...baseEvent(), type: 'follow' };

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
