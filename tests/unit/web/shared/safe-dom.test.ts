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
      expect(sanitizeText(`Alice${RIGHT_TO_LEFT_OVERRIDE}kcatta`, 64)).toBe('Alicekcatta');
    });

    it('retire les caractères de largeur nulle', () => {
      expect(sanitizeText(`A${ZERO_WIDTH_SPACE}l${BYTE_ORDER_MARK}ice`, 64)).toBe('Alice');
    });

    it('conserve le liant sans chasse, qui tient les emoji composés', () => {
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
      expect(sanitizeText('👍'.repeat(20), 5)).toBe('👍👍👍👍…');
    });

    it('compte un emoji composé pour un seul caractère', () => {
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
    expect(() => requireElement(host(), '#absent')).toThrow(/#absent/u);
  });
});

describe('setCssVariables', () => {
  it('applique les variables sur l’élément', () => {
    const target = host();

    setCssVariables(target, { '--cc-color': '#FFFFFF', '--cc-font-size': '96px' });

    expect(target.style.getPropertyValue('--cc-color')).toBe('#FFFFFF');
    expect(target.style.getPropertyValue('--cc-font-size')).toBe('96px');
  });

  it('refuse un nom qui n’est pas une variable CSS', () => {
    expect(() => {
      setCssVariables(host(), { color: 'red' });
    }).toThrow(/color/u);
  });
});
