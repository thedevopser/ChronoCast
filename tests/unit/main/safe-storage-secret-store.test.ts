import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SecretStore } from '../../../src/core/app/ports.js';
import { createLogger, type LogRecord, type LogSink } from '../../../src/core/logging/logger.js';
import {
  createSafeStorageSecretStore,
  type SafeStorageLike,
} from '../../../src/main/safe-storage-secret-store.js';

function createFakeSafeStorage(
  options: { readonly available?: boolean } = {},
): SafeStorageLike & { readonly calls: { available: number } } {
  const available = options.available ?? true;
  const calls = { available: 0 };

  return {
    calls,
    isEncryptionAvailable(): boolean {
      calls.available += 1;
      return available;
    },
    encryptString(plainText: string): Buffer {
      return Buffer.from(`chiffré:${plainText}`, 'utf8');
    },
    decryptString(encrypted: Buffer): string {
      const raw = encrypted.toString('utf8');
      if (!raw.startsWith('chiffré:')) {
        throw new Error('déchiffrement impossible');
      }
      return raw.slice('chiffré:'.length);
    },
  };
}

function createMemorySink(): LogSink & { readonly records: LogRecord[] } {
  const records: LogRecord[] = [];
  return {
    name: 'memory',
    records,
    write(record: LogRecord): void {
      records.push(record);
    },
  };
}

