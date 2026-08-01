/**
 * Écriture dans le DOM, seul endroit du front autorisé à le faire.
 *
 * Le risque couvert est le seul vraiment grave de tout ce projet. L'overlay
 * affiche des pseudonymes et des messages **choisis par des tiers non fiables**
 * — n'importe quel spectateur — dans une Browser Source OBS qui tourne sans
 * surveillance, sur la machine du streamer. Un pseudo contenant du HTML ne doit
 * jamais être interprété.
 *
 * C'est précisément pour ce fichier que la suite dispose de `happy-dom`. Un
 * faux `document` écrit à la main prouverait qu'on a appelé `textContent` ; il
 * ne prouverait rien sur ce qu'un analyseur HTML fait de la chaîne, puisqu'il
 * n'y en aurait pas. Ici, on écrit dans un vrai arbre et on constate qu'aucun
 * élément n'est né de la charge utile.
 *
 * Deuxième famille d'attaques, moins connue et tout aussi réelle : les
 * caractères de contrôle. Un saut de ligne dans un pseudo casse la mise en page
 * d'une bulle, et U+202E inverse le sens de lecture de tout ce qui suit — de
 * quoi faire afficher n'importe quoi à l'écran sans la moindre balise.
 *
 * Ces caractères sont construits par `String.fromCodePoint` et jamais écrits en
 * littéral : un octet invisible dans le source ne se relit pas, ne se revoit
 * pas, et sa disparition accidentelle rendrait le test trivialement vert sans
 * que personne ne s'en aperçoive.
 */

import { describe, expect, it } from 'vitest';

import {
  clearChildren,
  requireElement,
  sanitizeText,
  setCssVariables,
  setText,
} from '../../../../src/web/shared/safe-dom.js';

const ESCAPE = String.fromCodePoint(0x1b);
const BELL = String.fromCodePoint(0x07);
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b);
const BYTE_ORDER_MARK = String.fromCodePoint(0xfeff);
const RIGHT_TO_LEFT_OVERRIDE = String.fromCodePoint(0x202e);
const ZERO_WIDTH_JOINER = String.fromCodePoint(0x200d);

/** Élément neuf, détaché du document : chaque test part d'un arbre vierge. */
function host(): HTMLElement {
  return document.createElement('div');
}

describe('sanitizeText', () => {
  describe('caractères de contrôle', () => {
    it('retire les retours à la ligne', () => {
      expect(sanitizeText('Alice\nBob', 64)).toBe('AliceBob');
    });

    it('retire les caractères de contrôle et les séquences ANSI', () => {
      expect(sanitizeText(`${ESCAPE}[31mAlice${BELL}`, 64)).toBe('[31mAlice');
    });

    it("retire les marques de direction d'écriture", () => {
      // U+202E inverse le sens de lecture : sans ce filtre, un pseudo peut
      // faire afficher à l'écran un texte que personne n'a écrit.
      expect(sanitizeText(`Alice${RIGHT_TO_LEFT_OVERRIDE}kcatta`, 64)).toBe('Alicekcatta');
    });

    it('retire les caractères de largeur nulle', () => {
      expect(sanitizeText(`A${ZERO_WIDTH_SPACE}l${BYTE_ORDER_MARK}ice`, 64)).toBe('Alice');
    });

    it('conserve le liant sans chasse, qui tient les emoji composés', () => {
      // U+200D est invisible lui aussi, mais le retirer ferait éclater une
      // famille en trois personnes et abîmerait des pseudos honnêtes.
      const family = `👨${ZERO_WIDTH_JOINER}👩${ZERO_WIDTH_JOINER}👧`;

      expect(sanitizeText(family, 64)).toBe(family);
    });

    it('conserve les caractères imprimables non latins', () => {
      expect(sanitizeText('日本語 Ünïcodé 👍', 64)).toBe('日本語 Ünïcodé 👍');
    });
  });

  describe('troncature', () => {
    it('laisse intacte une chaîne assez courte', () => {
      expect(sanitizeText('Alice', 64)).toBe('Alice');
    });

    it('tronque et signale la coupure, sans dépasser la longueur demandée', () => {
      expect(sanitizeText('a'.repeat(100), 10)).toBe('aaaaaaaaa…');
    });

    it('ne coupe pas un caractère en deux', () => {
      // Une troncature naïve par `slice` séparerait la paire de substitution
      // d'un emoji et produirait un losange noir à l'écran.
      expect(sanitizeText('👍'.repeat(20), 5)).toBe('👍👍👍👍…');
    });

    it('compte un emoji composé pour un seul caractère', () => {
      // Découpé par point de code, ce pseudo ferait cinq unités et serait
      // tronqué au milieu d'une famille.
      const family = `👨${ZERO_WIDTH_JOINER}👩${ZERO_WIDTH_JOINER}👧`;

      expect(sanitizeText(`${family}${family}`, 2)).toBe(`${family}${family}`);
    });

    it('accepte une chaîne vide', () => {
      expect(sanitizeText('', 64)).toBe('');
    });
  });
});

