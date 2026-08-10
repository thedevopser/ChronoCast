import type { Logger } from '../logging/logger.js';
import type { AtomicJsonStore } from '../storage/atomic-json-store.js';
import { createDefaultConfig } from './defaults.js';
import { CONFIG_SCHEMA_VERSION, configSchema, type ChronoCastConfig } from './schema.js';

const EXPORT_INDENTATION = 2;

const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

export class ConfigNotLoadedError extends Error {
  public override readonly name = 'ConfigNotLoadedError';

  public constructor() {
    super('configuration non chargée : appelez load() avant get()');
  }
}

export class ConfigImportError extends Error {
  public override readonly name = 'ConfigImportError';

  public constructor(
    message: string,
    public readonly details: readonly string[] = [],
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
  }
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[]
    ? T[K]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

export type ConfigChangeListener = (config: ChronoCastConfig) => void;
export type Unsubscribe = () => void;

export interface ConfigService {
  load(): Promise<ChronoCastConfig>;

  get(): ChronoCastConfig;

  update(patch: DeepPartial<ChronoCastConfig>): Promise<ChronoCastConfig>;

  export(): string;

  import(serialized: string): Promise<ChronoCastConfig>;

  onChange(listener: ConfigChangeListener): Unsubscribe;
}

export interface ConfigServiceOptions {
  readonly store: AtomicJsonStore<ChronoCastConfig>;
  readonly logger: Logger;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitize);
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) {
      continue;
    }
    result[key] = sanitize(entry);
  }

  return { ...result };
}

function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(patch)) {
    return patch;
  }

  const source = isPlainObject(base) ? base : {};
  const result: Record<string, unknown> = { ...source };

  for (const [key, value] of Object.entries(patch)) {
    if (FORBIDDEN_KEYS.has(key) || value === undefined) {
      continue;
    }
    result[key] = isPlainObject(value) ? deepMerge(source[key], value) : value;
  }

  return result;
}

function describeIssues(error: unknown): string[] {
  if (typeof error !== 'object' || error === null || !('issues' in error)) {
    return [];
  }

  const issues = (error as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) {
    return [];
  }

  return issues.map((issue: unknown) => {
    if (typeof issue !== 'object' || issue === null) {
      return String(issue);
    }
    const path = 'path' in issue && Array.isArray(issue.path) ? issue.path.join('.') : '';
    const message = 'message' in issue ? String(issue.message) : 'valeur invalide';
    return path === '' ? message : `${path} : ${message}`;
  });
}

export function createConfigService(options: ConfigServiceOptions): ConfigService {
  const { store, logger } = options;

  let current: ChronoCastConfig | undefined;
  const listeners = new Set<ConfigChangeListener>();

  function requireLoaded(): ChronoCastConfig {
    if (current === undefined) {
      throw new ConfigNotLoadedError();
    }
    return current;
  }

  function notify(config: ChronoCastConfig): void {
    for (const listener of [...listeners]) {
      try {
        listener(config);
      } catch (error) {
        logger.error('abonné à la configuration en échec', { cause: error });
      }
    }
  }

  return {
    async load(): Promise<ChronoCastConfig> {
      const raw = await store.read();
      const sanitized = sanitize(raw);

      const parsed = configSchema.safeParse(sanitized);

      if (!parsed.success) {
        logger.error('configuration invalide, retour aux valeurs par défaut', {
          issues: describeIssues(parsed.error),
        });
        current = createDefaultConfig();
        return current;
      }

      const previousVersion =
        isPlainObject(sanitized) && typeof sanitized['schemaVersion'] === 'number'
          ? sanitized['schemaVersion']
          : undefined;

      current = parsed.data;

      if (previousVersion !== CONFIG_SCHEMA_VERSION) {
        const migrated: ChronoCastConfig = { ...current, schemaVersion: CONFIG_SCHEMA_VERSION };
        try {
          await store.write(migrated);
          current = migrated;
          logger.info('configuration migrée', {
            from: previousVersion ?? 'inconnue',
            to: CONFIG_SCHEMA_VERSION,
          });
        } catch (error) {
          logger.warning('migration de configuration non persistée', { cause: error });
          current = migrated;
        }
      }

      return current;
    },

    get(): ChronoCastConfig {
      return requireLoaded();
    },

    async update(patch: DeepPartial<ChronoCastConfig>): Promise<ChronoCastConfig> {
      const base = requireLoaded();
      const merged = deepMerge(base, sanitize(patch));

      const parsed = configSchema.safeParse(merged);
      if (!parsed.success) {
        const details = describeIssues(parsed.error);
        logger.warning('mise à jour de configuration refusée', { issues: details });
        throw new ConfigImportError('configuration invalide', details, parsed.error);
      }

      await store.write(parsed.data);
      current = parsed.data;

      notify(current);
      return current;
    },

    export(): string {
      return JSON.stringify(requireLoaded(), null, EXPORT_INDENTATION);
    },

    async import(serialized: string): Promise<ChronoCastConfig> {
      requireLoaded();

      let decoded: unknown;
      try {
        decoded = JSON.parse(serialized);
      } catch (error) {
        throw new ConfigImportError('fichier JSON illisible', [], error);
      }

      const parsed = configSchema.safeParse(sanitize(decoded));
      if (!parsed.success) {
        const details = describeIssues(parsed.error);
        logger.warning('import de configuration refusé', { issues: details });
        throw new ConfigImportError('configuration importée invalide', details, parsed.error);
      }

      const imported: ChronoCastConfig = { ...parsed.data, schemaVersion: CONFIG_SCHEMA_VERSION };
      await store.write(imported);
      current = imported;

      logger.info('configuration importée');
      notify(current);
      return current;
    },

    onChange(listener: ConfigChangeListener): Unsubscribe {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
