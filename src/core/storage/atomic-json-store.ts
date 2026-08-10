import { constants } from 'node:fs';
import { copyFile, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { Logger } from '../logging/logger.js';

const BACKUP_SUFFIX = '.bak';

const TEMPORARY_SUFFIX = '.tmp';

const JSON_INDENTATION = 2;

export class StoreWriteError extends Error {
  public override readonly name = 'StoreWriteError';

  public constructor(
    public readonly filePath: string,
    cause: unknown,
  ) {
    super(`écriture impossible dans ${filePath}`, { cause });
  }
}

export interface AtomicJsonStore<T> {
  readonly filePath: string;

  read(): Promise<T>;

  write(value: T): Promise<void>;
}

export interface AtomicJsonStoreOptions<T> {
  readonly filePath: string;

  readonly parse: (raw: unknown) => T;

  readonly createDefault: () => T;

  readonly logger: Logger;
}

function isFileNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

async function syncDirectory(directoryPath: string): Promise<void> {
  try {
    const handle = await open(directoryPath, constants.O_RDONLY);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // La synchronisation du répertoire n'est pas prise en charge partout.
  }
}

export function createAtomicJsonStore<T>(options: AtomicJsonStoreOptions<T>): AtomicJsonStore<T> {
  const { filePath, parse, createDefault, logger } = options;
  const backupPath = `${filePath}${BACKUP_SUFFIX}`;
  const temporaryPath = `${filePath}${TEMPORARY_SUFFIX}`;
  const directoryPath = dirname(filePath);

  let writeQueue: Promise<void> = Promise.resolve();

  async function readCandidate(
    candidatePath: string,
  ): Promise<{ readonly value: T } | { readonly failure: unknown } | undefined> {
    let raw: string;
    try {
      raw = await readFile(candidatePath, 'utf8');
    } catch (error) {
      if (isFileNotFound(error)) {
        return undefined;
      }
      return { failure: error };
    }

    try {
      return { value: parse(JSON.parse(raw)) };
    } catch (error) {
      return { failure: error };
    }
  }

  async function quarantine(candidatePath: string): Promise<void> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    try {
      await copyFile(candidatePath, `${candidatePath}.corrupt-${stamp}`);
    } catch (error) {
      logger.warning('mise en quarantaine impossible', {
        path: candidatePath,
        cause: error,
      });
    }
  }

  async function performWrite(value: T): Promise<void> {
    try {
      await mkdir(directoryPath, { recursive: true });

      const serialized = `${JSON.stringify(value, null, JSON_INDENTATION)}\n`;

      const handle = await open(temporaryPath, 'w');
      try {
        await handle.writeFile(serialized, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }

      try {
        await copyFile(filePath, backupPath);
      } catch (error) {
        if (!isFileNotFound(error)) {
          logger.warning('sauvegarde de la version précédente impossible', {
            path: backupPath,
            cause: error,
          });
        }
      }

      await rename(temporaryPath, filePath);
      await syncDirectory(directoryPath);
    } catch (error) {
      try {
        await unlink(temporaryPath);
      } catch {
        // Le fichier temporaire n'existe peut-être pas : l'échec initial prime.
      }

      logger.error('échec de persistance', { path: filePath, cause: error });
      throw new StoreWriteError(filePath, error);
    }
  }

  return {
    filePath,

    async read(): Promise<T> {
      const primary = await readCandidate(filePath);

      if (primary !== undefined && 'value' in primary) {
        return primary.value;
      }

      if (primary === undefined) {
        const backup = await readCandidate(backupPath);
        if (backup !== undefined && 'value' in backup) {
          logger.warning('fichier principal absent, restauration depuis la sauvegarde', {
            path: filePath,
          });
          return backup.value;
        }

        logger.info('aucun état persisté, utilisation des valeurs par défaut', {
          path: filePath,
        });
        return createDefault();
      }

      logger.warning('fichier principal illisible, tentative de restauration', {
        path: filePath,
        cause: primary.failure,
      });

      const backup = await readCandidate(backupPath);
      if (backup !== undefined && 'value' in backup) {
        return backup.value;
      }

      await quarantine(filePath);
      logger.error('aucune version exploitable, retour aux valeurs par défaut', {
        path: filePath,
        backupPath,
      });
      return createDefault();
    },

    async write(value: T): Promise<void> {
      const queued = writeQueue.then(
        () => performWrite(value),
        () => performWrite(value),
      );
      writeQueue = queued.catch(() => undefined);
      return queued;
    },
  };
}
