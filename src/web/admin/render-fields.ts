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

function errorIdOf(selector: string): string {
  return `${selector.replace(/^#/, '')}-error`;
}

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
  input.autocomplete = 'off';

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
