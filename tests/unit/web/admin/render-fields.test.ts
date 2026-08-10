import { beforeEach, describe, expect, it } from 'vitest';

import type { AdminField } from '../../../../src/web/admin/fields.js';
import {
  clearFieldErrors,
  readFieldValues,
  renderFieldGroups,
  showFieldErrors,
  writeFieldValues,
} from '../../../../src/web/admin/render-fields.js';

const FIELDS: readonly AdminField[] = [
  { selector: '#a-int', path: 'counter.initialSeconds', label: 'Départ', view: 'settings', kind: 'integer', min: 1 },
  { selector: '#a-num', path: 'overlay.letterSpacing', label: 'Interlettrage', view: 'settings', kind: 'number' },
  { selector: '#a-bool', path: 'counter.resumeOnStartup', label: 'Reprendre', view: 'settings', kind: 'boolean' },
  { selector: '#a-text', path: 'overlay.fontFamily', label: 'Police', view: 'settings', kind: 'text', hint: 'Locale' },
  { selector: '#a-color', path: 'overlay.color', label: 'Couleur', view: 'settings', kind: 'color' },
  {
    selector: '#a-enum',
    path: 'overlay.textAlign',
    label: 'Alignement',
    view: 'settings',
    kind: 'enum',
    options: ['left', 'center', 'right'],
  },
];

const GROUPS = ['Compteur', 'Texte du compteur'] as const;

let root: HTMLElement;

beforeEach(() => {
  document.body.replaceChildren();
  root = document.createElement('div');
  document.body.append(root);
  renderFieldGroups(document, root, FIELDS, GROUPS);
});

describe('renderFieldGroups', () => {
  it('crée un champ par descripteur, à son sélecteur', () => {
    for (const field of FIELDS) {
      expect(root.querySelector(field.selector), field.selector).not.toBeNull();
    }
  });

  it.each([
    ['#a-int', 'number'],
    ['#a-num', 'number'],
    ['#a-bool', 'checkbox'],
    ['#a-text', 'text'],
    ['#a-color', 'color'],
  ])('donne au champ %s le type %s', (selector, type) => {
    expect(root.querySelector<HTMLInputElement>(selector)?.type).toBe(type);
  });

  it('rend une énumération en liste déroulante', () => {
    const select = root.querySelector<HTMLSelectElement>('#a-enum');

    expect(select?.tagName).toBe('SELECT');
    expect([...(select?.options ?? [])].map((option) => option.value)).toEqual([
      'left',
      'center',
      'right',
    ]);
  });

  it('reporte les bornes sur le champ', () => {
    expect(root.querySelector<HTMLInputElement>('#a-int')?.min).toBe('1');
  });

  it('affiche les libellés et les précisions', () => {
    expect(root.textContent).toContain('Police');
    expect(root.textContent).toContain('Locale');
  });

  it('groupe sous un titre', () => {
    expect(
      [...root.querySelectorAll('.group__title')].map((element) => element.textContent),
    ).toEqual([...GROUPS]);
  });

  it('n’interprète jamais le contenu écrit', () => {
    const hostile: readonly AdminField[] = [
      {
        selector: '#a-x',
        path: 'overlay.fontFamily',
        label: '<img src=x onerror=alert(1)>',
        hint: '<script>alert(2)</script>',
        view: 'settings',
        kind: 'text',
      },
    ];
    const target = document.createElement('div');
    renderFieldGroups(document, target, hostile, ['Texte du compteur']);

    expect(target.querySelectorAll('img')).toHaveLength(0);
    expect(target.querySelectorAll('script')).toHaveLength(0);
    expect(target.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('remplace le contenu précédent au lieu de l’empiler', () => {
    renderFieldGroups(document, root, FIELDS, GROUPS);

    expect(root.querySelectorAll('#a-int')).toHaveLength(1);
  });
});

describe('writeFieldValues et readFieldValues', () => {
  it('fait un aller-retour sans rien altérer', () => {
    const values = {
      '#a-int': '43200',
      '#a-num': '1.5',
      '#a-bool': true,
      '#a-text': 'Inter',
      '#a-color': '#ffcc00',
      '#a-enum': 'right',
    };

    writeFieldValues(root, FIELDS, values);

    expect(readFieldValues(root, FIELDS)).toEqual(values);
  });

  it('lit une case à cocher par son état, jamais par sa valeur', () => {
    writeFieldValues(root, FIELDS, { '#a-bool': false });

    expect(readFieldValues(root, FIELDS)['#a-bool']).toBe(false);
  });

  it('omet des valeurs lues les champs absents du conteneur', () => {
    const partial = document.createElement('div');
    renderFieldGroups(document, partial, FIELDS.slice(0, 1), ['Compteur']);

    expect(Object.keys(readFieldValues(partial, FIELDS))).toEqual(['#a-int']);
  });

  it('ignore une valeur visant un champ absent', () => {
    expect(() => {
      writeFieldValues(root, FIELDS, { '#inexistant': 'x' });
    }).not.toThrow();
  });
});

describe('erreurs de saisie', () => {
  it('affiche le message sous le champ concerné', () => {
    showFieldErrors(root, [{ selector: '#a-int', path: 'counter.initialSeconds', message: 'Nombre entier attendu.' }]);

    expect(root.querySelector('#a-int-error')?.textContent).toBe('Nombre entier attendu.');
  });

  it('marque le champ fautif', () => {
    showFieldErrors(root, [{ selector: '#a-int', path: 'x', message: 'Faux.' }]);

    expect(root.querySelector('#a-int')?.className).toContain('field__input--invalid');
  });

  it('efface les messages précédents', () => {
    showFieldErrors(root, [{ selector: '#a-int', path: 'x', message: 'Faux.' }]);
    clearFieldErrors(root, FIELDS);

    expect(root.querySelector('#a-int-error')?.textContent).toBe('');
    expect(root.querySelector('#a-int')?.className).not.toContain('field__input--invalid');
  });

  it('ne lève pas pour une erreur visant un champ absent', () => {
    expect(() => {
      showFieldErrors(root, [{ selector: '#inexistant', path: 'x', message: 'Faux.' }]);
    }).not.toThrow();
  });
});
