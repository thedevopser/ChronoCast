import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSystemClock } from '../../../src/core/app/system-clock.js';
import { createSystemTicker } from '../../../src/core/app/system-ticker.js';

/**
 * Deux horloges, et c'est tout l'enjeu.
 *
 * `now()` sert aux horodatages : elle peut reculer, au passage à l'heure d'hiver
 * comme après une synchronisation NTP. `monotonicMs()` sert à mesurer des durées
 * et ne recule jamais.
 *
 * Confondre les deux offrirait une heure de subathon chaque dernier dimanche
 * d'octobre. C'est pour cela que le décompte ne s'appuie que sur la seconde, et
 * que ce fichier existe.
 */

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
    // Un recul brutal de l'heure système ne doit pas faire reculer le temps
    // monotone : c'est exactement le scénario du changement d'heure.
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
    // Redémarrer le compteur après un changement de période ne doit pas laisser
    // l'ancien cadenceur battre en parallèle : le décompte irait deux fois trop vite.
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
    // Sans `unref`, le processus refuserait de se terminer tant que le cadenceur
    // bat — c'est-à-dire toujours.
    const ticker = createSystemTicker();
    ticker.start(1_000, () => undefined);

    expect(ticker.isReferenced()).toBe(false);

    ticker.stop();
  });
});
