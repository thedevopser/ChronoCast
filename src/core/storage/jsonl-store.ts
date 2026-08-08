import { appendFile, mkdir, readFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import type { Logger } from '../logging/logger.js';

const EXTENSION = '.jsonl';

const MILLISECONDS_PER_DAY = 86_400_000;

export interface JsonlStore<T> {
  append(entry: T): Promise<void>;

  readAll(): Promise<T[]>;

  tail(count: number): Promise<T[]>;

  purge(): Promise<number>;
}

export interface JsonlStoreOptions<T> {
  readonly directory: string;

  readonly baseName: string;

  readonly parse: (raw: unknown) => T;

  readonly logger: Logger;

  readonly retentionDays: number;

  readonly now?: () => Date;
}

function isFileNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

function formatDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function createJsonlStore<T>(options: JsonlStoreOptions<T>): JsonlStore<T> {
  const { directory, baseName, parse, logger, retentionDays } = options;
  const now = options.now ?? (() => new Date());

  const filePattern = new RegExp(`^${baseName}-(\\d{4}-\\d{2}-\\d{2})\\${EXTENSION}$`);

  let appendQueue: Promise<void> = Promise.resolve();

  function filePathFor(date: Date): string {
    return join(directory, `${baseName}-${formatDay(date)}${EXTENSION}`);
  }

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

    return entries.filter((entry) => filePattern.test(entry)).sort();
  }

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

    const line = `${JSON.stringify(entry)}\n`;

    try {
      await appendFile(path, line, 'utf8');
    } catch (error) {
      if (!isFileNotFound(error)) {
        logger.error('ajout au journal impossible', { path, cause: error });
        return;
      }

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
