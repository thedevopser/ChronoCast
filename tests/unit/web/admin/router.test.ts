import { describe, expect, it } from 'vitest';

import {
  ADMIN_VIEWS,
  DEFAULT_VIEW,
  hashForView,
  VIEW_LABELS,
  viewFromHash,
} from '../../../../src/web/admin/router.js';

describe('viewFromHash', () => {
  it.each(ADMIN_VIEWS)('reconnaît la vue %s', (view) => {
    expect(viewFromHash(`#${view}`)).toBe(view);
  });

  it('tolère un hash sans dièse', () => {
    expect(viewFromHash(DEFAULT_VIEW)).toBe(DEFAULT_VIEW);
  });

  it('tolère la casse', () => {
    expect(viewFromHash(`#${DEFAULT_VIEW.toUpperCase()}`)).toBe(DEFAULT_VIEW);
  });

  it.each(['', '#', '#inconnue', '#dashboard/extra', '#dashboard?x=1', '   '])(
    'retombe sur la vue par défaut pour %o',
    (hash) => {
      expect(viewFromHash(hash)).toBe(DEFAULT_VIEW);
    },
  );

  it('retombe sur la vue par défaut pour une charge utile hostile', () => {
    for (const hostile of [
      '#<img src=x onerror=alert(1)>',
      '#"]/../../etc/passwd',
      '#__proto__',
      '#constructor',
    ]) {
      expect(ADMIN_VIEWS).toContain(viewFromHash(hostile));
    }
  });
});

describe('hashForView', () => {
  it.each(ADMIN_VIEWS)('fait un aller-retour pour %s', (view) => {
    expect(viewFromHash(hashForView(view))).toBe(view);
  });

  it('préfixe par un dièse', () => {
    expect(hashForView(DEFAULT_VIEW)).toBe(`#${DEFAULT_VIEW}`);
  });
});

describe('ADMIN_VIEWS', () => {
  it('contient la vue par défaut', () => {
    expect(ADMIN_VIEWS).toContain(DEFAULT_VIEW);
  });

  it('ne comporte aucun doublon', () => {
    expect(new Set(ADMIN_VIEWS).size).toBe(ADMIN_VIEWS.length);
  });

  it('n’emploie que des identifiants sûrs comme fragments de sélecteur', () => {
    for (const view of ADMIN_VIEWS) {
      expect(view).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it('expose la vue « À propos »', () => {
    expect(ADMIN_VIEWS).toContain('about');
    expect(viewFromHash('#about')).toBe('about');
  });

  it('place « À propos » en dernier, sous les vues de travail', () => {
    expect(ADMIN_VIEWS.at(-1)).toBe('about');
  });
});

describe('VIEW_LABELS', () => {
  it('nomme chaque vue', () => {
    for (const view of ADMIN_VIEWS) {
      expect(VIEW_LABELS[view]).not.toBe('');
    }
  });

  it('nomme la vue « À propos »', () => {
    expect(VIEW_LABELS.about).toBe('À propos');
  });
});
