import { beforeEach, describe, expect, it } from 'vitest';

import type { Clock } from '../../../src/core/app/ports.js';
import {
  createHappyHourSchedule,
  parseScheduleState,
  type HappyHourSchedule,
} from '../../../src/core/happy-hour/happy-hour-schedule.js';
import { createLogger, type LogSink } from '../../../src/core/logging/logger.js';
import { InvalidWindowError, type WindowState } from '../../../src/core/schedule/one-shot-window.js';
import type { AtomicJsonStore } from '../../../src/core/storage/atomic-json-store.js';

const NOW = 1_800_000_000_000;
const MINUTE = 60_000;

const SILENT_SINK: LogSink = { name: 'silencieux', write: () => undefined };

function createFakeClock(): Clock & { advance(ms: number): void } {
  let epoch = NOW;
  return {
    now: () => epoch,
    monotonicMs: () => epoch - NOW,
    advance(ms: number): void {
      epoch += ms;
    },
  };
}

describe('plage ponctuelle du Happy Hour', () => {
  let clock: ReturnType<typeof createFakeClock>;
  let persisted: WindowState | null;
  let active: boolean;
  let toggles: boolean[];
  let published: (null | { startAt: number; endAt: number })[];
  let store: AtomicJsonStore<WindowState | null>;

  function build(): HappyHourSchedule {
    return createHappyHourSchedule({
      store,
      clock,
      isActive: () => active,
      setActive: (next) => {
        toggles.push(next);
        active = next;
        return Promise.resolve();
      },
      onChange: (window) => {
        published.push(window);
      },
      logger: createLogger({ level: 'error', sinks: [SILENT_SINK] }),
    });
  }

  async function started(): Promise<HappyHourSchedule> {
    const schedule = build();
    await schedule.start();
    return schedule;
  }

  async function tickAt(schedule: HappyHourSchedule, elapsedMs: number): Promise<void> {
    clock.advance(elapsedMs);
    schedule.tick();
    await schedule.settled();
  }

  beforeEach(() => {
    clock = createFakeClock();
    persisted = null;
    active = false;
    toggles = [];
    published = [];
    store = {
      filePath: '/mémoire/happy-hour-schedule.json',
      read: () => Promise.resolve(persisted),
      write: (value) => {
        persisted = value;
        return Promise.resolve();
      },
    };
  });

  const WINDOW = { startAt: NOW + 10 * MINUTE, endAt: NOW + 70 * MINUTE };

  describe('pose et annulation', () => {
    it('n’a aucune plage tant qu’on n’en pose pas', async () => {
      expect((await started()).get()).toBeNull();
    });

    it('retient, persiste et publie la plage posée', async () => {
      const schedule = await started();

      await schedule.set(WINDOW);

      expect(schedule.get()).toStrictEqual(WINDOW);
      expect(persisted).toStrictEqual({ window: WINDOW, started: false });
      expect(published).toStrictEqual([WINDOW]);
    });

    it('remplace la plage précédente', async () => {
      const schedule = await started();
      await schedule.set(WINDOW);
      const later = { startAt: NOW + 120 * MINUTE, endAt: NOW + 180 * MINUTE };

      await schedule.set(later);

      expect(schedule.get()).toStrictEqual(later);
      expect(persisted?.started).toBe(false);
    });

    it('refuse une plage invalide sans rien enregistrer', async () => {
      const schedule = await started();
      await schedule.set(WINDOW);

      await expect(schedule.set({ startAt: NOW + MINUTE, endAt: NOW + MINUTE })).rejects.toThrow(
        InvalidWindowError,
      );
      await expect(schedule.set({ startAt: NOW - 2 * MINUTE, endAt: NOW - MINUTE })).rejects.toThrow(
        InvalidWindowError,
      );

      expect(schedule.get()).toStrictEqual(WINDOW);
      expect(published).toStrictEqual([WINDOW]);
    });

    it('annule la plage, l’efface du disque et le publie', async () => {
      const schedule = await started();
      await schedule.set(WINDOW);

      await schedule.cancel();

      expect(schedule.get()).toBeNull();
      expect(persisted).toBeNull();
      expect(published).toStrictEqual([WINDOW, null]);
    });

    it('active aussitôt quand la plage posée a déjà commencé', async () => {
      const schedule = await started();

      await schedule.set({ startAt: NOW - MINUTE, endAt: NOW + MINUTE });

      expect(active).toBe(true);
      expect(persisted?.started).toBe(true);
    });
  });

  describe('déroulement', () => {
    it('ne bascule rien avant le début', async () => {
      const schedule = await started();
      await schedule.set(WINDOW);

      await tickAt(schedule, 9 * MINUTE);

      expect(toggles).toStrictEqual([]);
    });

    it('active le Happy Hour au début, puis le désactive à la fin et efface la plage', async () => {
      const schedule = await started();
      await schedule.set(WINDOW);

      await tickAt(schedule, 10 * MINUTE);
      expect(active).toBe(true);
      expect(schedule.get()).toStrictEqual(WINDOW);

      await tickAt(schedule, 60 * MINUTE);
      expect(active).toBe(false);
      expect(schedule.get()).toBeNull();
      expect(persisted).toBeNull();
      expect(published.at(-1)).toBeNull();
      expect(toggles).toStrictEqual([true, false]);
    });

    it('ne bascule qu’une fois par transition, quel que soit le nombre de ticks', async () => {
      const schedule = await started();
      await schedule.set(WINDOW);

      await tickAt(schedule, 10 * MINUTE);
      await tickAt(schedule, 250);
      await tickAt(schedule, 250);

      expect(toggles).toStrictEqual([true]);
    });

    it('respecte une extinction à la main pendant la plage, jusqu’à sa fin', async () => {
      const schedule = await started();
      await schedule.set(WINDOW);
      await tickAt(schedule, 10 * MINUTE);

      active = false;
      await tickAt(schedule, MINUTE);
      await tickAt(schedule, 59 * MINUTE);

      expect(active).toBe(false);
      expect(toggles).toStrictEqual([true]);
      expect(schedule.get()).toBeNull();
    });

    it('laisse allumé un Happy Hour déjà actif au début, et l’éteint à la fin', async () => {
      const schedule = await started();
      await schedule.set(WINDOW);
      active = true;

      await tickAt(schedule, 10 * MINUTE);
      expect(toggles).toStrictEqual([]);

      await tickAt(schedule, 60 * MINUTE);
      expect(toggles).toStrictEqual([false]);
    });

    it('ne change pas l’état courant quand on annule pendant la plage', async () => {
      const schedule = await started();
      await schedule.set(WINDOW);
      await tickAt(schedule, 10 * MINUTE);

      await schedule.cancel();
      await tickAt(schedule, 60 * MINUTE);

      expect(active).toBe(true);
      expect(toggles).toStrictEqual([true]);
    });

    it('ne fait rien sans plage', async () => {
      const schedule = await started();

      await tickAt(schedule, 60 * MINUTE);

      expect(toggles).toStrictEqual([]);
      expect(published).toStrictEqual([]);
    });
  });

  describe('redémarrage', () => {
    it('active le Happy Hour quand l’application est relancée pendant la plage', async () => {
      persisted = { window: WINDOW, started: false };
      clock.advance(30 * MINUTE);

      const schedule = await started();

      expect(active).toBe(true);
      expect(schedule.get()).toStrictEqual(WINDOW);
      expect(persisted).toStrictEqual({ window: WINDOW, started: true });
    });

    it('ne rallume pas ce qui a été éteint à la main avant la relance', async () => {
      persisted = { window: WINDOW, started: true };
      clock.advance(30 * MINUTE);

      await started();

      expect(toggles).toStrictEqual([]);
    });

    it('efface sans rien activer une plage terminée pendant que l’application était fermée', async () => {
      persisted = { window: WINDOW, started: false };
      clock.advance(120 * MINUTE);

      const schedule = await started();

      expect(toggles).toStrictEqual([]);
      expect(schedule.get()).toBeNull();
      expect(persisted).toBeNull();
    });

    it('éteint à la relance un Happy Hour que la plage avait allumé et dont la fin est passée', async () => {
      persisted = { window: WINDOW, started: true };
      active = true;
      clock.advance(120 * MINUTE);

      await started();

      expect(active).toBe(false);
      expect(persisted).toBeNull();
    });
  });
});

describe('parseScheduleState', () => {
  const VALID = { window: { startAt: 1, endAt: 2 }, started: true };

  it('relit un état bien formé', () => {
    expect(parseScheduleState(VALID)).toStrictEqual(VALID);
  });

  it.each([
    null,
    undefined,
    'texte',
    {},
    { window: { startAt: 2, endAt: 1 }, started: false },
    { window: { startAt: '1', endAt: 2 }, started: false },
    { window: { startAt: 1, endAt: 2 } },
  ])('tient un fichier de forme %o pour une absence de plage', (raw) => {
    expect(parseScheduleState(raw)).toBeNull();
  });
});
