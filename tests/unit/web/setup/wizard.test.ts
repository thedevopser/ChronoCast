/**
 * Progression de l'assistant de première configuration.
 *
 * L'exigence est « reprise possible à l'étape interrompue ». La façon évidente
 * de la satisfaire — enregistrer un numéro d'étape — est aussi la mauvaise :
 * ce numéro se désynchronise du réel à la première anomalie. Un streamer qui
 * révoque son jeton depuis Twitch, qui restaure une ancienne configuration, ou
 * qui ferme l'assistant en plein flux OAuth se retrouverait renvoyé à une étape
 * qui ne correspond plus à rien.
 *
 * L'étape est donc **dérivée de l'état réel** : a-t-on un client ID, un secret
 * enregistré, un jeton valide, les portées nécessaires ? Une seule chose est
 * persistée, `setup.completed`, parce qu'elle ne se déduit de rien — la valeur
 * de départ du compteur a toujours une valeur par défaut, on ne peut pas
 * distinguer « laissée telle quelle » de « jamais vue ».
 *
 * Deux fonctions, deux usages distincts : `resumeStep` répond « où reprendre »,
 * `isStepReachable` répond « cette étape a-t-elle un sens maintenant » et sert à
 * griser la navigation. Les confondre laisserait l'utilisateur ouvrir l'étape
 * « chaîne détectée » avant même d'être connecté.
 */

import { describe, expect, it } from 'vitest';

import {
  isStepReachable,
  resumeHint,
  resumeStep,
  SETUP_STEPS,
  type SetupState,
} from '../../../../src/web/setup/wizard.js';

/** Installation neuve : rien n'a jamais été saisi. */
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
    // Le premier écran explique où créer une application Twitch et quelle
    // redirect URI y coller : sauter cette étape rendrait la suivante absurde.
    expect(resumeStep(FRESH)).toBe('intro');
  });

  it('reprend à la saisie dès qu’une identifiant a été renseigné', () => {
    // L'utilisateur a commencé : le renvoyer à l'explication lui ferait relire
    // ce qu'il vient de faire.
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
    // Une portée absente se corrige en refaisant le flux d'autorisation :
    // passer à la suite laisserait le streamer découvrir en direct que ses
    // abonnements Prime ne créditent rien.
    const state = { ...CONNECTED, missingScopes: ['channel:read:subscriptions'] };

    expect(resumeStep(state)).toBe('channel');
  });

  it('reprend sur la chaîne même lorsque toutes les portées sont accordées', () => {
    // La reprise s'arrête à l'écran qui **confirme** que la connexion a abouti
    // et sur quelle chaîne. Le barème se rejoint en avançant, pas en reprenant :
    // c'est un écran de saisie, et y déposer quelqu'un sans lui montrer d'abord
    // que Twitch est branché laisserait le doute sur l'étape précédente.
    expect(resumeStep({ ...CONNECTED, missingScopes: [] })).toBe('channel');
  });

  it('conduit à l’URL d’overlay quand l’assistant a été mené à son terme', () => {
    // C'est l'écran utile à quiconque revient : l'adresse à coller dans OBS.
    expect(resumeStep({ ...CONNECTED, completed: true })).toBe('overlay');
  });

  it('ramène à la connexion si le jeton a été révoqué depuis Twitch', () => {
    // Le cas que rendrait impossible un simple numéro d'étape enregistré :
    // l'assistant est « terminé », mais il n'y a plus de jeton.
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
    // Afficher « chaîne détectée » sans jeton n'aurait rien à montrer, et le
    // barème comme l'URL d'overlay n'ont d'intérêt qu'une fois Twitch branché.
    for (const step of ['channel', 'counter', 'overlay'] as const) {
      expect(isStepReachable(step, CREDENTIALS)).toBe(false);
      expect(isStepReachable(step, CONNECTED)).toBe(true);
    }
  });

  it('rend toujours atteignable l’étape où l’on reprend', () => {
    // Invariant : `resumeStep` ne doit jamais désigner une étape que la
    // navigation refuserait d'ouvrir.
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
      // « Reprise là où vous vous étiez arrêté », affiché à l'étape 1 d'une
      // installation neuve, est faux — et c'est la première phrase que lit un
      // nouvel utilisateur.
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
      // Une configuration terminée dont le jeton a été révoqué depuis Twitch
      // reprend à `connect` : la phrase doit dire qu'elle est faite, pas
      // laisser croire qu'elle n'a jamais été menée à son terme.
      expect(resumeHint({ ...CREDENTIALS, completed: true })).toMatch(/terminée/i);
    });
  });
});
