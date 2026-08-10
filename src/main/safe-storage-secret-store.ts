import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { SecretStore } from '../core/app/ports.js';
import type { Logger } from '../core/logging/logger.js';

const SECRETS_FILE = 'secrets.json';

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export interface SafeStorageSecretStoreOptions {
  readonly directory: string;
  readonly safeStorage: SafeStorageLike;
  readonly logger: Logger;
}

export function createSafeStorageSecretStore(
  options: SafeStorageSecretStoreOptions,
): SecretStore {
  const { directory, safeStorage, logger } = options;
  const scoped = logger.child('secrets');

  const secretsPath = join(directory, SECRETS_FILE);

  async function readAll(): Promise<Record<string, unknown>> {
    try {
      const raw: unknown = JSON.parse(await readFile(secretsPath, 'utf8'));
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        return {};
      }
      return raw as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  async function writeAll(entries: Record<string, unknown>): Promise<void> {
    await mkdir(directory, { recursive: true });
    await writeFile(secretsPath, JSON.stringify(entries), { encoding: 'utf8', mode: 0o600 });
  }

  return {
    isEncryptionAvailable(): boolean {
      return safeStorage.isEncryptionAvailable();
    },

    async read(key: string): Promise<string | null> {
      if (!safeStorage.isEncryptionAvailable()) {
        scoped.warning('chiffrement indisponible : aucun secret ne peut être relu');
        return null;
      }

      const entries = await readAll();
      const payload = entries[key];
      if (typeof payload !== 'string') {
        return null;
      }

      try {
        return safeStorage.decryptString(Buffer.from(payload, 'base64'));
      } catch {
        scoped.warning('secret illisible : chiffré par un autre compte, ou altéré', { key });
        return null;
      }
    },

    async write(key: string, value: string): Promise<void> {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error(
          'chiffrement indisponible : le secret n’a pas été enregistré, aucune écriture en clair n’est faite',
        );
      }

      const entries = await readAll();
      entries[key] = safeStorage.encryptString(value).toString('base64');
      await writeAll(entries);
    },

    async delete(key: string): Promise<void> {
      const entries = await readAll();
      if (!(key in entries)) {
        return;
      }

      const remaining = Object.fromEntries(
        Object.entries(entries).filter(([name]) => name !== key),
      );
      await writeAll(remaining);
    },
  };
}
