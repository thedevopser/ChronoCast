/**
 * Configuration par défaut de ChronoCast.
 *
 * Elle n'est pas recopiée à la main : elle est **dérivée du schéma**, en le
 * validant sur un objet vide. Chaque champ portant son propre défaut, le résultat
 * est nécessairement complet et cohérent.
 *
 * L'intérêt est qu'aucune divergence n'est possible. Une liste tenue en parallèle
 * finirait immanquablement par diverger du schéma lors de l'ajout d'un réglage,
 * et la valeur par défaut annoncée ne serait plus celle réellement appliquée.
 */

import { configSchema, type ChronoCastConfig } from './schema.js';

/**
 * Configuration appliquée au premier démarrage, et socle de complétion de toute
 * configuration partielle.
 *
 * Gelée en profondeur : ces valeurs servent de référence à travers toute
 * l'application et une mutation accidentelle contaminerait silencieusement
 * chaque installation.
 */
export const DEFAULT_CONFIG: ChronoCastConfig = deepFreeze(configSchema.parse({}));

/** Gèle récursivement un objet et tout ce qu'il contient. */
function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) {
    return value;
  }

  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }

  return Object.freeze(value);
}

/** Copie modifiable de la configuration par défaut. */
export function createDefaultConfig(): ChronoCastConfig {
  return configSchema.parse({});
}
