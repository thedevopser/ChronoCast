import { describe, expect, it } from 'vitest';

import { prepareRawConfig } from '../../../src/core/config/config-migration.js';
import { withDerivedHappyHourRewards } from '../../../src/core/config/happy-hour-rewards.js';
import { configSchema } from '../../../src/core/config/schema.js';

function bitsOf(raw: unknown, path: 'bits' | 'happyHourBits' = 'bits'): unknown {
  const prepared = prepareRawConfig(raw).raw as {
    rewards?: { bits?: unknown; happyHourRewards?: { bits?: unknown } };
  };
  return path === 'bits' ? prepared.rewards?.bits : prepared.rewards?.happyHourRewards?.bits;
}

const LINEAR = { mode: 'linear', linear: { unit: 50, secondsPerUnit: 30, minBits: 200 }, tiers: [] };

const TIERS = {
  mode: 'tiers',
  linear: { unit: 100, secondsPerUnit: 60, minBits: 1 },
  tiers: [
    { minBits: 500, seconds: 360 },
    { minBits: 100, seconds: 45 },
    { minBits: 1_000, seconds: 900 },
  ],
};

describe('prepareRawConfig — bits du barème de temps', () => {
  it('reprend l’unité et les secondes du mode proportionnel, et abandonne le seuil', () => {
    expect(bitsOf({ rewards: { bits: LINEAR } })).toStrictEqual({ unit: 50, seconds: 30 });
  });

  it('ne signale rien pour une configuration proportionnelle', () => {
    expect(prepareRawConfig({ rewards: { bits: LINEAR } }).notes).toStrictEqual([]);
  });

  it('convertit des paliers sur celui dont le seuil est le plus bas, quel que soit leur ordre', () => {
    expect(bitsOf({ rewards: { bits: TIERS } })).toStrictEqual({ unit: 100, seconds: 45 });
  });

  it('signale la conversion de paliers, avec le taux retenu', () => {
    expect(prepareRawConfig({ rewards: { bits: TIERS } }).notes).toStrictEqual([
      {
        message: 'paliers de bits convertis en taux unique',
        context: { path: 'rewards.bits', unit: 100, seconds: 45 },
      },
    ]);
  });

  it('convertit de même le barème Happy Hour, indépendamment du barème normal', () => {
    const raw = { rewards: { bits: LINEAR, happyHourRewards: { bits: TIERS, sub: { tier1: 9 } } } };

    expect(bitsOf(raw, 'happyHourBits')).toStrictEqual({ unit: 100, seconds: 45 });
    expect(prepareRawConfig(raw).notes.map((note) => note.context['path'])).toStrictEqual([
      'rewards.happyHourRewards.bits',
    ]);
    expect(
      (prepareRawConfig(raw).raw as { rewards: { happyHourRewards: { sub: unknown } } }).rewards
        .happyHourRewards.sub,
    ).toStrictEqual({ tier1: 9 });
  });

  it('retombe sur les valeurs proportionnelles quand le mode par paliers n’a aucun palier exploitable', () => {
    const broken = { ...TIERS, tiers: [{ minBits: 0, seconds: 10 }, { minBits: 'x', seconds: 1 }, null] };

    expect(bitsOf({ rewards: { bits: broken } })).toStrictEqual({ unit: 100, seconds: 60 });
  });

  it.each([
    ['unité nulle', { mode: 'linear', linear: { unit: 0, secondsPerUnit: 30 } }, { seconds: 30 }],
    ['unité décimale', { mode: 'linear', linear: { unit: 1.5, secondsPerUnit: 30 } }, { seconds: 30 }],
    ['secondes négatives', { mode: 'linear', linear: { unit: 50, secondsPerUnit: -1 } }, { unit: 50 }],
    ['secondes illisibles', { mode: 'linear', linear: { unit: 50, secondsPerUnit: 'x' } }, { unit: 50 }],
    ['sous-arbre proportionnel absent', { mode: 'linear' }, {}],
    ['mode inconnu', { mode: 'autre', linear: { unit: 50, secondsPerUnit: 30 } }, { unit: 50, seconds: 30 }],
  ])('écarte ce qui est invalide et laisse le schéma poser son défaut : %s', (_case, bits, expected) => {
    expect(bitsOf({ rewards: { bits } })).toStrictEqual(expected);
  });

  it('laisse intact un taux déjà écrit dans la nouvelle forme', () => {
    expect(bitsOf({ rewards: { bits: { unit: 7, seconds: 3 } } })).toStrictEqual({ unit: 7, seconds: 3 });
  });

  it('ne crée pas de barème de bits là où le fichier n’en porte pas', () => {
    expect(bitsOf({ rewards: { sub: { tier1: 1 } } })).toBeUndefined();
    expect(bitsOf({ rewards: { bits: LINEAR } }, 'happyHourBits')).toBeUndefined();
  });

  it.each([undefined, null, 'texte', 42, [], { rewards: 'texte' }, { rewards: { bits: 'texte' } }])(
    'ne lève jamais, quelle que soit la forme du fichier : %o',
    (raw) => {
      expect(() => prepareRawConfig(raw)).not.toThrow();
    },
  );

  it('garde le reste du fichier et ne modifie pas son argument', () => {
    const raw = { schemaVersion: 5, counter: { initialSeconds: 600 }, rewards: { bits: TIERS, sub: { tier1: 5 } } };
    const before = structuredClone(raw);

    const prepared = prepareRawConfig(raw).raw as typeof raw;

    expect(raw).toStrictEqual(before);
    expect(prepared.counter).toStrictEqual({ initialSeconds: 600 });
    expect(prepared.rewards.sub).toStrictEqual({ tier1: 5 });
  });
});

