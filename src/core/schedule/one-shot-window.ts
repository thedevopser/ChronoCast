/**
 * Une plage ponctuelle : deux instants absolus, consommés une fois puis effacés.
 *
 * Le module ne sait pas ce que la plage pilote. Il compare un instant à deux horodatages : ni
 * fuseau, ni changement d'heure, ni plage traversant minuit n'existent à ce niveau.
 */
export interface OneShotWindow {
  readonly startAt: number;
  readonly endAt: number;
}

export interface WindowState {
  readonly window: OneShotWindow;

  // Persisté avec la plage : sans lui, ce qu'on aurait défait à la main pendant la plage serait
  // refait au tick suivant.
  readonly started: boolean;
}

export type WindowTransition = 'start' | 'end';

export interface WindowStep {
  readonly transitions: readonly WindowTransition[];

  /** L'état à conserver, ou `null` quand la plage est consommée. */
  readonly next: WindowState | null;
}

export class InvalidWindowError extends Error {
  public override readonly name = 'InvalidWindowError';
}

function isTimestamp(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function assertSchedulable(window: OneShotWindow, now: number): void {
  if (!isTimestamp(window.startAt) || !isTimestamp(window.endAt)) {
    throw new InvalidWindowError('le début et la fin doivent être des horodatages entiers');
  }
  if (window.endAt <= window.startAt) {
    throw new InvalidWindowError('la fin doit être strictement après le début');
  }
  if (window.endAt <= now) {
    throw new InvalidWindowError('la fin doit être dans le futur');
  }
}

export function stepWindow(state: WindowState, now: number): WindowStep {
  if (now >= state.window.endAt) {
    // Une plage dont le début n'a jamais été consommé a été manquée en entier : rien n'est dû.
    return { transitions: state.started ? ['end'] : [], next: null };
  }

  if (now >= state.window.startAt && !state.started) {
    return { transitions: ['start'], next: { ...state, started: true } };
  }

  return { transitions: [], next: state };
}
