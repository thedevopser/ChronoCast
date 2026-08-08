import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PathProvider } from './ports.js';

const DATA_DIRECTORY_VARIABLE = 'CHRONOCAST_DATA_DIR';

const WEB_ROOT_VARIABLE = 'CHRONOCAST_WEB_ROOT';

export interface FsPathProviderOptions {
  readonly dataDirectory?: string;
  readonly webRootDirectory: string;
}

function readEnvironment(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
}

function defaultDataDirectory(): string {
  return readEnvironment(DATA_DIRECTORY_VARIABLE) ?? join(homedir(), '.chronocast');
}

export function defaultWebRoot(entryModuleUrl: string): string {
  return (
    readEnvironment(WEB_ROOT_VARIABLE) ??
    resolve(dirname(fileURLToPath(entryModuleUrl)), '..', 'public')
  );
}

export function createFsPathProvider(options: FsPathProviderOptions): PathProvider {
  const dataDirectory = resolve(options.dataDirectory ?? defaultDataDirectory());

  return {
    dataDirectory,
    logsDirectory: join(dataDirectory, 'logs'),
    historyDirectory: join(dataDirectory, 'history'),
    webRootDirectory: resolve(options.webRootDirectory),

    resolveDataFile(...segments: string[]): string {
      const candidate = resolve(join(dataDirectory, ...segments));

      const difference = relative(dataDirectory, candidate);
      if (difference.startsWith('..') || isAbsolute(difference)) {
        throw new Error('chemin de données hors de la racine');
      }

      return candidate;
    },
  };
}
