/**
 * Routage du panneau d'administration.
 *
 * Le panneau tient en une seule page : changer de vue ne recharge rien, sans
 * quoi le WebSocket serait rouvert et le compteur repartirait de zéro à
 * l'écran à chaque clic. Le hash est donc l'état de navigation.
 *
 * Il vient de l'URL, donc d'un lien, donc potentiellement de n'importe où. La
 * fonction ne renvoie que des identifiants d'une liste close : c'est ce qui
 * garantit qu'aucune valeur venue de l'extérieur ne sert jamais à composer un
 * sélecteur ou à écrire dans le DOM.
 */

import { describe, expect, it } from 'vitest';

import {
  ADMIN_VIEWS,
  DEFAULT_VIEW,
  hashForView,
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
    // La valeur ne sert jamais à composer un sélecteur ni à écrire dans le
    // DOM, mais la liste close est la garantie, pas la prudence de l'appelant.
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
    // Chaque vue devient `#view-<id>` dans le gabarit : un caractère exotique
    // y produirait un sélecteur invalide, donc une exception au chargement.
    for (const view of ADMIN_VIEWS) {
      expect(view).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });
});
