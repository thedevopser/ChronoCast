import { configSchema, type ChronoCastConfig } from './schema.js';

export const DEFAULT_CONFIG: ChronoCastConfig = deepFreeze(configSchema.parse({}));

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) {
    return value;
  }

  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }

  return Object.freeze(value);
}

export function createDefaultConfig(): ChronoCastConfig {
  return configSchema.parse({});
}
