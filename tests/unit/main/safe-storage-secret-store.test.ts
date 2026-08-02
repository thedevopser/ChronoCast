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

/**
 * Magasin de secrets de l'application Windows.
 *
 * C'est le pendant réel du magasin AES du point d'entrée headless, qui est un
 * repli honnêtement dégradé. Ici, `safeStorage` est adossé à DPAPI : la clé est
 * liée au compte utilisateur, si bien qu'un autre compte de la même machine ne
 * peut rien déchiffrer.
 *
 * `safeStorage` est **injecté** plutôt qu'importé d'`electron`. Deux raisons, et
 * la seconde est la vraie : le module reste testable dans un conteneur Linux
 * sans Chromium, et surtout la logique qui l'entoure — quoi faire quand le
 * chiffrement est indisponible, quand un blob ne se déchiffre pas, quand le
 * fichier est corrompu — cesse d'être invérifiable. Ce sont précisément les cas
 * qu'on ne veut pas découvrir sur le poste d'un utilisateur.
 */

/** Double de `safeStorage`, avec un chiffrement factice mais observable. */
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
      // Transformation réversible et manifestement distincte du texte clair :
      // le test doit pouvoir affirmer que rien de lisible n'atteint le disque.
      return Buffer.from(`chiffré:${plainText}`, 'utf8');
    },
    decryptString(encrypted: Buffer): string {
      const raw = encrypted.toString('utf8');
      if (!raw.startsWith('chiffré:')) {
        // DPAPI lève lorsque le blob vient d'un autre compte Windows : c'est le
        // cas réel que ce double reproduit.
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

    it('restreint le fichier à son propriétaire', async () => {
      await store.write('twitch.accessToken', 'jeton');

      const mode = (await stat(secretsPath())).mode & 0o777;

      // Sans effet réel sous Windows, où DPAPI fait le travail, mais le geste
      // reste juste et le magasin peut tourner ailleurs pendant le développement.
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
      // Retirer un secret devenu illisible doit rester possible : c'est la
      // seule porte de sortie de qui a recopié son répertoire de données
      // depuis un autre compte Windows.
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
      // C'est le cœur de ce module. Un repli en clair serait pire que l'échec :
      // il donnerait l'illusion inverse de la vérité, et la section 9 l'interdit
      // sans réserve. Mieux vaut une erreur franche que des jetons OAuth lisibles.
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
      // Cas réel : DPAPI lie le chiffrement au compte Windows, donc un
      // répertoire de données recopié depuis un autre compte est illisible.
      // L'utilisateur doit retomber sur l'assistant de configuration, pas sur
      // un écran de crash.
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
      // Le fichier est du JSON quelconque une fois relu : rien ne garantit que
      // ses valeurs soient des chaînes, et l'hypothèse contraire lèverait.
      await writeFile(secretsPath(), JSON.stringify({ 'twitch.accessToken': 42 }), 'utf8');

      await expect(store.read('twitch.accessToken')).resolves.toBeNull();
    });
  });

  describe('moment d’interrogation de safeStorage', () => {
    it('n’interroge pas safeStorage à la construction', () => {
      // `safeStorage` n'est utilisable qu'après `app.whenReady()`. L'interroger
      // en construisant le magasin — ce que fait la composition de
      // l'application — le prendrait trop tôt.
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
      // Un secret qu'on croit enregistré et qui ne l'est pas se découvre au
      // pire moment : au redémarrage suivant, quand le streamer est en direct.
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
    // Garde-fou de typage : si la forme attendue divergeait de celle
    // d'Electron, le module ne se brancherait qu'à l'exécution, sur le poste
    // de l'utilisateur. `vi.fn()` ne prouve rien de plus que la compatibilité
    // structurelle, et c'est exactement ce qu'on veut vérifier ici.
    const conforme: SafeStorageLike = {
      isEncryptionAvailable: vi.fn().mockReturnValue(true),
      encryptString: vi.fn().mockReturnValue(Buffer.alloc(0)),
      decryptString: vi.fn().mockReturnValue(''),
    };

    expect(conforme.isEncryptionAvailable()).toBe(true);
  });
});
