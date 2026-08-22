import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '../../../src/core/config/defaults.js';
import { configSchema, type GoalsConfig } from '../../../src/core/config/schema.js';
import type {
  BitsEvent,
  CommandEvent,
  GiftEvent,
  ResubEvent,
  SubEvent,
} from '../../../src/core/events/domain-event.js';
import { subsGained } from '../../../src/core/goals/goal-progress.js';

const GOALS: GoalsConfig = DEFAULT_CONFIG.goals;

function goalsWith(patch: unknown): GoalsConfig {
  return configSchema.parse({ goals: patch }).goals;
}

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

describe('subsGained', () => {
  describe('abonnements', () => {
    it('compte un abonnement pour un sub', () => {
      const event: SubEvent = { ...baseEvent(), type: 'sub', tier: 'tier1' };

      expect(subsGained(event, GOALS)).toBe(1);
    });

    it('ne pondère pas le tier : un Tier 3 vaut un, comme un Tier 1', () => {
      const tier3: SubEvent = { ...baseEvent(), type: 'sub', tier: 'tier3' };
      const prime: SubEvent = { ...baseEvent(), type: 'sub', tier: 'prime' };

      expect(subsGained(tier3, GOALS)).toBe(1);
      expect(subsGained(prime, GOALS)).toBe(1);
    });

    it('compte un abonnement pour un réabonnement, quel que soit son ancienneté', () => {
      const event: ResubEvent = {
        ...baseEvent(),
        type: 'resub',
        tier: 'tier2',
        cumulativeMonths: 48,
      };

      expect(subsGained(event, GOALS)).toBe(1);
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

      expect(subsGained(event, GOALS)).toBe(10);
    });

    it('compte un don anonyme comme les autres', () => {
      const event: GiftEvent = {
        ...baseEvent(),
        type: 'gift',
        tier: 'tier1',
        total: 3,
        isAnonymous: true,
      };

      expect(subsGained(event, GOALS)).toBe(3);
    });

    it('ne compte rien pour un total invalide', () => {
      const event: GiftEvent = {
        ...baseEvent(),
        type: 'gift',
        tier: 'tier1',
        total: 0,
        isAnonymous: false,
      };

      expect(subsGained(event, GOALS)).toBe(0);
      expect(subsGained({ ...event, total: -5 }, GOALS)).toBe(0);
    });
  });

  describe('bits', () => {
    it('compte une tranche entière', () => {
      const event: BitsEvent = { ...baseEvent(), type: 'bits', bits: 500 };

      expect(subsGained(event, GOALS)).toBe(1);
    });

    it('ne conserve aucun reste', () => {
      const event: BitsEvent = { ...baseEvent(), type: 'bits', bits: 1_200 };

      expect(subsGained(event, GOALS)).toBe(2);
    });

    it('ne compte rien sous la première tranche', () => {
      const event: BitsEvent = { ...baseEvent(), type: 'bits', bits: 499 };

      expect(subsGained(event, GOALS)).toBe(0);
    });

    it('suit le nombre de bits par abonnement configuré', () => {
      const event: BitsEvent = { ...baseEvent(), type: 'bits', bits: 1_000 };

      expect(subsGained(event, goalsWith({ bitsPerSub: 100 }))).toBe(10);
    });

    it('ne compte rien pour un nombre de bits invalide', () => {
      const event: BitsEvent = { ...baseEvent(), type: 'bits', bits: 0 };

      expect(subsGained(event, GOALS)).toBe(0);
      expect(subsGained({ ...event, bits: -100 }, GOALS)).toBe(0);
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

      expect(subsGained(event, GOALS)).toBe(0);
    });
  });
});
