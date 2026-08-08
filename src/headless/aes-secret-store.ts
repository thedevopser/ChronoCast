import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { SecretStore } from '../core/app/ports.js';
import type { Logger } from '../core/logging/logger.js';

const SECRETS_FILE = 'secrets.json';

const KEY_FILE = 'secret.key';

const PASSPHRASE_VARIABLE = 'CHRONOCAST_SECRET_PASSPHRASE';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

export interface AesSecretStoreOptions {
  readonly directory: string;
  readonly logger: Logger;
}

const SCRYPT_SALT = 'chronocast-headless-v1';

export function createAesSecretStore(options: AesSecretStoreOptions): SecretStore {
  const { directory, logger } = options;
  const scoped = logger.child('secrets');

  const secretsPath = join(directory, SECRETS_FILE);
  const keyPath = join(directory, KEY_FILE);

  let key: Buffer | null = null;
  let warned = false;

  function warnOnce(): void {
    if (warned) {
      return;
    }
    warned = true;
    scoped.warning(
      'magasin de secrets de repli : chiffrement local sans coffre-fort système. ' +
        'La clé est stockée à côté des données ; ce n’est pas équivalent à DPAPI. ' +
        'Utilisez l’application Windows pour une protection réelle.',
    );
  }

  function loadKey(): Buffer {
    if (key !== null) {
      return key;
    }

    warnOnce();

    const passphrase = process.env[PASSPHRASE_VARIABLE];
    if (passphrase !== undefined && passphrase !== '') {
      key = scryptSync(passphrase, SCRYPT_SALT, KEY_LENGTH);
      return key;
    }

    mkdirSync(directory, { recursive: true });

    let material: string;
    try {
      material = readFileSync(keyPath, 'utf8');
    } catch {
      material = randomBytes(KEY_LENGTH).toString('hex');
      writeFileSync(keyPath, material, { encoding: 'utf8', mode: 0o600 });
    }

    key = scryptSync(material, SCRYPT_SALT, KEY_LENGTH);
    return key;
  }

  async function readAll(): Promise<Record<string, string>> {
    try {
      const raw: unknown = JSON.parse(await readFile(secretsPath, 'utf8'));
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        return {};
      }
      return raw as Record<string, string>;
    } catch {
      return {};
    }
  }

  async function writeAll(entries: Record<string, string>): Promise<void> {
    mkdirSync(directory, { recursive: true });
    await writeFile(secretsPath, JSON.stringify(entries), { encoding: 'utf8', mode: 0o600 });
  }

  function encrypt(value: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, loadKey(), iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);

    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
  }

  function decrypt(payload: string): string | null {
    try {
      const raw = Buffer.from(payload, 'base64');
      if (raw.byteLength <= IV_LENGTH + AUTH_TAG_LENGTH) {
        return null;
      }

      const iv = raw.subarray(0, IV_LENGTH);
      const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
      const encrypted = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

      const decipher = createDecipheriv(ALGORITHM, loadKey(), iv);
      decipher.setAuthTag(authTag);

      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    } catch {
      scoped.warning('secret illisible : contenu altéré ou clé différente');
      return null;
    }
  }

  return {
    isEncryptionAvailable(): boolean {
      return false;
    },

    async read(key_: string): Promise<string | null> {
      const entries = await readAll();
      const payload = entries[key_];
      return payload === undefined ? null : decrypt(payload);
    },

    async write(key_: string, value: string): Promise<void> {
      const entries = await readAll();
      entries[key_] = encrypt(value);
      await writeAll(entries);
    },

    async delete(key_: string): Promise<void> {
      const entries = await readAll();
      if (!(key_ in entries)) {
        return;
      }

      const remaining = Object.fromEntries(
        Object.entries(entries).filter(([name]) => name !== key_),
      );
      await writeAll(remaining);
    },
  };
}
