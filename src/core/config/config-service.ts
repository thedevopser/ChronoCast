/**
 * Service de configuration : seul point d'écriture des réglages.
 *
 * Il assure trois garanties que l'interface d'administration ne peut pas offrir
 * seule :
 *
 *   - **une configuration invalide n'est jamais persistée** — la validation
 *     précède l'écriture, et l'état en mémoire n'avance que si le disque a suivi ;
 *   - **une mise à jour partielle n'efface jamais les réglages voisins** — changer
 *     la taille de police de l'overlay ne doit pas réinitialiser le barème ;
 *   - **un fichier importé est validé avant d'être appliqué** — c'est une entrée
 *     utilisateur, donc une surface d'attaque.
 */

import type { Logger } from '../logging/logger.js';
import type { AtomicJsonStore } from '../storage/atomic-json-store.js';
import { createDefaultConfig } from './defaults.js';
import { CONFIG_SCHEMA_VERSION, configSchema, type ChronoCastConfig } from './schema.js';

/** Indentation du fichier exporté : il doit rester relisible et modifiable à la main. */
const EXPORT_INDENTATION = 2;

/**
 * Clés interdites dans toute entrée externe.
 *
 * Le schéma les écarterait déjà, mais elles sont neutralisées avant même la
 * validation : une charge utile hostile ne doit jamais atteindre les entrailles
 * de la bibliothèque de validation.
 */
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

/** Le service a été interrogé avant d'avoir chargé sa configuration. */
export class ConfigNotLoadedError extends Error {
  public override readonly name = 'ConfigNotLoadedError';

  public constructor() {
    super('configuration non chargée : appelez load() avant get()');
  }
}

/** Le contenu proposé à l'import n'est pas une configuration exploitable. */
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

/** Mise à jour partielle : toute branche peut être omise. */
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
  /** Charge, valide, migre si besoin, puis expose la configuration. */
  load(): Promise<ChronoCastConfig>;

  /**
   * Configuration courante.
   * @throws ConfigNotLoadedError si {@link load} n'a pas encore abouti.
   */
  get(): ChronoCastConfig;

  /** Fusionne une modification partielle, valide, persiste et notifie. */
  update(patch: DeepPartial<ChronoCastConfig>): Promise<ChronoCastConfig>;

  /** Sérialise la configuration courante pour l'export. */
  export(): string;

  /**
   * Remplace la configuration par le contenu d'un fichier importé.
   * @throws ConfigImportError si le contenu est inexploitable.
   */
  import(serialized: string): Promise<ChronoCastConfig>;

  /** S'abonne aux changements. Renvoie de quoi se désabonner. */
  onChange(listener: ConfigChangeListener): Unsubscribe;
}

export interface ConfigServiceOptions {
  readonly store: AtomicJsonStore<ChronoCastConfig>;
  readonly logger: Logger;
}

/** Vrai si la valeur est un objet ordinaire, à l'exclusion des tableaux. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Retire récursivement les clés dangereuses d'une valeur d'origine externe.
 *
 * `JSON.parse` sait produire une propriété littérale `__proto__` ; la recopier
 * dans un objet par affectation redéfinirait le prototype.
 */
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

  // Reconversion en objet ordinaire : la validation manipule des objets normaux.
  return { ...result };
}

/**
 * Fusionne récursivement une modification partielle dans une base.
 *
 * Les tableaux sont **remplacés** et non fusionnés : combiner deux barèmes de
 * bits par index produirait un barème hybride que personne n'a demandé.
 */
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

/** Messages de validation, aplatis pour être affichés à l'utilisateur. */
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
        // Un abonné défaillant ne doit pas empêcher les suivants d'être avertis
        // ni faire échouer l'enregistrement qui vient d'aboutir.
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

      // Une version antérieure est réécrite immédiatement : la configuration sur
      // le disque doit refléter ce que l'application manipule réellement, sans
      // quoi la migration serait rejouée à chaque démarrage.
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
          // Migration non persistée : l'application fonctionne avec la version
          // en mémoire et retentera au prochain démarrage.
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

      // L'écriture précède la mise à jour de l'état en mémoire : si la
      // persistance échoue, l'utilisateur ne doit pas voir une valeur qu'il
      // croirait enregistrée alors qu'elle sera perdue au redémarrage.
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
