import { convertField, type FieldDescriptor, type FieldError, type RawValue } from './form-binding.js';

export type RewardCopy =
  | { readonly ok: true; readonly values: Record<string, RawValue> }
  | { readonly ok: false; readonly errors: readonly FieldError[] };

/**
 * Les valeurs à poser pour recopier un barème dans d'autres, feuille par feuille.
 *
 * Un barème est désigné par son préfixe de chemin. Une feuille absente de la cible — le Prime des
 * sub offerts — est ignorée, et une feuille absente de la source laisse la cible telle quelle.
 */
export function copyReward(
  fields: readonly FieldDescriptor[],
  raw: Readonly<Record<string, RawValue>>,
  sourcePrefix: string,
  targetPrefixes: readonly string[],
): RewardCopy {
  const values: Record<string, RawValue> = {};
  const errors: FieldError[] = [];

  for (const source of fields.filter((field) => field.path.startsWith(sourcePrefix))) {
    const value = raw[source.selector];
    if (value === undefined) {
      continue;
    }

    const converted = convertField(source, value);
    if (!converted.ok) {
      errors.push({ selector: source.selector, path: source.path, message: converted.message });
      continue;
    }

    const leaf = source.path.slice(sourcePrefix.length);
    const normalized = typeof value === 'string' ? value.trim() : value;

    for (const targetPrefix of targetPrefixes) {
      const target = fields.find((field) => field.path === `${targetPrefix}${leaf}`);
      if (target !== undefined) {
        values[target.selector] = normalized;
      }
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, values };
}

const VIEW_PREFIX_SEPARATOR = ' · ';

/** Le libellé du bouton de copie, à partir des noms des cartes visées, sans leur préfixe de vue. */
export function copyLabel(targetGroups: readonly string[]): string {
  const names = targetGroups.map((group) => group.split(VIEW_PREFIX_SEPARATOR).at(-1) ?? group);
  return `Copier vers ${names.join(' et ')}`;
}
