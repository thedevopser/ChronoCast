import type { DomainEventType } from '../shared/protocol.js';

export interface Toast {
  readonly id: string;
  readonly userName: string;
  readonly rewardSeconds: number;
  readonly type: DomainEventType;

  readonly label?: string;
}

export interface ToastQueueOptions {
  readonly maxPending?: number;
}

export interface ToastQueue {
  push(toast: Toast, nowMs: number, durationMs: number): void;
  current(nowMs: number): Toast | null;
  pendingCount(): number;
  clear(): void;
}

const DEFAULT_MAX_PENDING = 20;

interface Scheduled {
  readonly toast: Toast;
  readonly durationMs: number;
}

export function createToastQueue(options: ToastQueueOptions = {}): ToastQueue {
  const maxPending = options.maxPending ?? DEFAULT_MAX_PENDING;

  let visible: { toast: Toast; expiresAtMs: number } | null = null;
  const pending: Scheduled[] = [];

  return {
    push(toast: Toast, nowMs: number, durationMs: number): void {
      if (visible === null) {
        visible = { toast, expiresAtMs: nowMs + durationMs };
        return;
      }

      pending.push({ toast, durationMs });

      while (pending.length > maxPending) {
        pending.shift();
      }
    },

    current(nowMs: number): Toast | null {
      while (visible !== null && nowMs >= visible.expiresAtMs) {
        const next = pending.shift();
        visible =
          next === undefined
            ? null
            : // La durée court à partir de l'affichage réel, et non de la mise
              { toast: next.toast, expiresAtMs: nowMs + next.durationMs };
      }

      return visible?.toast ?? null;
    },

    pendingCount(): number {
      return pending.length;
    },

    clear(): void {
      visible = null;
      pending.length = 0;
    },
  };
}
