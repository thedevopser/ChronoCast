import { describe, expect, it } from 'vitest';

import { configSchema, type GoalsConfig } from '../../../src/core/config/schema.js';
import type {
  BitsEvent,
  CommandEvent,
  GiftEvent,
  ResubEvent,
  SubEvent,
} from '../../../src/core/events/domain-event.js';
import { pointsGained } from '../../../src/core/goals/goal-progress.js';

function goalsWith(patch: unknown): GoalsConfig {
  return configSchema.parse({ goals: patch }).goals;
}

// Une barre où chaque abonnement vaut un point.
const ONE_POINT = { tier1: 1, tier2: 1, tier3: 1, prime: 1 };

const GOALS: GoalsConfig = goalsWith({
  points: { sub: ONE_POINT, resub: ONE_POINT, gift: { tier1: 1, tier2: 1, tier3: 1 } },
});

function baseEvent(): {
  id: string;
  occurredAt: number;
  userId: string;
  userName: string;
  source: 'eventsub';
} {
  return {
    id: 'msg-1',
    occurredAt: 1_754_000_000_000,
    userId: '12345',
    userName: 'Spectateur',
    source: 'eventsub',
  };
}

describe('pointsGained', () => {
  describe('abonnements', () => {
    it('compte un abonnement pour un sub', () => {
      const event: SubEvent = { ...baseEvent(), type: 'sub', tier: 'tier1' };

      expect(pointsGained(event, GOALS)).toBe(1);
    });

    it('vaut un quel que soit le tier quand tous les poids sont à un', () => {
      const tier3: SubEvent = { ...baseEvent(), type: 'sub', tier: 'tier3' };
      const prime: SubEvent = { ...baseEvent(), type: 'sub', tier: 'prime' };

      expect(pointsGained(tier3, GOALS)).toBe(1);
      expect(pointsGained(prime, GOALS)).toBe(1);
    });

    it('compte un abonnement pour un réabonnement, quel que soit son ancienneté', () => {
      const event: ResubEvent = {
        ...baseEvent(),
        type: 'resub',
        tier: 'tier2',
        cumulativeMonths: 48,
      };

      expect(pointsGained(event, GOALS)).toBe(1);
    });
  });

  describe('subs offerts', () => {
    it('compte autant d’abonnements que le don en porte', () => {
      const event: GiftEvent = {
        ...baseEvent(),
        type: 'gift',
        tier: 'tier1',
        total: 10,
        isAnonymous: false,
      };

      expect(pointsGained(event, GOALS)).toBe(10);
    });

    it('compte un don anonyme comme les autres', () => {
      const event: GiftEvent = {
        ...baseEvent(),
        type: 'gift',
        tier: 'tier1',
        total: 3,
        isAnonymous: true,
      };

      expect(pointsGained(event, GOALS)).toBe(3);
    });

    it('ne compte rien pour un total invalide', () => {
      const event: GiftEvent = {
        ...baseEvent(),
        type: 'gift',
        tier: 'tier1',
        total: 0,
        isAnonymous: false,
      };

      expect(pointsGained(event, GOALS)).toBe(0);
      expect(pointsGained({ ...event, total: -5 }, GOALS)).toBe(0);
    });
  });

  describe('bits', () => {
    it.each([1, 499, 500, 1_200])('compte un point par bit, sans tranche ni reste : %d bits', (bits) => {
      const event: BitsEvent = { ...baseEvent(), type: 'bits', bits };

      expect(pointsGained(event, GOALS)).toBe(bits);
    });

    it('ne dépend d’aucun réglage : l’ancien « bits par point » est sans effet', () => {
      const event: BitsEvent = { ...baseEvent(), type: 'bits', bits: 1_000 };

      expect(pointsGained(event, goalsWith({ bitsPerSub: 100 }))).toBe(1_000);
    });

    it('ne compte rien pour un nombre de bits invalide', () => {
      const event: BitsEvent = { ...baseEvent(), type: 'bits', bits: 0 };

      expect(pointsGained(event, GOALS)).toBe(0);
      expect(pointsGained({ ...event, bits: -100 }, GOALS)).toBe(0);
    });
  });

  describe('commande de chat', () => {
    it('ne compte rien : un crédit accordé à la main ne gonfle pas une promesse', () => {
      const event: CommandEvent = {
        ...baseEvent(),
        type: 'command',
        command: 'addtime',
        seconds: 3_600,
      };

      expect(pointsGained(event, GOALS)).toBe(0);
    });
  });

  describe('barème de points', () => {
    const WEIGHTED = goalsWith({
      points: {
        sub: { prime: 2, tier1: 3, tier2: 5, tier3: 8 },
        resub: { prime: 20, tier1: 30, tier2: 50, tier3: 80 },
        gift: { tier1: 4, tier2: 6, tier3: 9 },
      },
    });

    it.each([
      ['prime', 2],
      ['tier1', 3],
      ['tier2', 5],
      ['tier3', 8],
    ] as const)('ajoute pour un abonnement %s les points de son tier', (tier, points) => {
      const event: SubEvent = { ...baseEvent(), type: 'sub', tier };

      expect(pointsGained(event, WEIGHTED)).toBe(points);
    });

    it.each([
      ['prime', 20],
      ['tier1', 30],
      ['tier2', 50],
      ['tier3', 80],
    ] as const)('ajoute pour un réabonnement %s les points de son tier', (tier, points) => {
      const event: ResubEvent = { ...baseEvent(), type: 'resub', tier, cumulativeMonths: 3 };

      expect(pointsGained(event, WEIGHTED)).toBe(points);
    });

    it.each([
      ['tier1', 20],
      ['tier2', 30],
      ['tier3', 45],
    ] as const)('ajoute pour un lot de cinq subs offerts %s cinq fois les points du tier', (tier, points) => {
      const event: GiftEvent = { ...baseEvent(), type: 'gift', tier, total: 5, isAnonymous: false };

      expect(pointsGained(event, WEIGHTED)).toBe(points);
    });

    it('retire de la barre un type d’événement dont le poids est nul', () => {
      const muted = goalsWith({ points: { sub: { tier1: 0 }, gift: { tier1: 0 } } });
      const sub: SubEvent = { ...baseEvent(), type: 'sub', tier: 'tier1' };
      const gift: GiftEvent = { ...baseEvent(), type: 'gift', tier: 'tier1', total: 10, isAnonymous: false };

      expect(pointsGained(sub, muted)).toBe(0);
      expect(pointsGained(gift, muted)).toBe(0);
    });

    it('ne compte rien pour un lot au total invalide, même pondéré', () => {
      const event: GiftEvent = { ...baseEvent(), type: 'gift', tier: 'tier1', total: 0, isAnonymous: false };

      expect(pointsGained(event, WEIGHTED)).toBe(0);
      expect(pointsGained({ ...event, total: -3 }, WEIGHTED)).toBe(0);
    });

    it('ne pondère pas les bits : un bit vaut un point quel que soit le barème', () => {
      const event: BitsEvent = { ...baseEvent(), type: 'bits', bits: 250 };

      expect(pointsGained(event, WEIGHTED)).toBe(250);
    });

    it('n’ajoute aucun point pour une commande de chat, quel que soit le barème', () => {
      const event: CommandEvent = {
        ...baseEvent(),
        source: 'chat-command',
        type: 'command',
        command: 'addtime',
        seconds: 300,
      };

      expect(pointsGained(event, WEIGHTED)).toBe(0);
    });

    // Le cas d'usage qui a motivé le barème : un objectif mensuel en points, tout confondu.
    it('tient « 1 bit = 1 point, 1 sub Tier 1 = 250 points »', () => {
      const monthly = goalsWith({ points: { sub: { tier1: 250 } } });
      const cheer: BitsEvent = { ...baseEvent(), type: 'bits', bits: 250 };
      const sub: SubEvent = { ...baseEvent(), type: 'sub', tier: 'tier1' };

      expect(pointsGained(cheer, monthly)).toBe(250);
      expect(pointsGained(sub, monthly)).toBe(250);
    });
  });

  describe('valeurs de départ', () => {
    const DEFAULTS = goalsWith({});

    it('ajoute un point par bit', () => {
      const event: BitsEvent = { ...baseEvent(), type: 'bits', bits: 137 };

      expect(pointsGained(event, DEFAULTS)).toBe(137);
    });

    it('pèse un abonnement à son prix en bits, selon son tier', () => {
      const tier1: SubEvent = { ...baseEvent(), type: 'sub', tier: 'tier1' };
      const tier3: SubEvent = { ...baseEvent(), type: 'sub', tier: 'tier3' };

      expect(pointsGained(tier1, DEFAULTS)).toBe(500);
      expect(pointsGained(tier3, DEFAULTS)).toBe(2_500);
    });
  });

  describe('mode subs', () => {
    const SUBS = goalsWith({ mode: 'subs' });
    const WEIGHTED_SUBS = goalsWith({
      mode: 'subs',
      subWeights: {
        sub: { prime: 1, tier1: 1, tier2: 2, tier3: 6 },
        resub: { prime: 1, tier1: 1, tier2: 2, tier3: 6 },
        gift: { tier1: 1, tier2: 2, tier3: 6 },
      },
    });

    it('ne compte pas les bits, quel qu’en soit le montant', () => {
      const event: BitsEvent = { ...baseEvent(), type: 'bits', bits: 100_000 };

      expect(pointsGained(event, SUBS)).toBe(0);
    });

    it.each(['prime', 'tier1', 'tier2', 'tier3'] as const)(
      'compte un abonnement %s pour un tant que rien n’est réglé',
      (tier) => {
        const sub: SubEvent = { ...baseEvent(), type: 'sub', tier };
        const resub: ResubEvent = { ...baseEvent(), type: 'resub', tier, cumulativeMonths: 3 };

        expect(pointsGained(sub, SUBS)).toBe(1);
        expect(pointsGained(resub, SUBS)).toBe(1);
      },
    );

    it('compte un lot de subs offerts pour le nombre de subs', () => {
      const event: GiftEvent = { ...baseEvent(), type: 'gift', tier: 'tier3', total: 7, isAnonymous: false };

      expect(pointsGained(event, SUBS)).toBe(7);
    });

    it('suit les poids par tier propres au mode subs, et non le barème de points', () => {
      const tier3: SubEvent = { ...baseEvent(), type: 'sub', tier: 'tier3' };
      const gift: GiftEvent = { ...baseEvent(), type: 'gift', tier: 'tier2', total: 5, isAnonymous: false };

      expect(pointsGained(tier3, WEIGHTED_SUBS)).toBe(6);
      expect(pointsGained(gift, WEIGHTED_SUBS)).toBe(10);
    });

    it('ne compte rien pour une commande de chat', () => {
      const event: CommandEvent = {
        ...baseEvent(),
        source: 'chat-command',
        type: 'command',
        command: 'addtime',
        seconds: 300,
      };

      expect(pointsGained(event, SUBS)).toBe(0);
    });
  });

  describe('mode points', () => {
    it('ignore les poids du mode subs', () => {
      const goals = goalsWith({ mode: 'points', subWeights: { sub: { tier1: 9 } } });
      const sub: SubEvent = { ...baseEvent(), type: 'sub', tier: 'tier1' };

      expect(pointsGained(sub, goals)).toBe(500);
    });
  });
});
