import type { CounterStatus } from './protocol.js';

export interface CountdownState {
  readonly remainingMs: number;
  readonly status: CounterStatus;
}

export type SyncMode = 'tick' | 'authoritative';

export interface Countdown {
  sync(state: CountdownState, nowMs: number, mode: SyncMode): void;
  remainingAt(nowMs: number): number;
  getStatus(): CounterStatus;
}

function isTicking(status: CounterStatus): boolean {
  return status === 'running';
}

export function createCountdown(): Countdown {
  let remainingMs = 0;
  let status: CounterStatus = 'idle';
  let syncedAtMs = 0;

  function remainingAt(nowMs: number): number {
    if (!isTicking(status)) {
      return remainingMs;
    }
    return Math.max(0, remainingMs - (nowMs - syncedAtMs));
  }

  return {
    sync(state: CountdownState, nowMs: number, mode: SyncMode): void {
      const displayed = remainingAt(nowMs);

      remainingMs =
        mode === 'tick'
          ? // Le serveur fait autorité à la baisse uniquement : il corrige une
            Math.min(displayed, state.remainingMs)
          : state.remainingMs;

      status = state.status;

      syncedAtMs = nowMs;
    },

    remainingAt,

    getStatus(): CounterStatus {
      return status;
    },
  };
}
