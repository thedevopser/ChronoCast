import { beforeEach, describe, expect, it } from 'vitest';

import type { AdminField } from '../../../../src/web/admin/fields.js';
import {
  clearFieldErrors,
  readFieldValues,
  renderFieldGroups,
  setGroupsCollapsed,
  setMutedFields,
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

describe('champs en lecture seule', () => {
  const READ_ONLY: readonly AdminField[] = [
    {
      selector: '#r-text',
      path: 'rewards.chatCommand.name',
      label: 'Nom',
      view: 'rewards',
      kind: 'text',
      readOnly: true,
    },
    {
      selector: '#r-enum',
      path: 'overlay.textAlign',
      label: 'Alignement',
      view: 'rewards',
      kind: 'enum',
      options: ['left', 'right'],
      readOnly: true,
    },
  ];

  beforeEach(() => {
    renderFieldGroups(document, root, READ_ONLY, ['Commande de chat', 'Texte du compteur']);
  });

  it('rend l’entrée non modifiable tout en la laissant lisible', () => {
    const input = root.querySelector<HTMLInputElement>('#r-text');

    expect(input?.readOnly).toBe(true);
    expect(input?.disabled).toBe(false);
  });

  it('désactive une liste déroulante en lecture seule', () => {
    expect(root.querySelector<HTMLSelectElement>('#r-enum')?.disabled).toBe(true);
  });

  it('marque le champ pour que le style le distingue', () => {
    expect(root.querySelector('#r-text')?.classList.contains('field__input--locked')).toBe(true);
    expect(root.querySelector('#r-enum')?.classList.contains('field__input--locked')).toBe(true);
  });

  it('laisse modifiable un champ ordinaire', () => {
    renderFieldGroups(document, root, FIELDS, [...GROUPS]);
    const input = root.querySelector<HTMLInputElement>('#a-text');

    expect(input?.readOnly).toBe(false);
    expect(input?.disabled).toBe(false);
    expect(input?.classList.contains('field__input--locked')).toBe(false);
  });
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

describe('groupes repliables', () => {
  const SWITCHED: readonly AdminField[] = [
    { selector: '#g-enabled', path: 'overlay.frame.enabled', label: 'Cadre', view: 'appearance', kind: 'boolean' },
    { selector: '#g-radius', path: 'overlay.frame.radius', label: 'Arrondi', view: 'appearance', kind: 'number', min: 0, max: 200 },
    { selector: '#g-font', path: 'overlay.fontFamily', label: 'Police', view: 'appearance', kind: 'text' },
  ];

  const SWITCHED_GROUPS = ['Cadre', 'Texte du compteur'] as const;

  beforeEach(() => {
    renderFieldGroups(document, root, SWITCHED, SWITCHED_GROUPS, { collapsible: true });
  });

  it('rend chaque groupe en volet dépliable, ouvert par défaut', () => {
    const groups = root.querySelectorAll<HTMLDetailsElement>('details.group');

    expect(groups).toHaveLength(2);
    expect([...groups].every((group) => group.open)).toBe(true);
  });

  it('garde le titre lisible et au même sélecteur', () => {
    expect(
      [...root.querySelectorAll('.group__title')].map((element) => element.textContent),
    ).toEqual([...SWITCHED_GROUPS]);
    expect(root.querySelector('.group__title')?.tagName).toBe('SUMMARY');
  });

  it('reste en sections simples quand on ne demande rien', () => {
    renderFieldGroups(document, root, SWITCHED, SWITCHED_GROUPS);

    expect(root.querySelectorAll('details.group')).toHaveLength(0);
    expect(root.querySelector('.group__title')?.tagName).toBe('H2');
  });

  it('replie les groupes nommés et déplie les autres', () => {
    setGroupsCollapsed(root, ['Cadre']);

    const groups = [...root.querySelectorAll<HTMLDetailsElement>('details.group')];
    expect(groups.map((group) => group.open)).toEqual([false, true]);
  });

  it('ne lève pas sur un groupe inconnu', () => {
    expect(() => {
      setGroupsCollapsed(root, ['Inexistant']);
    }).not.toThrow();
  });
});

describe('champs sans effet', () => {
  it('marque le champ et son entourage sans jamais le désactiver', () => {
    setMutedFields(root, FIELDS, ['#a-color']);

    const input = root.querySelector<HTMLInputElement>('#a-color');
    expect(input?.closest('.field')?.classList.contains('field--muted')).toBe(true);
    expect(input?.getAttribute('aria-disabled')).toBe('true');
    expect(input?.disabled).toBe(false);
    expect(input?.readOnly).toBe(false);
  });

  it('relève la marque quand le réglage redevient utile', () => {
    setMutedFields(root, FIELDS, ['#a-color']);
    setMutedFields(root, FIELDS, []);

    const input = root.querySelector<HTMLInputElement>('#a-color');
    expect(input?.closest('.field')?.classList.contains('field--muted')).toBe(false);
    expect(input?.hasAttribute('aria-disabled')).toBe(false);
  });

  it('ne lève pas pour un champ absent du conteneur', () => {
    expect(() => {
      setMutedFields(root, FIELDS, ['#inexistant']);
    }).not.toThrow();
  });
});

describe('curseurs et unités', () => {
  const SLIDERS: readonly AdminField[] = [
    {
      selector: '#s-size',
      path: 'overlay.fontSize',
      label: 'Taille',
      view: 'appearance',
      kind: 'integer',
      min: 8,
      max: 400,
      slider: true,
      unit: 'px',
    },
    {
      selector: '#s-opacity',
      path: 'overlay.frame.fillOpacity',
      label: 'Opacité',
      view: 'appearance',
      kind: 'number',
      min: 0,
      max: 1,
      slider: true,
    },
  ];

  beforeEach(() => {
    renderFieldGroups(document, root, SLIDERS, ['Texte du compteur', 'Cadre']);
  });

  it('double le champ chiffré d’un curseur portant les mêmes bornes', () => {
    const range = root.querySelector<HTMLInputElement>('#s-size-range');

    expect(range?.type).toBe('range');
    expect(range?.min).toBe('8');
    expect(range?.max).toBe('400');
    expect(range?.step).toBe('1');
  });

  it('laisse le champ chiffré porter le sélecteur du descripteur', () => {
    const input = root.querySelector<HTMLInputElement>('#s-size');

    expect(input?.type).toBe('number');
    expect(readFieldValues(root, SLIDERS)).toHaveProperty('#s-size');
  });

  it('choisit un pas fin pour un nombre décimal', () => {
    expect(root.querySelector<HTMLInputElement>('#s-opacity-range')?.step).toBe('0.01');
  });

  it('affiche l’unité, et rien quand il n’y en a pas', () => {
    expect(root.querySelector('#s-size')?.closest('.field')?.textContent).toContain('px');
    expect(root.querySelector('.field__unit')).not.toBeNull();
    expect(root.querySelectorAll('.field__unit')).toHaveLength(1);
  });

  it('recopie le curseur vers le champ chiffré, et prévient qui écoute', () => {
    const range = root.querySelector<HTMLInputElement>('#s-size-range');
    const input = root.querySelector<HTMLInputElement>('#s-size');
    let heard = 0;
    input?.addEventListener('input', () => {
      heard += 1;
    });

    range!.value = '120';
    range!.dispatchEvent(new Event('input', { bubbles: true }));

    expect(input?.value).toBe('120');
    expect(heard).toBe(1);
  });

  it('recopie le champ chiffré vers le curseur sans boucler', () => {
    const range = root.querySelector<HTMLInputElement>('#s-size-range');
    const input = root.querySelector<HTMLInputElement>('#s-size');

    input!.value = '64';
    input!.dispatchEvent(new Event('input', { bubbles: true }));

    expect(range?.value).toBe('64');
  });

  it('suit le curseur quand writeFieldValues repeint le formulaire', () => {
    writeFieldValues(root, SLIDERS, { '#s-size': '300' });

    expect(root.querySelector<HTMLInputElement>('#s-size-range')?.value).toBe('300');
  });
});
