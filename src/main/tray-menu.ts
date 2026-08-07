import type { CounterStatus } from '../core/counter/counter-state.js';

export type TrayCommandId = 'show' | 'copy-overlay-url' | 'quit';

export type TrayMenuItem =
  | { readonly kind: 'status'; readonly label: string }
  | { readonly kind: 'separator' }
  | { readonly kind: 'command'; readonly id: TrayCommandId; readonly label: string; readonly enabled: boolean };

export interface TrayMenuState {
  readonly status: CounterStatus;
  readonly remainingMs: number;
  readonly overlayUrl: string | null;
}

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatTrayDuration(remainingMs: number): string {
  const total = Number.isFinite(remainingMs) ? Math.max(0, Math.floor(remainingMs)) : 0;

  const hours = Math.floor(total / HOUR);
  const minutes = Math.floor((total % HOUR) / MINUTE);
  const seconds = Math.floor((total % MINUTE) / SECOND);

  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function statusLabel(state: TrayMenuState): string {
  const duration = formatTrayDuration(state.remainingMs);

  switch (state.status) {
    case 'finished':
      return 'Terminé';
    case 'paused':
      return `En pause — ${duration}`;
    case 'idle':
      return `En attente — ${duration}`;
    case 'running':
      return `${duration} restantes`;
  }
}

export function buildTrayMenu(state: TrayMenuState): readonly TrayMenuItem[] {
  return [
    { kind: 'status', label: statusLabel(state) },
    { kind: 'separator' },
    { kind: 'command', id: 'show', label: 'Ouvrir ChronoCast', enabled: true },
    {
      kind: 'command',
      id: 'copy-overlay-url',
      label: 'Copier l’URL de l’overlay',
      enabled: state.overlayUrl !== null,
    },

    { kind: 'separator' },
    { kind: 'command', id: 'quit', label: 'Quitter ChronoCast', enabled: true },
  ];
}
