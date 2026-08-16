import type { AdminField } from './fields.js';
import { groupOf } from './fields.js';
import type { FieldError, RawValue } from './form-binding.js';
import { setText } from '../shared/safe-dom.js';

const INPUT_TYPES: Readonly<Record<string, string>> = {
  integer: 'number',
  number: 'number',
  boolean: 'checkbox',
  text: 'text',
  color: 'color',
};

export interface RenderOptions {
  /** Rend chaque groupe en `<details>`, natif et sans JS — la vue Apparence en aligne huit. */
  readonly collapsible?: boolean;
}

function idOf(selector: string): string {
  return selector.replace(/^#/, '');
}

function errorIdOf(selector: string): string {
  return `${idOf(selector)}-error`;
}

function rangeIdOf(selector: string): string {
  return `${idOf(selector)}-range`;
}

function classOf(field: AdminField): string {
  return field.readOnly === true ? 'field__input field__input--locked' : 'field__input';
}

function hasSlider(field: AdminField): boolean {
  return field.slider === true && field.min !== undefined && field.max !== undefined;
}

function stepOf(field: AdminField): string {
  if (field.kind === 'integer') {
    return '1';
  }

  const span = (field.max ?? 1) - (field.min ?? 0);
  return span <= 2 ? '0.01' : '0.1';
}

function createNumericInput(source: Document, field: AdminField): HTMLInputElement {
  const input = source.createElement('input');
  input.className = classOf(field);
  input.id = idOf(field.selector);
  input.type = INPUT_TYPES[field.kind] ?? 'text';
  input.autocomplete = 'off';
  input.readOnly = field.readOnly === true;

  if (field.kind === 'integer' || field.kind === 'number') {
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

// Le curseur n'est qu'un pilote : le champ chiffré garde le sélecteur du descripteur, si bien que
// readFieldValues, writeFieldValues et patchFrom n'ont rien à savoir de lui.
function createSliderPair(source: Document, field: AdminField): HTMLElement {
  const wrapper = source.createElement('div');
  wrapper.className = 'field__control';

  const range = source.createElement('input');
  range.className = 'field__range';
  range.id = rangeIdOf(field.selector);
  range.type = 'range';
  range.min = String(field.min);
  range.max = String(field.max);
  range.step = stepOf(field);
  range.disabled = field.readOnly === true;

  const input = createNumericInput(source, field);

  range.addEventListener('input', () => {
    input.value = range.value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

  input.addEventListener('input', () => {
    range.value = input.value;
  });

  wrapper.append(range, input);

  if (field.unit !== undefined) {
    const unit = source.createElement('span');
    unit.className = 'field__unit';
    setText(unit, field.unit, 8);
    wrapper.append(unit);
  }

  return wrapper;
}

function createControl(source: Document, field: AdminField): HTMLElement {
  if (field.kind === 'enum') {
    const select = source.createElement('select');
    select.className = classOf(field);
    select.id = idOf(field.selector);

    for (const option of field.options ?? []) {
      const element = source.createElement('option');
      element.value = option;
      setText(element, option, 64);
      select.append(element);
    }

    select.disabled = field.readOnly === true;

    return select;
  }

  if (hasSlider(field)) {
    return createSliderPair(source, field);
  }

  return createNumericInput(source, field);
}

function createSection(source: Document, group: string, options: RenderOptions): {
  section: HTMLElement;
  grid: HTMLElement;
} {
  const collapsible = options.collapsible === true;

  const section = source.createElement(collapsible ? 'details' : 'div');
  section.className = 'group';
  if (collapsible) {
    (section as HTMLDetailsElement).open = true;
  }

  const title = source.createElement(collapsible ? 'summary' : 'h2');
  title.className = 'group__title';
  setText(title, group, 80);
  section.append(title);

  const grid = source.createElement('div');
  grid.className = 'group__fields';

  return { section, grid };
}

export function renderFieldGroups(
  source: Document,
  container: Element,
  fields: readonly AdminField[],
  groups: readonly string[],
  options: RenderOptions = {},
): void {
  container.replaceChildren();

  for (const group of groups) {
    const members = fields.filter((field) => groupOf(field.path) === group);
    if (members.length === 0) {
      continue;
    }

    const { section, grid } = createSection(source, group, options);
    section.dataset['group'] = group;

    for (const field of members) {
      const isSwitch = field.kind === 'boolean';

      const wrapper = source.createElement('label');
      wrapper.className = isSwitch ? 'field field--switch' : 'field';
      if (hasSlider(field)) {
        wrapper.classList.add('field--slider');
      }

      const label = source.createElement('span');
      label.className = 'field__label';
      setText(label, field.label, 120);

      const control = createControl(source, field);

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

export function setGroupsCollapsed(container: ParentNode, collapsed: readonly string[]): void {
  const shut = new Set(collapsed);

  for (const section of container.querySelectorAll<HTMLDetailsElement>('details.group')) {
    const group = section.dataset['group'];
    section.open = group === undefined || !shut.has(group);
  }
}

/**
 * Marque les réglages qu'aucun interrupteur n'active plus. **Visuel seulement** : les désactiver
 * empêcherait de préparer une valeur avant d'allumer l'effet, ce qui est le geste naturel.
 */
export function setMutedFields(
  container: ParentNode,
  fields: readonly AdminField[],
  muted: readonly string[],
): void {
  const isMuted = new Set(muted);

  for (const field of fields) {
    const element = container.querySelector(field.selector);
    if (element === null) {
      continue;
    }

    const off = isMuted.has(field.selector);
    element.closest('.field')?.classList.toggle('field--muted', off);

    if (off) {
      element.setAttribute('aria-disabled', 'true');
    } else {
      element.removeAttribute('aria-disabled');
    }
  }
}

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

      const range = container.querySelector<HTMLInputElement>(`#${rangeIdOf(field.selector)}`);
      if (range !== null) {
        range.value = value;
      }
    }
  }
}

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

export function clearFieldErrors(container: ParentNode, fields: readonly AdminField[]): void {
  for (const field of fields) {
    container.querySelector(field.selector)?.classList.remove('field__input--invalid');
    const holder = container.querySelector(`#${errorIdOf(field.selector)}`);
    if (holder !== null) {
      setText(holder, '');
    }
  }
}
