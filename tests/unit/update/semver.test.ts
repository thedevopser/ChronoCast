import { describe, expect, it } from 'vitest';

import { compareVersions, isNewer, parseVersion } from '../../../src/core/update/semver.js';

/**
 * Comparaison de versions.
 *
 * C'est le premier des deux verrous de la mise à jour, et le moins évident des
 * deux : une comparaison lexicographique laisserait `0.9.0` battre `0.10.0`, ce
 * qui bloquerait toutes les mises à jour d'une décennie de correctifs sans que
 * rien ne le signale. L'autre verrou est le condensat.
 *
 * La grammaire acceptée est délibérément étroite — trois nombres, rien d'autre.
 * Le dépôt ne publie que des `vX.Y.Z`, et tolérer ici une pré-version
 * reviendrait à pousser une bêta sur tous les postes le jour où quelqu'un en
 * publierait une par erreur.
 */
describe('parseVersion', () => {
  it('lit une version nue', () => {
    expect(parseVersion('0.5.0')).toEqual({ major: 0, minor: 5, patch: 0 });
  });

  it('tolère le préfixe `v` des tags Git', () => {
    // Le `tag_name` de GitHub le porte, `package.json` non : les deux formes
    // arrivent ici, et distinguer les deux appelants ne servirait à rien.
    expect(parseVersion('v1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it('lit des composantes à plusieurs chiffres', () => {
    expect(parseVersion('10.20.30')).toEqual({ major: 10, minor: 20, patch: 30 });
  });

  it.each([
    ['chaîne vide', ''],
    ['deux composantes', '1.2'],
    ['quatre composantes', '1.2.3.4'],
    ['composante non numérique', '1.2.x'],
    ['pré-version', '1.2.3-beta.1'],
    ['métadonnée de build', '1.2.3+42'],
    ['espace en tête', ' 1.2.3'],
    ['espace en fin', '1.2.3 '],
    ['préfixe inconnu', 'version1.2.3'],
    ['zéro initial', '01.2.3'],
    ['composante négative', '1.-2.3'],
    ['séparateur absent', '123'],
  ])('refuse %s', (_libelle, entree) => {
    expect(parseVersion(entree)).toBeNull();
  });

  it('accepte le zéro seul, qui n’est pas un zéro initial', () => {
    expect(parseVersion('0.0.0')).toEqual({ major: 0, minor: 0, patch: 0 });
  });
});

describe('compareVersions', () => {
  it('ordonne par majeur d’abord', () => {
    expect(compareVersions({ major: 2, minor: 0, patch: 0 }, { major: 1, minor: 9, patch: 9 })).toBe(1);
  });

  it('ordonne par mineur ensuite', () => {
    expect(compareVersions({ major: 1, minor: 2, patch: 0 }, { major: 1, minor: 1, patch: 9 })).toBe(1);
  });

  it('ordonne par correctif en dernier', () => {
    expect(compareVersions({ major: 1, minor: 1, patch: 2 }, { major: 1, minor: 1, patch: 3 })).toBe(-1);
  });

  it('reconnaît l’égalité', () => {
    expect(compareVersions({ major: 1, minor: 1, patch: 1 }, { major: 1, minor: 1, patch: 1 })).toBe(0);
  });

  it('compare numériquement, jamais lexicographiquement', () => {
    // Le défaut que ce module existe pour empêcher : `9` > `10` en texte.
    expect(compareVersions({ major: 0, minor: 10, patch: 0 }, { major: 0, minor: 9, patch: 0 })).toBe(1);
  });
});

describe('isNewer', () => {
  it('reconnaît une version plus récente', () => {
    expect(isNewer('0.5.1', '0.5.0')).toBe(true);
  });

  it('refuse une version identique', () => {
    // Sinon l'application proposerait indéfiniment d'installer ce qui est déjà
    // installé, et le ferait quatre fois par jour.
    expect(isNewer('0.5.0', '0.5.0')).toBe(false);
  });

  it('refuse une version plus ancienne', () => {
    // Un retour en arrière remplacerait une correction par le défaut qu'elle
    // corrige, sans que l'utilisateur ait rien demandé.
    expect(isNewer('0.4.0', '0.5.0')).toBe(false);
  });

  it('refuse quand le candidat est illisible', () => {
    expect(isNewer('bientôt', '0.5.0')).toBe(false);
  });

  it('refuse quand la version courante est illisible', () => {
    // Ne rien comprendre à sa propre version et mettre à jour quand même, c'est
    // accepter n'importe quel artefact : le refus est le seul comportement sûr.
    expect(isNewer('0.5.1', '')).toBe(false);
  });

  it('accepte le tag Git tel que GitHub le renvoie', () => {
    expect(isNewer('v0.5.1', '0.5.0')).toBe(true);
  });
});
