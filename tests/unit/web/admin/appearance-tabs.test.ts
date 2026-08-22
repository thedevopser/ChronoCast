import { describe, expect, it } from 'vitest';

import {
  APPEARANCE_TABS,
  APPEARANCE_TAB_LABELS,
  DEFAULT_APPEARANCE_TAB,
  tabFromValue,
} from '../../../../src/web/admin/appearance-tabs.js';
import { FIELD_VIEWS } from '../../../../src/web/admin/router.js';

describe('APPEARANCE_TABS', () => {
  // Chaque onglet est une vue à champs : c'est ce qui lui donne son conteneur, son bouton
  // d'enregistrement et son jeu de descripteurs, sans rien de particulier à câbler.
  it('ne nomme que des vues à champs existantes', () => {
    for (const tab of APPEARANCE_TABS) {
      expect(FIELD_VIEWS as readonly string[]).toContain(tab);
    }
  });

  it('ouvre sur le compteur, qui est l’overlay historique', () => {
    expect(DEFAULT_APPEARANCE_TAB).toBe('appearance');
    expect(APPEARANCE_TABS[0]).toBe('appearance');
  });

  it('porte les deux pages servies à OBS, et elles seules', () => {
    expect([...APPEARANCE_TABS]).toStrictEqual(['appearance', 'goal-appearance']);
  });

  it('nomme chaque onglet sans le laisser vide', () => {
    for (const tab of APPEARANCE_TABS) {
      expect(APPEARANCE_TAB_LABELS[tab].trim()).not.toBe('');
    }
  });

  it('n’emploie que des identifiants sûrs comme fragments de sélecteur', () => {
    for (const tab of APPEARANCE_TABS) {
      expect(tab).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });
});

describe('tabFromValue', () => {
  it.each(APPEARANCE_TABS)('reconnaît %s', (tab) => {
    expect(tabFromValue(tab)).toBe(tab);
  });

  it.each([undefined, '', 'inconnu', '__proto__', 'constructor', 'APPEARANCE'])(
    'retombe sur l’onglet par défaut pour %o',
    (value) => {
      expect(tabFromValue(value)).toBe(DEFAULT_APPEARANCE_TAB);
    },
  );
});
