import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSystemClock } from '../../../src/core/app/system-clock.js';
import { createSystemTicker } from '../../../src/core/app/system-ticker.js';

describe('createSystemClock', () => {
  const clock = createSystemClock();

  it('donne un instant plausible', () => {
    expect(Math.abs(clock.now() - Date.now())).toBeLessThan(1_000);
  });

  it('produit un temps monotone qui ne recule jamais', () => {
    let previous = clock.monotonicMs();

    for (let index = 0; index < 1_000; index += 1) {
      const current = clock.monotonicMs();
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });

  it("n'utilise pas l'horloge murale pour mesurer les durées", () => {
    const monotonicBefore = clock.monotonicMs();
    vi.spyOn(Date, 'now').mockReturnValue(0);

    expect(clock.monotonicMs()).toBeGreaterThanOrEqual(monotonicBefore);

    vi.restoreAllMocks();
  });
});

describe('createSystemTicker', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('appelle le gestionnaire à intervalle régulier', () => {
    vi.useFakeTimers();
    const ticker = createSystemTicker();
    const handler = vi.fn();

    ticker.start(250, handler);
    vi.advanceTimersByTime(1_000);
    ticker.stop();

    expect(handler).toHaveBeenCalledTimes(4);
  });

  it('cesse après un arrêt', () => {
    vi.useFakeTimers();
    const ticker = createSystemTicker();
    const handler = vi.fn();

    ticker.start(100, handler);
    vi.advanceTimersByTime(100);
    ticker.stop();
    vi.advanceTimersByTime(1_000);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('remplace le minuteur précédent plutôt que d’en cumuler un second', () => {
    vi.useFakeTimers();
    const ticker = createSystemTicker();
    const handler = vi.fn();

    ticker.start(100, handler);
    ticker.start(100, handler);
    vi.advanceTimersByTime(100);
    ticker.stop();

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('supporte un arrêt sans démarrage', () => {
    const ticker = createSystemTicker();
    expect(() => {
      ticker.stop();
    }).not.toThrow();
  });

  it('ne retient pas la boucle d’événements', () => {
    const ticker = createSystemTicker();
    ticker.start(1_000, () => undefined);

    expect(ticker.isReferenced()).toBe(false);

    ticker.stop();
  });
});