describe('createSafeStorageSecretStore', () => {
  let directory: string;
  let sink: LogSink & { readonly records: LogRecord[] };
  let safeStorage: ReturnType<typeof createFakeSafeStorage>;
  let store: SecretStore;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'chronocast-secrets-'));
    sink = createMemorySink();
    safeStorage = createFakeSafeStorage();
    store = createSafeStorageSecretStore({
      directory,
      safeStorage,
      logger: createLogger({ level: 'debug', sinks: [sink] }),
    });
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const secretsPath = (): string => join(directory, 'secrets.json');

  const itPosix = process.platform === 'win32' ? it.skip : it;

  describe('aller-retour', () => {
    it('relit ce qu’il a écrit', async () => {
      await store.write('twitch.accessToken', 'jeton-secret');

      await expect(store.read('twitch.accessToken')).resolves.toBe('jeton-secret');
    });

    it('conserve plusieurs secrets côte à côte', async () => {
      await store.write('twitch.accessToken', 'jeton');
      await store.write('twitch.clientSecret', 'secret-client');

      await expect(store.read('twitch.accessToken')).resolves.toBe('jeton');
      await expect(store.read('twitch.clientSecret')).resolves.toBe('secret-client');
    });

    it('écrase la valeur précédente', async () => {
      await store.write('twitch.accessToken', 'ancien');
      await store.write('twitch.accessToken', 'nouveau');

      await expect(store.read('twitch.accessToken')).resolves.toBe('nouveau');
    });

    it('rend null pour une clé jamais écrite', async () => {
      await expect(store.read('inconnue')).resolves.toBeNull();
    });

    it('survit à un redémarrage', async () => {
      await store.write('twitch.accessToken', 'jeton');

      const repris = createSafeStorageSecretStore({
        directory,
        safeStorage: createFakeSafeStorage(),
        logger: createLogger({ level: 'debug', sinks: [sink] }),
      });

      await expect(repris.read('twitch.accessToken')).resolves.toBe('jeton');
    });
  });

  describe('ce qui atteint le disque', () => {
    it('n’écrit jamais la valeur en clair', async () => {
      await store.write('twitch.accessToken', 'jeton-très-secret');

      const raw = await readFile(secretsPath(), 'utf8');

      expect(raw).not.toContain('jeton-très-secret');
    });

    itPosix('restreint le fichier à son propriétaire', async () => {
      await store.write('twitch.accessToken', 'jeton');

      const mode = (await stat(secretsPath())).mode & 0o777;

      expect(mode).toBe(0o600);
    });

    it('crée le répertoire de données s’il manque', async () => {
      const absent = join(directory, 'jamais', 'créé');
      const profond = createSafeStorageSecretStore({
        directory: absent,
        safeStorage: createFakeSafeStorage(),
        logger: createLogger({ level: 'debug', sinks: [sink] }),
      });

      await profond.write('clé', 'valeur');

      await expect(profond.read('clé')).resolves.toBe('valeur');
    });
  });

  describe('suppression', () => {
    it('efface un secret', async () => {
      await store.write('twitch.accessToken', 'jeton');
      await store.delete('twitch.accessToken');

      await expect(store.read('twitch.accessToken')).resolves.toBeNull();
    });

    it('laisse les autres secrets en place', async () => {
      await store.write('a', 'valeur-a');
      await store.write('b', 'valeur-b');

      await store.delete('a');

      await expect(store.read('b')).resolves.toBe('valeur-b');
    });

    it('reste sans effet sur une clé absente', async () => {
      await expect(store.delete('jamais-écrite')).resolves.toBeUndefined();
    });

    it('efface même lorsque le chiffrement est indisponible', async () => {
      const indisponible = createSafeStorageSecretStore({
        directory,
        safeStorage: createFakeSafeStorage({ available: false }),
        logger: createLogger({ level: 'debug', sinks: [sink] }),
      });
      await store.write('twitch.accessToken', 'jeton');

      await expect(indisponible.delete('twitch.accessToken')).resolves.toBeUndefined();
      await expect(store.read('twitch.accessToken')).resolves.toBeNull();
    });
  });

  describe('chiffrement indisponible', () => {
    let indisponible: SecretStore;

    beforeEach(() => {
      indisponible = createSafeStorageSecretStore({
        directory,
        safeStorage: createFakeSafeStorage({ available: false }),
        logger: createLogger({ level: 'debug', sinks: [sink] }),
      });
    });

    it('l’annonce', () => {
      expect(indisponible.isEncryptionAvailable()).toBe(false);
    });

    it('refuse d’écrire plutôt que d’écrire en clair', async () => {
      await expect(indisponible.write('twitch.accessToken', 'jeton')).rejects.toThrow(
        /chiffrement/i,
      );
    });

    it('ne laisse aucune trace sur le disque après un refus', async () => {
      await expect(indisponible.write('twitch.accessToken', 'jeton')).rejects.toThrow();

      await expect(readFile(secretsPath(), 'utf8')).rejects.toThrow();
    });

    it('ne fait pas fuiter le secret dans les journaux', async () => {
      await expect(indisponible.write('twitch.accessToken', 'jeton-secret')).rejects.toThrow();

      const journal = JSON.stringify(sink.records);
      expect(journal).not.toContain('jeton-secret');
    });

    it('rend null en lecture au lieu de lever', async () => {
      await expect(indisponible.read('twitch.accessToken')).resolves.toBeNull();
    });
  });

  describe('robustesse en lecture', () => {
    it('rend null pour un blob indéchiffrable', async () => {
      await writeFile(
        secretsPath(),
        JSON.stringify({ 'twitch.accessToken': Buffer.from('venu-d-ailleurs').toString('base64') }),
        'utf8',
      );

      await expect(store.read('twitch.accessToken')).resolves.toBeNull();
    });

    it('avertit lorsqu’un secret est indéchiffrable', async () => {
      await writeFile(
        secretsPath(),
        JSON.stringify({ 'twitch.accessToken': Buffer.from('venu-d-ailleurs').toString('base64') }),
        'utf8',
      );

      await store.read('twitch.accessToken');

      expect(sink.records.some((record) => record.level === 'warning')).toBe(true);
    });

    it('traite un fichier corrompu comme un magasin vide', async () => {
      await writeFile(secretsPath(), '{ ceci n’est pas du JSON', 'utf8');

      await expect(store.read('twitch.accessToken')).resolves.toBeNull();
    });

    it('réécrit par-dessus un fichier corrompu', async () => {
      await writeFile(secretsPath(), '{ ceci n’est pas du JSON', 'utf8');

      await store.write('twitch.accessToken', 'jeton');

      await expect(store.read('twitch.accessToken')).resolves.toBe('jeton');
    });

    it('traite une entrée non textuelle comme absente', async () => {
      await writeFile(secretsPath(), JSON.stringify({ 'twitch.accessToken': 42 }), 'utf8');

      await expect(store.read('twitch.accessToken')).resolves.toBeNull();
    });
  });

  describe('moment d’interrogation de safeStorage', () => {
    it('n’interroge pas safeStorage à la construction', () => {
      const tardif = createFakeSafeStorage();

      createSafeStorageSecretStore({
        directory,
        safeStorage: tardif,
        logger: createLogger({ level: 'debug', sinks: [sink] }),
      });

      expect(tardif.calls.available).toBe(0);
    });

    it('reflète la disponibilité à chaque interrogation', () => {
      let disponible = false;
      const changeant: SafeStorageLike = {
        isEncryptionAvailable: () => disponible,
        encryptString: (value) => Buffer.from(value, 'utf8'),
        decryptString: (value) => value.toString('utf8'),
      };
      const suiveur = createSafeStorageSecretStore({
        directory,
        safeStorage: changeant,
        logger: createLogger({ level: 'debug', sinks: [sink] }),
      });

      expect(suiveur.isEncryptionAvailable()).toBe(false);
      disponible = true;
      expect(suiveur.isEncryptionAvailable()).toBe(true);
    });
  });

  describe('déclaration au rédacteur', () => {
    it('n’écrit jamais la valeur d’un secret dans les journaux', async () => {
      await store.write('twitch.accessToken', 'jeton-très-secret');
      await store.read('twitch.accessToken');
      await store.delete('twitch.accessToken');

      const journal = JSON.stringify(sink.records);

      expect(journal).not.toContain('jeton-très-secret');
    });
  });

  describe('erreurs d’écriture', () => {
    it('propage un échec disque au lieu de le taire', async () => {
      const cassé = createSafeStorageSecretStore({
        directory: join(directory, 'fichier-occupant'),
        safeStorage: createFakeSafeStorage(),
        logger: createLogger({ level: 'debug', sinks: [sink] }),
      });
      await writeFile(join(directory, 'fichier-occupant'), 'je ne suis pas un répertoire', 'utf8');

      await expect(cassé.write('clé', 'valeur')).rejects.toThrow();
    });
  });
});

describe('interface SafeStorageLike', () => {
  it('se satisfait de la forme réelle de safeStorage', () => {
    const conforme: SafeStorageLike = {
      isEncryptionAvailable: vi.fn().mockReturnValue(true),
      encryptString: vi.fn().mockReturnValue(Buffer.alloc(0)),
      decryptString: vi.fn().mockReturnValue(''),
    };

    expect(conforme.isEncryptionAvailable()).toBe(true);
  });
});
