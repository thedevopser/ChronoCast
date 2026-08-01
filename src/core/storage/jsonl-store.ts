/**
 * Journal append-only au format JSONL, avec rotation quotidienne.
 *
 * L'historique des événements et les logs sont des flux : on y ajoute sans cesse,
 * on ne modifie jamais. Le format JSONL — une entrée JSON par ligne — est le seul
 * qui rende l'ajout naturellement résistant à une coupure de courant : une ligne
 * tronquée en fin de fichier est simplement ignorée à la relecture, sans
 * compromettre les précédentes. Un tableau JSON unique, lui, deviendrait
 * intégralement illisible.
 *
 * La rotation est quotidienne parce qu'elle rend la purge triviale : supprimer un
 * jour revient à supprimer un fichier, sans jamais réécrire les autres.
 */

import { appendFile, mkdir, readFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import type { Logger } from '../logging/logger.js';

/** Extension des fichiers de journal. */
const EXTENSION = '.jsonl';

/** Millisecondes dans une journée, pour le calcul de rétention. */
const MILLISECONDS_PER_DAY = 86_400_000;

export interface JsonlStore<T> {
  /** Ajoute une entrée au fichier du jour. */
  append(entry: T): Promise<void>;

  /** Relit toutes les entrées conservées, dans l'ordre chronologique. */
  readAll(): Promise<T[]>;

  /** Relit les `count` dernières entrées, dans l'ordre chronologique. */
  tail(count: number): Promise<T[]>;

  /** Supprime les fichiers dépassant la rétention. Renvoie leur nombre. */
  purge(): Promise<number>;
}

export interface JsonlStoreOptions<T> {
  readonly directory: string;

  /** Préfixe des fichiers, complété par la date : `events-2026-08-01.jsonl`. */
  readonly baseName: string;

  /**
   * Valide et convertit une ligne décodée.
   * Doit lever si la forme est invalide — la ligne est alors écartée.
   */
  readonly parse: (raw: unknown) => T;

  readonly logger: Logger;

  /** Nombre de jours conservés par {@link JsonlStore.purge}. */
  readonly retentionDays: number;

  /** Source de date, injectée pour rendre les tests déterministes. */
  readonly now?: () => Date;
}

/** Vrai si l'erreur signale un fichier ou un répertoire absent. */
function isFileNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

/** Partie date d'un nom de fichier, au format `YYYY-MM-DD`. */
function formatDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function createJsonlStore<T>(options: JsonlStoreOptions<T>): JsonlStore<T> {
  const { directory, baseName, parse, logger, retentionDays } = options;
  const now = options.now ?? (() => new Date());

  /** Motif des fichiers gérés par ce magasin, pour ignorer tout fichier étranger. */
  const filePattern = new RegExp(`^${baseName}-(\\d{4}-\\d{2}-\\d{2})\\${EXTENSION}$`);

  /**
   * File d'attente des ajouts.
   *
   * Un `appendFile` concurrent peut entrelacer deux écritures et produire une
   * ligne composite illisible. Les enchaîner l'interdit.
   */
  let appendQueue: Promise<void> = Promise.resolve();

  function filePathFor(date: Date): string {
    return join(directory, `${baseName}-${formatDay(date)}${EXTENSION}`);
  }

  /** Noms des fichiers du magasin, triés par date croissante. */
  async function listFiles(): Promise<string[]> {
    let entries: string[];
    try {
      entries = await readdir(directory);
    } catch (error) {
      if (isFileNotFound(error)) {
        return [];
      }
      logger.warning('répertoire de journal illisible', { directory, cause: error });
      return [];
    }

    // Le format ISO rend le tri lexicographique équivalent au tri chronologique.
    return entries.filter((entry) => filePattern.test(entry)).sort();
  }

  /**
   * Décode un fichier, en écartant les lignes inexploitables.
   *
   * Une ligne fautive n'invalide jamais le reste : c'est précisément ce qui rend
   * ce format utilisable après un arrêt brutal.
   */
  async function readFileEntries(fileName: string): Promise<T[]> {
    const path = join(directory, fileName);

    let content: string;
    try {
      content = await readFile(path, 'utf8');
    } catch (error) {
      if (!isFileNotFound(error)) {
        logger.warning('fichier de journal illisible', { path, cause: error });
      }
      return [];
    }

    const entries: T[] = [];
    let skipped = 0;

    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '') {
        continue;
      }

      try {
        entries.push(parse(JSON.parse(trimmed)));
      } catch {
        skipped += 1;
      }
    }

    if (skipped > 0) {
      logger.warning('lignes de journal écartées', { path, count: skipped });
    }

    return entries;
  }

  async function performAppend(entry: T): Promise<void> {
    const path = filePathFor(now());

    // Sérialisation sur une seule ligne : un saut de ligne dans le JSON casserait
    // le format et rendrait l'entrée indissociable de la suivante.
    const line = `${JSON.stringify(entry)}\n`;

    try {
      await appendFile(path, line, 'utf8');
    } catch (error) {
      if (!isFileNotFound(error)) {
        logger.error('ajout au journal impossible', { path, cause: error });
        return;
      }

      // Répertoire absent : on le crée puis on retente une fois. Créer le
      // répertoire à chaque ajout coûterait un appel système inutile.
      try {
        await mkdir(directory, { recursive: true });
        await appendFile(path, line, 'utf8');
      } catch (retryError) {
        logger.error('ajout au journal impossible après création du répertoire', {
          path,
          cause: retryError,
        });
      }
    }
  }

  return {
    async append(entry: T): Promise<void> {
      // Un échec d'ajout est journalisé, jamais propagé : perdre une ligne
      // d'historique ne doit pas interrompre le traitement d'un événement Twitch.
      const queued = appendQueue.then(
        () => performAppend(entry),
        () => performAppend(entry),
      );
      appendQueue = queued.catch(() => undefined);
      return queued;
    },

    async readAll(): Promise<T[]> {
      const files = await listFiles();
      const entries: T[] = [];

      for (const file of files) {
        entries.push(...(await readFileEntries(file)));
      }

      return entries;
    },

    async tail(count: number): Promise<T[]> {
      if (count <= 0) {
        return [];
      }

      const files = await listFiles();
      const collected: T[] = [];

      // Remontée du plus récent au plus ancien : inutile de décoder l'intégralité
      // de l'historique pour afficher les vingt dernières lignes dans l'admin.
      for (let index = files.length - 1; index >= 0 && collected.length < count; index -= 1) {
        const file = files[index];
        if (file === undefined) {
          continue;
        }
        collected.unshift(...(await readFileEntries(file)));
      }

      return collected.slice(-count);
    },

    async purge(): Promise<number> {
      const files = await listFiles();
      const threshold = now().getTime() - retentionDays * MILLISECONDS_PER_DAY;
      const currentFileDay = formatDay(now());
      let removed = 0;

      for (const file of files) {
        const match = filePattern.exec(file);
        const day = match?.[1];
        if (day === undefined) {
          continue;
        }

        // Le fichier du jour est toujours conservé : une rétention nulle ne doit
        // pas effacer ce qui vient d'être écrit.
        if (day === currentFileDay) {
          continue;
        }

        const dayTime = Date.parse(`${day}T00:00:00.000Z`);
        if (Number.isNaN(dayTime) || dayTime >= threshold) {
          continue;
        }

        try {
          await unlink(join(directory, file));
          removed += 1;
        } catch (error) {
          logger.warning('suppression de journal impossible', { file, cause: error });
        }
      }

      if (removed > 0) {
        logger.info('journaux purgés', { count: removed, retentionDays });
      }

      return removed;
    },
  };
}
