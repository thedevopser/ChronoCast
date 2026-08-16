import type { FieldDescriptor, RawValue } from './form-binding.js';
import { convertField, readAtPath, writeAtPath } from './form-binding.js';
import type { OverlayConfig } from '../shared/protocol.js';

const OVERLAY_PREFIX = 'overlay.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Compose le sous-arbre `overlay` tel qu'il serait enregistré, sans l'enregistrer.
 *
 * Un champ invalide, vide ou hors bornes **retombe sur la valeur enregistrée** au lieu de faire
 * échouer l'ensemble comme le fait `patchFrom` : on prévisualise à chaque frappe, et une saisie en
 * cours passe forcément par des états intermédiaires que personne ne veut voir clignoter.
 */
export function draftOverlayConfig(
  fields: readonly FieldDescriptor[],
  values: Readonly<Record<string, RawValue>>,
  config: unknown,
): OverlayConfig | null {
  const saved = isRecord(config) ? config['overlay'] : undefined;
  if (!isRecord(saved)) {
    return null;
  }

  const draft = { overlay: structuredClone(saved) };

  for (const field of fields) {
    if (!field.path.startsWith(OVERLAY_PREFIX)) {
      continue;
    }

    const raw = values[field.selector];
    if (raw === undefined) {
      continue;
    }

    const converted = convertField(field, raw);
    if (converted.ok && converted.value !== readAtPath(draft, field.path)) {
      writeAtPath(draft, field.path, converted.value);
    }
  }

  return draft.overlay as unknown as OverlayConfig;
}
