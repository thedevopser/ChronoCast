import { beforeEach, describe, expect, it } from 'vitest';

import type { AppEvents } from '../../../src/core/app/app-events.js';
import { createEventBus, type EventBus } from '../../../src/core/app/event-bus.js';
import type { Clock } from '../../../src/core/app/ports.js';
import { configSchema, type ChronoCastConfig } from '../../../src/core/config/schema.js';
import type { BitsEvent, CommandEvent, GiftEvent, SubEvent } from '../../../src/core/events/domain-event.js';
import { createGoalService, type GoalService, type GoalState } from '../../../src/core/goals/goal-service.js';
import { createLogger, type LogSink } from '../../../src/core/logging/logger.js';
import type { AtomicJsonStore } from '../../../src/core/storage/atomic-json-store.js';

const START_EPOCH = 1_754_000_000_000;

const LADDER = [
  { target: 5, label: 'Je me rase la tête' },
  { target: 10, label: 'Karaoké' },
  { target: 50, label: 'Marathon 24 h' },
];

function createFakeClock(): Clock & { advance(ms: number): void } {
  let epoch = START_EPOCH;
  let monotonic = 0;

  return {
    now: () => epoch,
    monotonicMs: () => monotonic,
    advance(ms: number): void {
      epoch += ms;
      monotonic += ms;
    },
  };
}

function createStoreDouble(initial?: GoalState) {
  let persisted: GoalState | undefined = initial;
  const writes: GoalState[] = [];

  const store: AtomicJsonStore<GoalState | null> = {
    filePath: '/mémoire/goals.json',
    read: () => Promise.resolve(persisted ?? null),
    write: (value: GoalState | null) => {
      if (value !== null) {
        persisted = value;
        writes.push(value);
      }
      return Promise.resolve();
    },
  };

  return {
    store,
    get writes(): readonly GoalState[] {
      return writes;
    },
    get persisted(): GoalState | undefined {
      return persisted;
    },
  };
}

const SILENT: LogSink = { name: 'silence', write: () => undefined };

function baseEvent(id = 'msg-1') {
  return {
    id,
    occurredAt: START_EPOCH,
    userId: '12345',
    userName: 'Spectateur',
    source: 'eventsub',
  } as const;
}

function subEvent(id = 'msg-1'): SubEvent {
  return { ...baseEvent(id), type: 'sub', tier: 'tier1' };
}

function giftEvent(total: number, id = 'msg-gift'): GiftEvent {
  return { ...baseEvent(id), type: 'gift', tier: 'tier1', total, isAnonymous: false };
}

interface Harness {
  readonly service: GoalService;
  readonly clock: Clock & { advance(ms: number): void };
  readonly bus: EventBus<AppEvents>;
  readonly changes: AppEvents['goals:changed'][];
  readonly store: ReturnType<typeof createStoreDouble>;
}

function createHarness(options: { tiers?: unknown; bitsPerSub?: number; initial?: GoalState } = {}): Harness {
  const config: ChronoCastConfig = configSchema.parse({
    goals: {
      tiers: options.tiers ?? LADDER,
      ...(options.bitsPerSub === undefined ? {} : { bitsPerSub: options.bitsPerSub }),
    },
  });

  const clock = createFakeClock();
  const bus = createEventBus<AppEvents>({ onHandlerError: () => undefined });
  const changes: AppEvents['goals:changed'][] = [];
  bus.on('goals:changed', (payload) => changes.push(payload));

  const store = createStoreDouble(options.initial);

  const service = createGoalService({
    store: store.store,
    getConfig: () => config,
    clock,
    bus,
    logger: createLogger({ level: 'debug', sinks: [SILENT] }),
  });

  return { service, clock, bus, changes, store };
}

