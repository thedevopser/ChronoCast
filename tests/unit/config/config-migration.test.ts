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

describe('prepareRawConfig — remise à zéro du comptage de la barre', () => {
  const OLD_GOALS = {
    bitsPerSub: 500,
    points: { sub: { tier1: 1 } },
    unitLabel: 'abo.',
    tiers: [{ target: 50, label: 'Je me rase la tête' }],
    overlay: { fontSize: 40, bar: { width: 600 } },
  };

  function goalsOf(raw: unknown): unknown {
    return (prepareRawConfig(raw).raw as { goals?: unknown }).goals;
  }

  it.each([5, 6, 7, 8])('écarte le comptage d’une configuration en version %d et garde l’apparence', (schemaVersion) => {
    expect(goalsOf({ schemaVersion, goals: OLD_GOALS })).toStrictEqual({
      overlay: { fontSize: 40, bar: { width: 600 } },
    });
  });

  it('le signale, pour que l’appelant remette le compte à zéro et prévienne le streamer', () => {
    const prepared = prepareRawConfig({ schemaVersion: 5, goals: OLD_GOALS });

    expect(prepared.goalsReset).toBe(true);
    expect(prepared.notes.map((note) => note.message)).toContain(
      'comptage de la barre d’objectif remis aux valeurs de départ',
    );
  });

  it('remet aux valeurs de départ une fois passé par le schéma', () => {
    const prepared = prepareRawConfig({ schemaVersion: 5, goals: OLD_GOALS });
    const goals = configSchema.parse(prepared.raw).goals;

    expect(goals.points.sub.tier1).toBe(500);
    expect(goals.unitLabel).toBe('points');
    expect(goals.tiers).toStrictEqual([{ target: 1_000, label: 'Objectif' }]);
    expect(goals.overlay.fontSize).toBe(40);
    expect(goals.overlay.bar.width).toBe(600);
  });

  it('ne touche plus à une configuration déjà passée par la remise à zéro', () => {
    const settled = { schemaVersion: 9, goals: { ...OLD_GOALS, tiers: [] } };
    const prepared = prepareRawConfig(settled);

    expect(prepared.goalsReset).toBe(false);
    expect(goalsOf(settled)).toStrictEqual(settled.goals);
  });

  it('remet à zéro une configuration ancienne même sans sous-arbre d’objectifs', () => {
    const prepared = prepareRawConfig({ schemaVersion: 5, rewards: {} });

    expect(prepared.goalsReset).toBe(true);
    expect(goalsOf({ schemaVersion: 5, rewards: {} })).toBeUndefined();
  });

  it.each([undefined, null, 'texte', {}, { goals: OLD_GOALS }, { schemaVersion: '5', goals: OLD_GOALS }])(
    'ne remet rien à zéro quand le fichier ne dit pas sa version : %o',
    (raw) => {
      expect(prepareRawConfig(raw).goalsReset).toBe(false);
    },
  );

  it('ne lève pas sur un sous-arbre d’objectifs illisible', () => {
    expect(() => prepareRawConfig({ schemaVersion: 5, goals: 'texte' })).not.toThrow();
    expect(goalsOf({ schemaVersion: 5, goals: 'texte' })).toBeUndefined();
  });

  it('convertit les bits du barème de temps dans le même passage', () => {
    const prepared = prepareRawConfig({ schemaVersion: 5, rewards: { bits: TIERS }, goals: OLD_GOALS });

    expect(bitsOf({ schemaVersion: 5, rewards: { bits: TIERS }, goals: OLD_GOALS })).toStrictEqual({
      unit: 100,
      seconds: 45,
    });
    expect(prepared.goalsReset).toBe(true);
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

  it('ne rejoue pas la remise à zéro d’une configuration déjà en points', () => {
    expect(prepareRawConfig({ schemaVersion: 9, goals: { bitsPerSub: 500 } }).goalsReset).toBe(false);
  });
});

