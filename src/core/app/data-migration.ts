import { constants } from 'node:fs';
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const CONFIG_FILE = 'config.json';

export type DataMigrationSkipReason =
  | 'aucune-installation-precedente'
  | 'cible-deja-configuree'
  | 'source-et-cible-confondues';

export type DataMigrationOutcome =
  | { readonly kind: 'skipped'; readonly reason: DataMigrationSkipReason }
  | { readonly kind: 'migrated'; readonly fileCount: number }
  | { readonly kind: 'failed'; readonly cause: unknown };

export interface DataMigrationOptions {
  readonly source: string;
  readonly target: string;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function copyDirectoryContents(
  source: string,
  target: string,
  skip: ReadonlySet<string>,
): Promise<number> {
  await mkdir(target, { recursive: true });

  const entries = await readdir(source, { withFileTypes: true });
  let copied = 0;

  for (const entry of entries) {
    if (skip.has(entry.name)) {
      continue;
    }

    const from = join(source, entry.name);
    const to = join(target, entry.name);

    if (entry.isDirectory()) {
      copied += await copyDirectoryContents(from, to, new Set());
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    try {
      await copyFile(from, to, constants.COPYFILE_EXCL);
      copied += 1;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    }
  }

  return copied;
}

export async function migrateDataDirectory(
  options: DataMigrationOptions,
): Promise<DataMigrationOutcome> {
  const source = resolve(options.source);
  const target = resolve(options.target);

  if (source === target) {
    return { kind: 'skipped', reason: 'source-et-cible-confondues' };
  }

  try {
    if (await fileExists(join(target, CONFIG_FILE))) {
      return { kind: 'skipped', reason: 'cible-deja-configuree' };
    }

    if (!(await fileExists(join(source, CONFIG_FILE)))) {
      return { kind: 'skipped', reason: 'aucune-installation-precedente' };
    }

    const copied = await copyDirectoryContents(source, target, new Set([CONFIG_FILE]));

    await copyFile(join(source, CONFIG_FILE), join(target, CONFIG_FILE), constants.COPYFILE_EXCL);

    return { kind: 'migrated', fileCount: copied + 1 };
  } catch (error) {
    return { kind: 'failed', cause: error };
  }
}
