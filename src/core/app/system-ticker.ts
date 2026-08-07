import type { Ticker } from '../counter/counter-service.js';

export interface SystemTicker extends Ticker {
  isReferenced(): boolean;
}

export function createSystemTicker(): SystemTicker {
  let timer: ReturnType<typeof setInterval> | null = null;

  function stop(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  return {
    start(intervalMs: number, onTick: () => void): void {
      stop();

      const handle = setInterval(onTick, intervalMs);
      handle.unref();
      timer = handle;
    },

    stop,

    isReferenced(): boolean {
      return timer?.hasRef() ?? false;
    },
  };
}
