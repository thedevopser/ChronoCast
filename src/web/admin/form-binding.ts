export type FieldKind = 'integer' | 'number' | 'boolean' | 'text' | 'enum' | 'color';

export interface FieldDescriptor {
  readonly selector: string;
  readonly path: string;
  readonly kind: FieldKind;
  readonly min?: number;
  readonly max?: number;
  readonly options?: readonly string[];

  readonly allowEmpty?: boolean;
}

export type RawValue = string | boolean;

export interface FieldError {
  readonly selector: string;
  readonly path: string;
  readonly message: string;
}

export interface PatchResult {
  readonly patch: Record<string, unknown>;
  readonly errors: readonly FieldError[];
}

const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function segmentsOf(path: string): string[] {
  const segments = path.split('.');

  if (segments.length === 0 || segments.some((segment) => segment === '')) {
    throw new Error(`chemin de configuration malformé : ${path}`);
  }

  return segments;
}

export function readAtPath(source: unknown, path: string): unknown {
  let current: unknown = source;

  for (const segment of segmentsOf(path)) {
    if (!isPlainObject(current) || !Object.hasOwn(current, segment)) {
      return undefined;
    }
    current = current[segment];
  }

  return current;
}

export function writeAtPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = segmentsOf(path);

  if (segments.some((segment) => FORBIDDEN_SEGMENTS.has(segment))) {
    throw new Error(`segment de chemin interdit : ${path}`);
  }

  const leaf = segments.pop();
  if (leaf === undefined) {
    throw new Error(`chemin de configuration malformé : ${path}`);
  }

  let current = target;

  for (const segment of segments) {
    const next = current[segment];
    if (!isPlainObject(next)) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }

  current[leaf] = value;
}

export function valuesFrom(
  descriptors: readonly FieldDescriptor[],
  config: unknown,
): Record<string, RawValue> {
  const values: Record<string, RawValue> = {};

  for (const descriptor of descriptors) {
    const value = readAtPath(config, descriptor.path);

    if (typeof value === 'boolean') {
      values[descriptor.selector] = value;
    } else if (typeof value === 'number' || typeof value === 'string') {
      values[descriptor.selector] = String(value);
    }
  }

  return values;
}

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

const INTEGER = /^-?\d+$/;

type Converted = { ok: true; value: unknown } | { ok: false; message: string };

function withinBounds(value: number, descriptor: FieldDescriptor): Converted {
  if (descriptor.min !== undefined && value < descriptor.min) {
    return { ok: false, message: `Valeur minimale : ${String(descriptor.min)}.` };
  }
  if (descriptor.max !== undefined && value > descriptor.max) {
    return { ok: false, message: `Valeur maximale : ${String(descriptor.max)}.` };
  }
  return { ok: true, value };
}

function convert(descriptor: FieldDescriptor, raw: RawValue): Converted {
  if (descriptor.kind === 'boolean') {
    return typeof raw === 'boolean'
      ? { ok: true, value: raw }
      : { ok: false, message: 'Case à cocher attendue.' };
  }

  if (typeof raw === 'boolean') {
    return { ok: false, message: 'Valeur texte attendue.' };
  }

  const text = raw.trim();

  switch (descriptor.kind) {
    case 'integer': {
      if (!INTEGER.test(text)) {
        return { ok: false, message: 'Nombre entier attendu.' };
      }
      return withinBounds(Number(text), descriptor);
    }

    case 'number': {
      const normalized = text.replace(',', '.');
      const value = Number(normalized);
      if (normalized === '' || !Number.isFinite(value)) {
        return { ok: false, message: 'Nombre attendu.' };
      }
      return withinBounds(value, descriptor);
    }

    case 'color':
      return HEX_COLOR.test(text)
        ? { ok: true, value: text }
        : { ok: false, message: 'Couleur hexadécimale attendue, par exemple #FFCC00.' };

    case 'enum':
      return descriptor.options?.includes(text) === true
        ? { ok: true, value: text }
        : { ok: false, message: 'Valeur hors des choix proposés.' };

    case 'text':
      return text === '' && descriptor.allowEmpty !== true
        ? { ok: false, message: 'Ce champ ne peut pas rester vide.' }
        : { ok: true, value: text };
  }
}

export function patchFrom(
  descriptors: readonly FieldDescriptor[],
  raw: Readonly<Record<string, RawValue>>,
  config: unknown,
): PatchResult {
  const patch: Record<string, unknown> = {};
  const errors: FieldError[] = [];

  for (const descriptor of descriptors) {
    const value = raw[descriptor.selector];

    if (value === undefined) {
      continue;
    }

    const converted = convert(descriptor, value);

    if (!converted.ok) {
      errors.push({
        selector: descriptor.selector,
        path: descriptor.path,
        message: converted.message,
      });
      continue;
    }

    if (converted.value !== readAtPath(config, descriptor.path)) {
      writeAtPath(patch, descriptor.path, converted.value);
    }
  }

  return errors.length > 0 ? { patch: {}, errors } : { patch, errors };
}
