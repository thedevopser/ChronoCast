import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '../../../../src/core/config/defaults.js';
import {
  ADMIN_FIELDS,
  UNBOUND_PATHS,
  fieldsOf,
  groupOf,
  groupsOf,
} from '../../../../src/web/admin/fields.js';
import { readAtPath } from '../../../../src/web/admin/form-binding.js';
import { FIELD_VIEWS } from '../../../../src/web/admin/router.js';

function leafPaths(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [prefix];
  }

  return Object.entries(value).flatMap(([key, child]) =>
    leafPaths(child, prefix === '' ? key : `${prefix}.${key}`),
  );
}

const LEAVES = leafPaths(DEFAULT_CONFIG);
const BOUND = new Set(ADMIN_FIELDS.map((field) => field.path));

describe('couverture du schéma', () => {
  it('lie un champ à chaque réglage, ou l’écarte explicitement', () => {
    const orphans = LEAVES.filter(
      (path) => !BOUND.has(path) && !Object.hasOwn(UNBOUND_PATHS, path),
    );

    expect(orphans).toEqual([]);
  });

  it('justifie chaque réglage écarté', () => {
    for (const [path, reason] of Object.entries(UNBOUND_PATHS)) {
      expect(reason.length, path).toBeGreaterThan(20);
    }
  });

  it('n’écarte que des chemins qui existent réellement', () => {
    const stale = Object.keys(UNBOUND_PATHS).filter((path) => !LEAVES.includes(path));

    expect(stale).toEqual([]);
  });

  it('n’écarte aucun chemin par ailleurs lié', () => {
    const both = Object.keys(UNBOUND_PATHS).filter((path) => BOUND.has(path));

    expect(both).toEqual([]);
  });
});

describe('cohérence des descripteurs', () => {
  it('désigne des chemins qui existent', () => {
    const unknown = ADMIN_FIELDS.filter(
      (field) => readAtPath(DEFAULT_CONFIG, field.path) === undefined,
    );

    expect(unknown.map((field) => field.path)).toEqual([]);
  });

  it('annonce un genre compatible avec la valeur par défaut', () => {
    for (const field of ADMIN_FIELDS) {
      const value = readAtPath(DEFAULT_CONFIG, field.path);
      const expected =
        field.kind === 'boolean' ? 'boolean' : field.kind === 'integer' || field.kind === 'number' ? 'number' : 'string';

      expect(typeof value, `${field.path} (${field.kind})`).toBe(expected);
    }
  });

  it('n’annonce « integer » que pour des entiers', () => {
    for (const field of ADMIN_FIELDS.filter((entry) => entry.kind === 'integer')) {
      expect(Number.isInteger(readAtPath(DEFAULT_CONFIG, field.path)), field.path).toBe(true);
    }
  });

  it('propose des options contenant la valeur par défaut', () => {
    for (const field of ADMIN_FIELDS.filter((entry) => entry.kind === 'enum')) {
      expect(field.options, field.path).toBeDefined();
      expect(field.options, field.path).toContain(readAtPath(DEFAULT_CONFIG, field.path));
    }
  });

  it('décrit des couleurs hexadécimales', () => {
    for (const field of ADMIN_FIELDS.filter((entry) => entry.kind === 'color')) {
      expect(readAtPath(DEFAULT_CONFIG, field.path), field.path).toMatch(
        /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/,
      );
    }
  });

  it('pose des bornes qui laissent passer la valeur par défaut', () => {
    for (const field of ADMIN_FIELDS) {
      const value = readAtPath(DEFAULT_CONFIG, field.path);
      if (typeof value !== 'number') {
        continue;
      }
      if (field.min !== undefined) {
        expect(value, `${field.path} min`).toBeGreaterThanOrEqual(field.min);
      }
      if (field.max !== undefined) {
        expect(value, `${field.path} max`).toBeLessThanOrEqual(field.max);
      }
    }
  });

  it('n’emploie aucun sélecteur ni chemin en double', () => {
    expect(new Set(ADMIN_FIELDS.map((field) => field.selector)).size).toBe(ADMIN_FIELDS.length);
    expect(new Set(ADMIN_FIELDS.map((field) => field.path)).size).toBe(ADMIN_FIELDS.length);
  });

  it('emploie des sélecteurs d’identifiant bien formés', () => {
    for (const field of ADMIN_FIELDS) {
      expect(field.selector, field.path).toMatch(/^#[a-z][a-z0-9-]*$/);
    }
  });

  it('donne un libellé à chaque champ', () => {
    for (const field of ADMIN_FIELDS) {
      expect(field.label.trim(), field.path).not.toBe('');
    }
  });
});

describe('fieldsOf', () => {
  it.each(FIELD_VIEWS)('rend au moins un champ pour la vue %s', (view) => {
    expect(fieldsOf(view).length).toBeGreaterThan(0);
  });

  it('range chaque champ dans une vue connue', () => {
    for (const field of ADMIN_FIELDS) {
      expect(FIELD_VIEWS, field.path).toContain(field.view);
    }
  });

  it('partitionne les champs sans perte ni doublon', () => {
    const regrouped = FIELD_VIEWS.flatMap((view) => [...fieldsOf(view)]);

    expect(regrouped).toHaveLength(ADMIN_FIELDS.length);
    expect(new Set(regrouped.map((field) => field.path)).size).toBe(ADMIN_FIELDS.length);
  });
});

describe('regroupement', () => {
  it('range chaque champ dans un groupe nommé', () => {
    for (const field of ADMIN_FIELDS) {
      expect(groupOf(field.path), field.path).not.toBe('Divers');
    }
  });

  it('ne mélange pas deux vues dans un même groupe', () => {
    const byGroup = new Map<string, Set<string>>();

    for (const field of ADMIN_FIELDS) {
      const views = byGroup.get(groupOf(field.path)) ?? new Set<string>();
      views.add(field.view);
      byGroup.set(groupOf(field.path), views);
    }

    for (const [group, views] of byGroup) {
      expect([...views], group).toHaveLength(1);
    }
  });

  it.each(FIELD_VIEWS)('énumère les groupes de la vue %s sans doublon', (view) => {
    const groups = groupsOf(view);

    expect(groups.length).toBeGreaterThan(0);
    expect(new Set(groups).size).toBe(groups.length);
  });

  it('couvre tous les champs d’une vue par ses groupes', () => {
    for (const view of FIELD_VIEWS) {
      const groups = groupsOf(view);
      const covered = fieldsOf(view).filter((field) => groups.includes(groupOf(field.path)));

      expect(covered, view).toHaveLength(fieldsOf(view).length);
    }
  });
});
