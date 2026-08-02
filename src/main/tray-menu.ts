/**
 * Modèle du menu de la zone de notification.
 *
 * Le tray est le **seul** chemin par lequel on quitte ChronoCast : fermer la
 * fenêtre replie l'application, cela n'arrête rien. Ce que ce menu propose, et
 * dans quel état il le propose, mérite donc d'être décidé dans un module pur
 * plutôt que dans `tray.ts`, où seule une exécution sur Windows le vérifierait.
 *
 * `tray.ts` se contente de passer ces descriptions à `Menu.buildFromTemplate`
 * et de brancher ses gestionnaires sur les identifiants.
 */

import type { CounterStatus } from '../core/counter/counter-state.js';

/** Actions offertes par le menu. Liste close : `tray.ts` les branche une à une. */
export type TrayCommandId = 'show' | 'copy-overlay-url' | 'quit';

export type TrayMenuItem =
  | { readonly kind: 'status'; readonly label: string }
  | { readonly kind: 'separator' }
  | { readonly kind: 'command'; readonly id: TrayCommandId; readonly label: string; readonly enabled: boolean };

export interface TrayMenuState {
  readonly status: CounterStatus;
  readonly remainingMs: number;
  /** URL de l'overlay, ou `null` tant que le serveur n'a pas annoncé son port. */
  readonly overlayUrl: string | null;
}

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/** Deux chiffres, sans dépendre d'une locale. */
function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Met en forme une durée en `HH:MM:SS`.
 *
 * Redite volontaire de `web/shared/time-format.ts` plutôt que partage : ce
 * module-là est compilé pour le navigateur, avec sa propre racine et ses
 * propres règles d'import, et l'y raccorder ferait entrer du code serveur dans
 * le paquet servi au client — ce que la Phase 5 a explicitement exclu.
 *
 * La règle qui compte est la même, et pour la même raison : **on tronque, on
 * n'arrondit jamais au supérieur**. Annoncer une seconde de plus que ce qui
 * reste ferait mentir le compteur dans le sens qui déçoit.
 *
 * Les heures s'accumulent au-delà de vingt-quatre : un subathon de plusieurs
 * jours est le cas nominal.
 */
export function formatTrayDuration(remainingMs: number): string {
  // `NaN` ne survit à aucune comparaison : le traiter d'abord évite un
  // `NaN:NaN:NaN` dans le menu, que personne ne saurait interpréter.
  const total = Number.isFinite(remainingMs) ? Math.max(0, Math.floor(remainingMs)) : 0;

  const hours = Math.floor(total / HOUR);
  const minutes = Math.floor((total % HOUR) / MINUTE);
  const seconds = Math.floor((total % MINUTE) / SECOND);

  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/** Libellé de l'entrée d'état, en tête de menu. */
function statusLabel(state: TrayMenuState): string {
  const duration = formatTrayDuration(state.remainingMs);

  switch (state.status) {
    case 'finished':
      // Sans durée : elle vaut zéro, et « 00:00:00 » se lit comme une panne
      // d'affichage plutôt que comme une fin.
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
      // Rien à copier tant que le serveur n'écoute pas : proposer l'entrée
      // remplirait le presse-papiers de vide, ce qui est plus déroutant qu'une
      // entrée grisée.
      enabled: state.overlayUrl !== null,
    },
    // Quitter arrête le subathon. Le séparateur l'éloigne d'un geste anodin,
    // pour qu'il ne devienne pas un clic malheureux.
    { kind: 'separator' },
    { kind: 'command', id: 'quit', label: 'Quitter ChronoCast', enabled: true },
  ];
}
