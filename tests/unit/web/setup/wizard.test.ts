import { describe, expect, it } from 'vitest';

import {
  isStepReachable,
  resumeHint,
  resumeStep,
  SETUP_STEPS,
  type SetupState,
} from '../../../../src/web/setup/wizard.js';

const FRESH: SetupState = {
  clientId: '',
  hasClientSecret: false,
  connected: false,
  broadcasterLogin: '',
  missingScopes: [],
  completed: false,
};

const CREDENTIALS: SetupState = { ...FRESH, clientId: 'abc123', hasClientSecret: true };
const CONNECTED: SetupState = { ...CREDENTIALS, connected: true, broadcasterLogin: 'streameuse' };

describe('SETUP_STEPS', () => {
  it('décrit les six étapes, dans l’ordre', () => {
    expect(SETUP_STEPS).toStrictEqual([
      'intro',
      'credentials',
      'connect',
      'channel',
      'counter',
      'overlay',
    ]);
  });
});

describe('resumeStep', () => {
  it('accueille une installation neuve par l’explication', () => {
    expect(resumeStep(FRESH)).toBe('intro');
  });

  it('reprend à la saisie dès qu’une identifiant a été renseigné', () => {
    expect(resumeStep({ ...FRESH, clientId: 'abc123' })).toBe('credentials');
  });

  it('reprend à la saisie si le secret manque', () => {
    expect(resumeStep({ ...FRESH, hasClientSecret: true })).toBe('credentials');
  });

  it('propose la connexion une fois les deux identifiants en place', () => {
    expect(resumeStep(CREDENTIALS)).toBe('connect');
  });

  it('montre la chaîne détectée après la connexion', () => {
    expect(resumeStep(CONNECTED)).toBe('channel');
  });

  it('retient l’utilisateur sur la chaîne tant qu’une portée manque', () => {
    const state = { ...CONNECTED, missingScopes: ['channel:read:subscriptions'] };

    expect(resumeStep(state)).toBe('channel');
  });

  it('reprend sur la chaîne même lorsque toutes les portées sont accordées', () => {
    expect(resumeStep({ ...CONNECTED, missingScopes: [] })).toBe('channel');
  });

  it('conduit à l’URL d’overlay quand l’assistant a été mené à son terme', () => {
    expect(resumeStep({ ...CONNECTED, completed: true })).toBe('overlay');
  });

  it('ramène à la connexion si le jeton a été révoqué depuis Twitch', () => {
    const state = { ...CREDENTIALS, completed: true, connected: false };

    expect(resumeStep(state)).toBe('connect');
  });
});

describe('isStepReachable', () => {
  it('laisse toujours accéder à l’explication et à la saisie', () => {
    expect(isStepReachable('intro', FRESH)).toBe(true);
    expect(isStepReachable('credentials', FRESH)).toBe(true);
  });

  it('n’ouvre la connexion qu’une fois les deux identifiants saisis', () => {
    expect(isStepReachable('connect', FRESH)).toBe(false);
    expect(isStepReachable('connect', { ...FRESH, clientId: 'abc' })).toBe(false);
    expect(isStepReachable('connect', CREDENTIALS)).toBe(true);
  });

  it('n’ouvre les étapes suivantes qu’une fois connecté', () => {
    for (const step of ['channel', 'counter', 'overlay'] as const) {
      expect(isStepReachable(step, CREDENTIALS)).toBe(false);
      expect(isStepReachable(step, CONNECTED)).toBe(true);
    }
  });

  it('rend toujours atteignable l’étape où l’on reprend', () => {
    const states: SetupState[] = [
      FRESH,
      { ...FRESH, clientId: 'abc' },
      CREDENTIALS,
      CONNECTED,
      { ...CONNECTED, missingScopes: ['user:read:chat'] },
      { ...CONNECTED, completed: true },
      { ...CREDENTIALS, completed: true, connected: false },
    ];

    for (const state of states) {
      expect(isStepReachable(resumeStep(state), state)).toBe(true);
    }
  });

  describe('phrase de reprise', () => {
    it('n’annonce pas une reprise au tout premier lancement', () => {
      expect(resumeHint(FRESH)).not.toMatch(/reprise|arrêté/i);
    });

    it('annonce une reprise dès que quelque chose a été commencé', () => {
      expect(resumeHint(CREDENTIALS)).toMatch(/arrêté/i);
      expect(resumeHint({ ...FRESH, clientId: 'abc' })).toMatch(/arrêté/i);
    });

    it('annonce une configuration terminée quand elle l’est', () => {
      expect(resumeHint({ ...CONNECTED, completed: true })).toMatch(/terminée/i);
    });

    it('donne la priorité à l’achèvement sur la reprise', () => {
      expect(resumeHint({ ...CREDENTIALS, completed: true })).toMatch(/terminée/i);
    });
  });
});
