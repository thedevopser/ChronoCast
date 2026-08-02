/**
 * Rendu des champs décrits par `fields.ts`.
 *
 * Le gabarit ne contient aucun des soixante-dix champs de réglage : ils sont
 * construits ici, à partir de la table de descripteurs. Les recopier dans le
 * HTML créerait une seconde source de vérité, et une faute de frappe entre un
 * sélecteur et son descripteur ne se verrait qu'à l'usage — un réglage « qui ne
 * s'enregistre pas », sans message ni trace.
 *
 * C'est la seule frontière du panneau où l'on écrit dans le DOM à partir d'une
 * description, d'où le module séparé et testé. Tout ce qui décide — quoi
 * envoyer, quoi refuser — reste dans `form-binding.ts`, qui ne connaît pas le
 * DOM ; ici on ne fait que peindre et relire.
 *
 * **Rien n'est écrit autrement que par `textContent`.** Les libellés sont les
 * nôtres, donc sûrs, mais la discipline vaut par sa constance : une exception
 * accordée une fois est une exception qu'on reproduit.
 */

import type { AdminField } from './fields.js';
import { groupOf } from './fields.js';
import type { FieldError, RawValue } from './form-binding.js';
import { setText } from '../shared/safe-dom.js';

/** Type de champ HTML par genre. `enum` fait exception : c'est un `select`. */
const INPUT_TYPES: Readonly<Record<string, string>> = {
  integer: 'number',
  number: 'number',
  boolean: 'checkbox',
  text: 'text',
  color: 'color',
};

/** Identifiant du porte-message d'erreur associé à un champ. */
function errorIdOf(selector: string): string {
  return `${selector.replace(/^#/, '')}-error`;
}

/** Construit le contrôle correspondant au genre du descripteur. */
function createControl(source: Document, field: AdminField): HTMLElement {
  if (field.kind === 'enum') {
    const select = source.createElement('select');
    select.className = 'field__input';
    select.id = field.selector.replace(/^#/, '');

    for (const option of field.options ?? []) {
      const element = source.createElement('option');
      element.value = option;
      setText(element, option, 64);
      select.append(element);
    }

    return select;
  }

  const input = source.createElement('input');
  input.className = 'field__input';
  input.id = field.selector.replace(/^#/, '');
  input.type = INPUT_TYPES[field.kind] ?? 'text';
  // Rien de ce qui est ici n'a vocation à être complété par le navigateur :
  // ce sont des réglages, pas une identité.
  input.autocomplete = 'off';

  if (field.kind === 'integer' || field.kind === 'number') {
    // Le navigateur ne s'en sert que pour ses flèches et son incrément. La
    // validation qui compte reste celle de `form-binding`, puis celle de Zod.
    if (field.min !== undefined) {
      input.min = String(field.min);
    }
    if (field.max !== undefined) {
      input.max = String(field.max);
    }
    input.step = field.kind === 'integer' ? '1' : 'any';
  }

  return input;
}

/**
 * Peint les champs, regroupés sous leurs titres.
 *
 * Le conteneur est **remplacé** et non complété : les vues se rechargent après
 * chaque enregistrement, et empiler dupliquerait les champs à chaque
 * sauvegarde.
 */
export function renderFieldGroups(
  source: Document,
  container: Element,
  fields: readonly AdminField[],
  groups: readonly string[],
): void {
  container.replaceChildren();

  for (const group of groups) {
    const members = fields.filter((field) => groupOf(field.path) === group);
    if (members.length === 0) {
      continue;
    }

    const section = source.createElement('div');
    section.className = 'group';

    const title = source.createElement('h2');
    title.className = 'group__title';
    setText(title, group, 80);
    section.append(title);

    const grid = source.createElement('div');
    grid.className = 'group__fields';

    for (const field of members) {
      const isSwitch = field.kind === 'boolean';

      const wrapper = source.createElement('label');
      wrapper.className = isSwitch ? 'field field--switch' : 'field';

      const label = source.createElement('span');
      label.className = 'field__label';
      setText(label, field.label, 120);

      const control = createControl(source, field);

      // La case précède son libellé, le reste le suit : c'est la disposition
      // que tout le monde attend, et l'inverser fait hésiter au clic.
      if (isSwitch) {
        wrapper.append(control, label);
      } else {
        wrapper.append(label, control);
      }

      if (field.hint !== undefined) {
        const hint = source.createElement('span');
        hint.className = 'field__hint';
        setText(hint, field.hint, 240);
        wrapper.append(hint);
      }

      const error = source.createElement('span');
      error.className = 'field__error';
      error.id = errorIdOf(field.selector);
      wrapper.append(error);

      grid.append(wrapper);
    }

    section.append(grid);
    container.append(section);
  }
}

/**
 * Écrit les valeurs dans les champs.
 *
 * Une valeur visant un champ absent est ignorée : chaque vue ne rend que ses
 * propres champs, et lever ici obligerait l'appelant à filtrer avant d'appeler.
 */
export function writeFieldValues(
  container: ParentNode,
  fields: readonly AdminField[],
  values: Readonly<Record<string, RawValue>>,
): void {
  for (const field of fields) {
    const element = container.querySelector<HTMLInputElement | HTMLSelectElement>(field.selector);
    const value = values[field.selector];

    if (element === null || value === undefined) {
      continue;
    }

    if (typeof value === 'boolean') {
      (element as HTMLInputElement).checked = value;
    } else {
      element.value = value;
    }
  }
}

/**
 * Relit les champs présents dans le conteneur.
 *
 * Les champs absents sont **omis** plutôt que rendus vides : `patchFrom` ignore
 * ce qu'il ne reçoit pas, alors qu'il refuserait une chaîne vide. C'est ce qui
 * permet d'enregistrer une vue sans toucher aux réglages des autres.
 */
export function readFieldValues(
  container: ParentNode,
  fields: readonly AdminField[],
): Record<string, RawValue> {
  const values: Record<string, RawValue> = {};

  for (const field of fields) {
    const element = container.querySelector<HTMLInputElement | HTMLSelectElement>(field.selector);
    if (element === null) {
      continue;
    }

    values[field.selector] =
      field.kind === 'boolean' ? (element as HTMLInputElement).checked : element.value;
  }

  return values;
}

/** Affiche les messages sous les champs fautifs et les marque. */
export function showFieldErrors(container: ParentNode, errors: readonly FieldError[]): void {
  for (const error of errors) {
    const element = container.querySelector(error.selector);
    const holder = container.querySelector(`#${errorIdOf(error.selector)}`);

    element?.classList.add('field__input--invalid');
    if (holder !== null) {
      setText(holder, error.message, 200);
    }
  }
}

/**
 * Efface les messages et les marques.
 *
 * Sans cela, une erreur corrigée resterait affichée sous un champ redevenu
 * valide, et l'utilisateur chercherait un problème qui n'existe plus.
 */
export function clearFieldErrors(container: ParentNode, fields: readonly AdminField[]): void {
  for (const field of fields) {
    container.querySelector(field.selector)?.classList.remove('field__input--invalid');
    const holder = container.querySelector(`#${errorIdOf(field.selector)}`);
    if (holder !== null) {
      setText(holder, '');
    }
  }
}
