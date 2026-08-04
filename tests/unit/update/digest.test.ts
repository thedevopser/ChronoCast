import { describe, expect, it } from 'vitest';

import { parseSha256File, sha256Hex } from '../../../src/core/update/digest.js';

/**
 * Le condensat, seul contrôle d'intégrité du chemin de mise à jour.
 *
 * L'installeur n'est pas signé, et le fichier que l'application télécharge avec
 * le `fetch` de Node ne porte aucune *Mark of the Web* : Windows le lancera
 * sans la moindre invite, altéré ou non. Ce module est donc le seul endroit où
 * l'on peut encore dire non.
 *
 * D'où la vérification du **nom** en plus du condensat : un `.sha256` valide
 * mais décrivant un autre fichier validerait n'importe quoi, et c'est
 * exactement ce qu'obtiendrait quiconque saurait substituer un asset à un
 * autre.
 */

/** Condensat de la chaîne vide, valeur de référence publiée par le NIST. */
const EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

describe('sha256Hex', () => {
  it('calcule le condensat de la chaîne vide', () => {
    expect(sha256Hex(new Uint8Array(0))).toBe(EMPTY);
  });

  it('calcule le condensat d’« abc »', () => {
    expect(sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('rend un condensat en minuscules, sur soixante-quatre caractères', () => {
    const digest = sha256Hex(new TextEncoder().encode('ChronoCast'));

    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('distingue deux contenus voisins', () => {
    const a = sha256Hex(new TextEncoder().encode('ChronoCast'));
    const b = sha256Hex(new TextEncoder().encode('ChronoCasu'));

    expect(a).not.toBe(b);
  });
});

describe('parseSha256File', () => {
  const NAME = 'ChronoCast-Setup-0.5.1.exe';
  const DIGEST = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

  it('lit la sortie de `sha256sum` en mode texte', () => {
    // Deux espaces : c'est ce que produit le workflow `Release`.
    expect(parseSha256File(`${DIGEST}  ${NAME}\n`, NAME)).toBe(DIGEST);
  });

  it('lit la sortie de `sha256sum` en mode binaire', () => {
    // Espace puis astérisque. Le workflow n'en produit pas, mais un condensat
    // recalculé à la main sous Windows, si.
    expect(parseSha256File(`${DIGEST} *${NAME}\n`, NAME)).toBe(DIGEST);
  });

  it('accepte un condensat écrit en majuscules et le rend en minuscules', () => {
    expect(parseSha256File(`${DIGEST.toUpperCase()}  ${NAME}`, NAME)).toBe(DIGEST);
  });

  it('tolère l’absence de saut de ligne final', () => {
    expect(parseSha256File(`${DIGEST}  ${NAME}`, NAME)).toBe(DIGEST);
  });

  it('tolère les fins de ligne Windows', () => {
    // Le fichier est produit sous Linux mais lu sous Windows : c'est
    // exactement la classe de défaut qui a fait tomber trente-trois tests en
    // Phase 7.
    expect(parseSha256File(`${DIGEST}  ${NAME}\r\n`, NAME)).toBe(DIGEST);
  });

  it('retient la ligne du fichier demandé parmi plusieurs', () => {
    const autre = 'aa'.repeat(32);
    const contenu = `${autre}  autre-fichier.exe\n${DIGEST}  ${NAME}\n`;

    expect(parseSha256File(contenu, NAME)).toBe(DIGEST);
  });

  it('refuse un condensat décrivant un autre fichier', () => {
    // Le cœur du module : un `.sha256` parfaitement valide mais portant sur un
    // autre artefact validerait n'importe quel téléchargement.
    expect(parseSha256File(`${DIGEST}  autre-fichier.exe\n`, NAME)).toBeNull();
  });

  it('refuse un nom qui n’est qu’un suffixe de celui attendu', () => {
    expect(parseSha256File(`${DIGEST}  Setup-0.5.1.exe\n`, NAME)).toBeNull();
  });

  it.each([
    ['fichier vide', ''],
    ['condensat trop court', `${'ab'.repeat(31)}  ${NAME}`],
    ['condensat trop long', `${'ab'.repeat(33)}  ${NAME}`],
    ['caractère non hexadécimal', `${'zz'.repeat(32)}  ${NAME}`],
    ['nom absent', DIGEST],
    ['séparateur absent', `${DIGEST}${NAME}`],
    ['texte quelconque', 'Not Found'],
  ])('refuse %s', (_libelle, contenu) => {
    expect(parseSha256File(contenu, NAME)).toBeNull();
  });
});