describe('createGoalService', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createHarness();
  });

  describe('démarrage', () => {
    it('part de zéro abonnement quand rien n’est persisté', async () => {
      await harness.service.start();

      expect(harness.service.getState().subs).toBe(0);
      expect(harness.service.getState().reached).toEqual([]);
    });

    it('restaure la progression persistée', async () => {
      const restored = createHarness({
        initial: {
          subs: 12,
          reached: [{ target: 5, reachedAt: START_EPOCH }],
          updatedAt: START_EPOCH,
          schemaVersion: 1,
        },
      });

      await restored.service.start();

      expect(restored.service.getState().subs).toBe(12);
    });

    it('refuse de servir un état avant le démarrage', () => {
      expect(() => harness.service.getState()).toThrow();
    });
  });

  describe('comptage', () => {
    beforeEach(async () => {
      await harness.service.start();
    });

    it('avance d’un abonnement sur un sub', async () => {
      await harness.service.applyEvent(subEvent());

      expect(harness.service.getState().subs).toBe(1);
    });

    it('avance d’autant que le don groupé en porte', async () => {
      await harness.service.applyEvent(giftEvent(10));

      expect(harness.service.getState().subs).toBe(10);
    });

    it('n’avance pas sur une commande de chat', async () => {
      const command: CommandEvent = {
        ...baseEvent(),
        type: 'command',
        command: 'addtime',
        seconds: 300,
      };

      await harness.service.applyEvent(command);

      expect(harness.service.getState().subs).toBe(0);
    });

    it('ne persiste rien quand l’événement ne compte pour rien', async () => {
      const before = harness.store.writes.length;
      const bits: BitsEvent = { ...baseEvent(), type: 'bits', bits: 10 };

      await harness.service.applyEvent(bits);

      expect(harness.store.writes.length).toBe(before);
      expect(harness.changes).toEqual([]);
    });

    it('persiste la progression à chaque avancée', async () => {
      await harness.service.applyEvent(subEvent());

      expect(harness.store.persisted?.subs).toBe(1);
    });
  });

  describe('franchissements', () => {
    beforeEach(async () => {
      await harness.service.start();
    });

    it('date le palier franchi sur l’horloge murale', async () => {
      harness.clock.advance(60_000);
      await harness.service.applyEvent(giftEvent(5));

      expect(harness.service.getState().reached).toEqual([
        { target: 5, reachedAt: START_EPOCH + 60_000 },
      ]);
    });

    it('rend tous les paliers qu’un don groupé traverse', async () => {
      const outcome = await harness.service.applyEvent(giftEvent(60));

      expect(outcome.crossed.map((tier) => tier.target)).toEqual([5, 10, 50]);
      expect(harness.service.getState().reached).toHaveLength(3);
    });

    it('ne rejoue pas un palier déjà franchi', async () => {
      await harness.service.applyEvent(giftEvent(6, 'msg-a'));
      const outcome = await harness.service.applyEvent(subEvent('msg-b'));

      expect(outcome.crossed).toEqual([]);
      expect(harness.service.getState().reached).toHaveLength(1);
    });

    it('annonce le franchissement sur le bus', async () => {
      await harness.service.applyEvent(giftEvent(5));

      expect(harness.changes).toHaveLength(1);
      expect(harness.changes[0]?.crossed.map((tier) => tier.label)).toEqual([
        'Je me rase la tête',
      ]);
    });
  });

  describe('instantané', () => {
    it('dérive la position de l’échelle courante, jamais de l’état persisté', async () => {
      await harness.service.start();
      await harness.service.applyEvent(giftEvent(7));

      const snapshot = harness.service.getSnapshot();

      expect(snapshot.subs).toBe(7);
      expect(snapshot.position.label).toBe('Karaoké');
      expect(snapshot.position.from).toBe(5);
      expect(snapshot.position.to).toBe(10);
    });

    it('reste plein sur le libellé final au-delà du dernier palier', async () => {
      await harness.service.start();
      await harness.service.applyEvent(giftEvent(80));

      expect(harness.service.getSnapshot().position.complete).toBe(true);
    });

    it('compte sans se plaindre quand aucun palier n’est configuré', async () => {
      const bare = createHarness({ tiers: [] });
      await bare.service.start();
      await bare.service.applyEvent(subEvent());

      expect(bare.service.getSnapshot().subs).toBe(1);
      expect(bare.service.getSnapshot().position.index).toBe(-1);
    });

    it('normalise une échelle saisie en désordre', async () => {
      const messy = createHarness({
        tiers: [
          { target: 10, label: 'Karaoké' },
          { target: 5, label: 'Je me rase la tête' },
        ],
      });
      await messy.service.start();

      expect(messy.service.getSnapshot().position.label).toBe('Je me rase la tête');
    });
  });

  describe('écriture du compte', () => {
    beforeEach(async () => {
      await harness.service.start();
    });

    it('remplace le compte plutôt que de s’y ajouter', async () => {
      await harness.service.applyEvent(giftEvent(3));

      await harness.service.setSubs(80);

      expect(harness.service.getState().subs).toBe(80);
    });

    it('persiste le compte écrit', async () => {
      await harness.service.setSubs(80);

      expect(harness.store.persisted?.subs).toBe(80);
    });

    it('n’annonce aucun palier, même en dépassant l’échelle entière', async () => {
      const before = harness.changes.length;

      await harness.service.setSubs(80);

      expect(harness.changes.length).toBe(before + 1);
      expect(harness.changes.at(-1)?.crossed).toEqual([]);
      expect(harness.service.getState().reached).toEqual([]);
    });

    it('laisse les paliers suivants s’annoncer normalement', async () => {
      await harness.service.setSubs(9);

      const outcome = await harness.service.applyEvent(subEvent());

      expect(outcome.crossed.map((tier) => tier.target)).toEqual([10]);
    });

    it('élague les franchissements que la nouvelle valeur laisse derrière elle', async () => {
      await harness.service.applyEvent(giftEvent(20));
      expect(harness.service.getState().reached).toHaveLength(2);

      await harness.service.setSubs(7);

      expect(harness.service.getState().reached).toEqual([
        { target: 5, reachedAt: START_EPOCH },
      ]);
    });

    it('accepte zéro comme n’importe quelle autre valeur', async () => {
      await harness.service.applyEvent(giftEvent(20));

      await harness.service.setSubs(0);

      expect(harness.service.getState().subs).toBe(0);
      expect(harness.service.getState().reached).toEqual([]);
    });

    it('date l’écriture sur l’horloge murale', async () => {
      harness.clock.advance(60_000);

      await harness.service.setSubs(4);

      expect(harness.service.getState().updatedAt).toBe(START_EPOCH + 60_000);
    });

    it('refuse d’écrire avant le démarrage', async () => {
      const cold = createHarness();

      await expect(cold.service.setSubs(4)).rejects.toThrow();
    });
  });

  describe('remise à zéro', () => {
    beforeEach(async () => {
      await harness.service.start();
    });

    it('efface le compte et les paliers franchis', async () => {
      await harness.service.applyEvent(giftEvent(20));

      await harness.service.reset();

      expect(harness.service.getState().subs).toBe(0);
      expect(harness.service.getState().reached).toEqual([]);
    });

    it('persiste la remise à zéro', async () => {
      await harness.service.applyEvent(giftEvent(20));
      await harness.service.reset();

      expect(harness.store.persisted?.subs).toBe(0);
    });

    it('annonce la remise à zéro sans annoncer de franchissement', async () => {
      await harness.service.applyEvent(giftEvent(20));
      const before = harness.changes.length;

      await harness.service.reset();

      expect(harness.changes.length).toBe(before + 1);
      expect(harness.changes.at(-1)?.crossed).toEqual([]);
    });
  });
});