describe('setText', () => {
  it('écrit le texte demandé', () => {
    const target = host();

    setText(target, 'Alice');

    expect(target.textContent).toBe('Alice');
  });

  it('remplace le contenu précédent', () => {
    const target = host();
    setText(target, 'Alice');

    setText(target, 'Bob');

    expect(target.textContent).toBe('Bob');
    expect(target.childNodes).toHaveLength(1);
  });

  describe('contenu hostile', () => {
    it("n'interprète pas une balise image porteuse d'un gestionnaire", () => {
      const target = host();

      setText(target, '<img src=x onerror=alert(1)>');

      expect(target.querySelectorAll('img')).toHaveLength(0);
      expect(target.children).toHaveLength(0);
      expect(target.textContent).toBe('<img src=x onerror=alert(1)>');
    });

    it("n'interprète pas une balise script", () => {
      const target = host();

      setText(target, '<script>alert(1)</' + 'script>');

      expect(target.querySelectorAll('script')).toHaveLength(0);
      expect(target.children).toHaveLength(0);
    });

    it("n'ajoute qu'un seul nœud, et c'est du texte", () => {
      const target = host();

      setText(target, '<b>gras</b><i>italique</i>');

      expect(target.childNodes).toHaveLength(1);
      expect(target.childNodes[0]?.nodeType).toBe(3 /* Node.TEXT_NODE */);
    });

    it('tronque un pseudo démesuré', () => {
      const target = host();

      setText(target, 'a'.repeat(500));

      expect(target.textContent).toBe(`${'a'.repeat(63)}…`);
    });
  });
});

describe('clearChildren', () => {
  it('vide un élément de tous ses enfants', () => {
    const target = host();
    target.append(document.createElement('span'), document.createElement('span'));

    clearChildren(target);

    expect(target.childNodes).toHaveLength(0);
  });

  it('accepte un élément déjà vide', () => {
    const target = host();

    clearChildren(target);

    expect(target.childNodes).toHaveLength(0);
  });
});

describe('requireElement', () => {
  it("rend l'élément désigné", () => {
    const root = host();
    const child = document.createElement('span');
    child.id = 'compteur';
    root.append(child);

    expect(requireElement(root, '#compteur')).toBe(child);
  });

  it('lève quand la page ne contient pas l’élément attendu', () => {
    // Le gabarit est le nôtre : une absence est un défaut de programmation, et
    // échouer au démarrage vaut mieux qu'un overlay muet pendant six heures.
    expect(() => requireElement(host(), '#absent')).toThrow(/#absent/u);
  });
});

describe('setCssVariables', () => {
  it('applique les variables sur l’élément', () => {
    // La CSP interdit l'attribut `style` écrit en HTML, mais pas le CSSOM :
    // c'est la seule voie pour répercuter la configuration de l'overlay.
    const target = host();

    setCssVariables(target, { '--cc-color': '#FFFFFF', '--cc-font-size': '96px' });

    expect(target.style.getPropertyValue('--cc-color')).toBe('#FFFFFF');
    expect(target.style.getPropertyValue('--cc-font-size')).toBe('96px');
  });

  it('refuse un nom qui n’est pas une variable CSS', () => {
    // Sans cette garde, une faute de frappe écrirait une propriété réelle et
    // le défaut ne se verrait qu'à l'écran, en direct.
    expect(() => {
      setCssVariables(host(), { color: 'red' });
    }).toThrow(/color/u);
  });
});
