import type { FieldDescriptor, RawValue } from './form-binding.js';
import { convertField, readAtPath, writeAtPath } from './form-binding.js';
import type { OverlayConfig } from '../shared/protocol.js';

const OVERLAY_PREFIX = 'overlay.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Compose un sous-arbre de configuration tel qu'il serait enregistré, sans l'enregistrer.
 *
 * Un champ invalide, vide ou hors bornes **retombe sur la valeur enregistrée** au lieu de faire
 * échouer l'ensemble comme le fait `patchFrom` : on prévisualise à chaque frappe, et une saisie en
 * cours passe forcément par des états intermédiaires que personne ne veut voir clignoter.
 *
 * Le préfixe désigne le sous-arbre — `overlay.` pour le compteur, `goals.overlay.` pour la barre
 * d'objectif — et les deux pages servies à OBS s'aperçoivent ainsi du même mécanisme.
 */
export function draftSubtree(
  prefix: string,
  fields: readonly FieldDescriptor[],
  values: Readonly<Record<string, RawValue>>,
  config: unknown,
): Record<string, unknown> | null {
  const path = prefix.replace(/\.$/, '');

  const saved = readAtPath(config, path);
  if (!isRecord(saved)) {
    return null;
  }

  const draft: Record<string, unknown> = {};
  writeAtPath(draft, path, structuredClone(saved));

  for (const field of fields) {
    if (!field.path.startsWith(prefix)) {
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

  return readAtPath(draft, path) as Record<string, unknown>;
}

export function draftOverlayConfig(
  fields: readonly FieldDescriptor[],
  values: Readonly<Record<string, RawValue>>,
  config: unknown,
): OverlayConfig | null {
  return draftSubtree(OVERLAY_PREFIX, fields, values, config) as OverlayConfig | null;
}
