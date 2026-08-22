/**
 * File d'affichage à un seul emplacement : ce qui arrive pendant qu'un élément est visible attend
 * son tour plutôt que de l'écraser.
 *
 * Générique sur l'élément affiché : l'overlay du compteur y met des bulles d'événement, la page
 * `/goal` des paliers franchis — un don groupé peut en traverser plusieurs d'un coup.
 */
export interface Identified {
  readonly id: string;
}

export interface ToastQueueOptions {
  readonly maxPending?: number;
}

export interface ToastQueue<T extends Identified> {
  push(toast: T, nowMs: number, durationMs: number): void;
  current(nowMs: number): T | null;
  pendingCount(): number;
  clear(): void;
}

const DEFAULT_MAX_PENDING = 20;

interface Scheduled<T> {
  readonly toast: T;
  readonly durationMs: number;
}

export function createToastQueue<T extends Identified>(
  options: ToastQueueOptions = {},
): ToastQueue<T> {
  const maxPending = options.maxPending ?? DEFAULT_MAX_PENDING;

  let visible: { toast: T; expiresAtMs: number } | null = null;
  const pending: Scheduled<T>[] = [];

  return {
    push(toast: T, nowMs: number, durationMs: number): void {
      if (visible === null) {
        visible = { toast, expiresAtMs: nowMs + durationMs };
        return;
      }

      pending.push({ toast, durationMs });

      while (pending.length > maxPending) {
        pending.shift();
      }
    },

    current(nowMs: number): T | null {
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
