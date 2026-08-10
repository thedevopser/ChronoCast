export const SETUP_STEPS = [
  'intro',
  'credentials',
  'connect',
  'channel',
  'counter',
  'overlay',
] as const;

export type SetupStepId = (typeof SETUP_STEPS)[number];

export interface SetupState {
  readonly clientId: string;
  readonly hasClientSecret: boolean;
  readonly connected: boolean;
  readonly broadcasterLogin: string;
  readonly missingScopes: readonly string[];
  readonly completed: boolean;
}

function hasCredentials(state: SetupState): boolean {
  return state.clientId !== '' && state.hasClientSecret;
}

export function resumeStep(state: SetupState): SetupStepId {
  if (!hasCredentials(state)) {
    return state.clientId === '' && !state.hasClientSecret ? 'intro' : 'credentials';
  }

  if (!state.connected) {
    return 'connect';
  }

  if (state.completed) {
    return 'overlay';
  }

  return 'channel';
}

export function isStepReachable(step: SetupStepId, state: SetupState): boolean {
  switch (step) {
    case 'intro':
    case 'credentials':
      return true;
    case 'connect':
      return hasCredentials(state);
    case 'channel':
    case 'counter':
    case 'overlay':
      return state.connected;
  }
}

export function resumeHint(state: SetupState): string {
  if (state.completed) {
    return 'Configuration terminée. Vous pouvez la reprendre à tout moment.';
  }

  if (state.clientId === '' && !state.hasClientSecret) {
    return 'Six étapes, et quelques minutes.';
  }

  return 'Reprise là où vous vous étiez arrêté.';
}
