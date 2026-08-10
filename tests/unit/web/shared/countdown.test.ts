import { describe, expect, it } from 'vitest';

import { createCountdown } from '../../../../src/web/shared/countdown.js';
import type { CounterStatus } from '../../../../src/web/shared/protocol.js';

function state(remainingMs: number, status: CounterStatus = 'running') {
  return { remainingMs, status };
}

describe('createCountdown', () => {
  describe('avant toute synchronisation', () => {
    it('part de zéro, à l’arrêt', () => {
      const countdown = createCountdown();

      expect(countdown.remainingAt(0)).toBe(0);
      expect(countdown.getStatus()).toBe('idle');
    });
  });

  describe('interpolation', () => {
    it('décompte le temps écoulé depuis la dernière synchronisation', () => {
      const countdown = createCountdown();
      countdown.sync(state(60_000), 1_000, 'authoritative');

      expect(countdown.remainingAt(1_250)).toBe(59_750);
      expect(countdown.remainingAt(1_999)).toBe(59_001);
    });

    it('rend la valeur reçue à l’instant même de la synchronisation', () => {
      const countdown = createCountdown();
      countdown.sync(state(60_000), 1_000, 'authoritative');

      expect(countdown.remainingAt(1_000)).toBe(60_000);
    });

    it('ne descend jamais sous zéro', () => {
      const countdown = createCountdown();
      countdown.sync(state(500), 1_000, 'authoritative');

      expect(countdown.remainingAt(9_000)).toBe(0);
    });
  });

  describe('états figés', () => {
    it('ne décompte pas quand le compteur est en pause', () => {
      const countdown = createCountdown();
      countdown.sync(state(60_000, 'paused'), 1_000, 'authoritative');

      expect(countdown.remainingAt(31_000)).toBe(60_000);
    });

    it('ne décompte pas quand le compteur n’a jamais démarré', () => {
      const countdown = createCountdown();
      countdown.sync(state(43_200_000, 'idle'), 1_000, 'authoritative');

      expect(countdown.remainingAt(31_000)).toBe(43_200_000);
    });

    it('ne décompte pas quand le subathon est achevé', () => {
      const countdown = createCountdown();
      countdown.sync(state(0, 'finished'), 1_000, 'authoritative');

      expect(countdown.remainingAt(31_000)).toBe(0);
    });

    it('reprend le décompte après une reprise', () => {
      const countdown = createCountdown();
      countdown.sync(state(60_000, 'paused'), 1_000, 'authoritative');

      countdown.sync(state(60_000, 'running'), 10_000, 'authoritative');

      expect(countdown.remainingAt(11_000)).toBe(59_000);
    });
  });

  describe('resynchronisation de routine', () => {
    it('accepte une valeur plus basse que celle affichée', () => {
      const countdown = createCountdown();
      countdown.sync(state(60_000), 1_000, 'authoritative');

      countdown.sync(state(58_500), 2_000, 'tick');

      expect(countdown.remainingAt(2_000)).toBe(58_500);
    });

    it('ignore une valeur plus haute que celle affichée', () => {
      const countdown = createCountdown();
      countdown.sync(state(60_000), 1_000, 'authoritative');

      countdown.sync(state(59_200), 2_000, 'tick');

      expect(countdown.remainingAt(2_000)).toBe(59_000);
    });

    it('repart de la valeur retenue et non de celle reçue', () => {
      const countdown = createCountdown();
      countdown.sync(state(60_000), 1_000, 'authoritative');
      countdown.sync(state(59_200), 2_000, 'tick');

      expect(countdown.remainingAt(3_000)).toBe(58_000);
    });
  });

  describe('resynchronisation autoritaire', () => {
    it('accepte un crédit de temps immédiatement', () => {
      const countdown = createCountdown();
      countdown.sync(state(60_000), 1_000, 'authoritative');

      countdown.sync(state(90_000), 2_000, 'authoritative');

      expect(countdown.remainingAt(2_000)).toBe(90_000);
    });

    it('accepte une valeur plus haute au retour d’une coupure', () => {
      const countdown = createCountdown();
      countdown.sync(state(60_000), 1_000, 'authoritative');

      const duringOutage = countdown.remainingAt(301_000);
      countdown.sync(state(59_000), 301_000, 'authoritative');

      expect(duringOutage).toBe(0);
      expect(countdown.remainingAt(301_000)).toBe(59_000);
    });

    it('accepte un retrait manuel', () => {
      const countdown = createCountdown();
      countdown.sync(state(60_000), 1_000, 'authoritative');

      countdown.sync(state(30_000), 2_000, 'authoritative');

      expect(countdown.remainingAt(2_000)).toBe(30_000);
    });
  });

  describe('statut', () => {
    it('expose le dernier statut reçu', () => {
      const countdown = createCountdown();

      countdown.sync(state(60_000, 'running'), 1_000, 'authoritative');
      expect(countdown.getStatus()).toBe('running');

      countdown.sync(state(60_000, 'paused'), 2_000, 'authoritative');
      expect(countdown.getStatus()).toBe('paused');
    });

    it('met à jour le statut même quand la valeur de routine est ignorée', () => {
      const countdown = createCountdown();
      countdown.sync(state(60_000), 1_000, 'authoritative');

      countdown.sync(state(59_500, 'finished'), 2_000, 'tick');

      expect(countdown.getStatus()).toBe('finished');
    });
  });
});
