import type { Clock } from './ports.js';

export function createSystemClock(): Clock {
  return {
    now(): number {
      return Date.now();
    },

    monotonicMs(): number {
      return performance.now();
    },
  };
}