describe('une configuration 1.3.0 par paliers, de bout en bout', () => {
  it('dérive le barème Happy Hour du barème normal déjà converti, secondes doublées', () => {
    const prepared = prepareRawConfig({ schemaVersion: 5, rewards: { bits: TIERS } });
    const config = withDerivedHappyHourRewards(prepared.raw, configSchema.parse(prepared.raw));

    expect(config.rewards.bits).toStrictEqual({ unit: 100, seconds: 45 });
    expect(config.rewards.happyHourRewards.bits).toStrictEqual({ unit: 100, seconds: 90 });
  });
});

describe('prepareRawConfig — barre d’une configuration antérieure aux points', () => {
  const OLD_GOALS = {
    bitsPerSub: 500,
    tiers: [{ target: 50, label: 'Je me rase la tête' }],
    overlay: { fontSize: 40, bar: { width: 600 } },
  };

  function goalsOf(raw: unknown): unknown {
    return (prepareRawConfig(raw).raw as { goals?: unknown }).goals;
  }

  it.each([5, 6, 7, 8])('garde la barre d’une version %d, en mode subs et sous l’unité « abo. »', (schemaVersion) => {
    expect(goalsOf({ schemaVersion, goals: OLD_GOALS })).toStrictEqual({
      ...OLD_GOALS,
      mode: 'subs',
      unitLabel: 'abo.',
    });
  });

  it('donne, une fois passée par le schéma, une barre qui compte un par abonnement sur ses paliers', () => {
    const goals = configSchema.parse(prepareRawConfig({ schemaVersion: 5, goals: OLD_GOALS }).raw).goals;

    expect(goals.mode).toBe('subs');
    expect(goals.unitLabel).toBe('abo.');
    expect(goals.subWeights.sub.tier3).toBe(1);
    expect(goals.tiers).toStrictEqual([{ target: 50, label: 'Je me rase la tête' }]);
    expect(goals.overlay.fontSize).toBe(40);
  });

  it('garde une échelle vide vide : la barre d’une 1.3.0 sans palier ne s’allume pas toute seule', () => {
    const raw = prepareRawConfig({ schemaVersion: 5, goals: { tiers: [] } }).raw;

    expect(configSchema.parse(raw).goals.tiers).toStrictEqual([]);
  });

  it('n’allume pas non plus la barre d’une configuration ancienne qui ne dit rien de ses paliers', () => {
    const raw = prepareRawConfig({ schemaVersion: 5, rewards: {} }).raw;
    const goals = configSchema.parse(raw).goals;

    expect(goals.mode).toBe('subs');
    expect(goals.tiers).toStrictEqual([]);
  });

  it('signale que les bits ne font plus avancer cette barre', () => {
    const notes = prepareRawConfig({ schemaVersion: 5, goals: OLD_GOALS }).notes;

    expect(notes.map((note) => note.message)).toStrictEqual([
      'barre d’objectif conservée en mode subs : les bits ne la font plus avancer',
    ]);
  });

  it('laisse en mode points une configuration qui y est déjà', () => {
    const settled = { schemaVersion: 9, goals: { tiers: [], unitLabel: 'points' } };

    expect(goalsOf(settled)).toStrictEqual(settled.goals);
    expect(configSchema.parse(prepareRawConfig(settled).raw).goals.mode).toBe('points');
  });

  it.each([undefined, null, 'texte', {}, { goals: OLD_GOALS }, { schemaVersion: '5', goals: OLD_GOALS }])(
    'ne touche pas à la barre d’un fichier qui ne dit pas sa version : %o',
    (raw) => {
      expect(prepareRawConfig(raw).notes).toStrictEqual([]);
    },
  );

  it('ne lève pas sur un sous-arbre d’objectifs illisible', () => {
    expect(() => prepareRawConfig({ schemaVersion: 5, goals: 'texte' })).not.toThrow();
  });

  it('convertit les bits du barème de temps dans le même passage', () => {
    expect(bitsOf({ schemaVersion: 5, rewards: { bits: TIERS }, goals: OLD_GOALS })).toStrictEqual({
      unit: 100,
      seconds: 45,
    });
  });

  it('n’annonce plus de remise à zéro : rien n’est effacé', () => {
    expect(prepareRawConfig({ schemaVersion: 5, goals: OLD_GOALS })).not.toHaveProperty('goalsReset');
  });
});

describe('prepareRawConfig — bits par point abandonné', () => {
  const NOTE = 'bits par point abandonné : un bit vaut désormais un point';

  it('signale l’ancienne valeur quand elle n’était pas 1', () => {
    const prepared = prepareRawConfig({ schemaVersion: 9, goals: { bitsPerSub: 500 } });

    expect(prepared.notes).toContainEqual({ message: NOTE, context: { previous: 500 } });
  });

  it.each([{ bitsPerSub: 1 }, {}, { bitsPerSub: 'x' }])('ne signale rien pour %j', (goals) => {
    const messages = prepareRawConfig({ schemaVersion: 9, goals }).notes.map((note) => note.message);

    expect(messages).not.toContain(NOTE);
  });

  it('ne signale rien pour une configuration antérieure aux points, où ce réglage avait un autre sens', () => {
    const messages = prepareRawConfig({ schemaVersion: 5, goals: { bitsPerSub: 500 } }).notes.map(
      (note) => note.message,
    );

    expect(messages).not.toContain(NOTE);
  });
});

