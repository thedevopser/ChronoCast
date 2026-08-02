import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAesSecretStore } from '../../../src/headless/aes-secret-store.js';
import { createLogger, type LogRecord, type LogSink } from '../../../src/core/logging/logger.js';
import type { SecretStore } from '../../../src/core/app/ports.js';

/**
 * Ce magasin est un **repli assumé**, pas une solution.
 *
 * Sous Windows — seule cible de la V1 — les jetons Twitch sont protégés par
 * `safeStorage`, adossé à DPAPI : la clé est dérivée du compte utilisateur, si
 * bien qu'un autre compte de la même machine ne peut rien déchiffrer. C'est ce
 * que la coquille Electron apportera en Phase 6.
 *
 * Hors d'Electron, rien de tel n'existe. La clé vit à côté des données chiffrées :
 * quiconque lit le disque lit les jetons. Le chiffrement n'y protège que d'un
 * regard distrait, jamais d'un attaquant.
 *
 * D'où les deux exigences vérifiées ici, qui comptent autant que la cryptographie :
 * `isEncryptionAvailable()` répond **faux**, et un avertissement explicite part
 * dans les journaux au démarrage. Un utilisateur averti vaut mieux qu'une fausse
 * impression de sécurité.
 */

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

describe('createAesSecretStore', () => {
  // Windows ne connaît pas les permissions POSIX : `stat` y rend `0o666` quoi
  // qu'on demande. L'assertion n'a donc de sens que là où le mode existe, et
  // c'est sans conséquence : sous Windows, la protection réelle des secrets
  // vient de DPAPI, pas d'un bit de permission.
  const itPosix = process.platform === 'win32' ? it.skip : it;

  let directory: string;
  let store: SecretStore;
  let sink: LogSink & { readonly records: LogRecord[] };

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'chronocast-secrets-'));
    sink = createMemorySink();
    store = createAesSecretStore({
      directory,
      logger: createLogger({ level: 'debug', sinks: [sink] }),
    });
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  describe('honnêteté', () => {
    it('annonce que le chiffrement n’est pas de niveau coffre-fort', () => {
      expect(store.isEncryptionAvailable()).toBe(false);
    });

    it('avertit explicitement dans les journaux', async () => {
      await store.write('twitch', 'jeton');

      const warnings = sink.records.filter((record) => record.level === 'warning');
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings.map((record) => record.message).join(' ')).toMatch(/coffre|DPAPI|repli/i);
    });

    it("n'avertit qu'une fois, pour rester lisible", async () => {
      await store.write('a', '1');
      await store.write('b', '2');
      await store.read('a');

      expect(sink.records.filter((record) => record.level === 'warning')).toHaveLength(1);
    });
  });

  describe('aller-retour', () => {
    it('relit ce qui a été écrit', async () => {
      await store.write('twitch', 'jeton-très-secret');

      expect(await store.read('twitch')).toBe('jeton-très-secret');
    });

    it('renvoie null pour une clé jamais écrite', async () => {
      expect(await store.read('inexistant')).toBeNull();
    });

    it('écrase la valeur précédente', async () => {
      await store.write('twitch', 'ancien');
      await store.write('twitch', 'nouveau');

      expect(await store.read('twitch')).toBe('nouveau');
    });

    it('efface une clé', async () => {
      await store.write('twitch', 'jeton');
      await store.delete('twitch');

      expect(await store.read('twitch')).toBeNull();
    });

    it('supporte la suppression d’une clé absente', async () => {
      await expect(store.delete('jamais-vu')).resolves.toBeUndefined();
    });

    it('conserve les valeurs entre deux instances', async () => {
      // Le cas réel : l'application redémarre et doit retrouver ses jetons.
      await store.write('twitch', 'jeton-persistant');

      const second = createAesSecretStore({
        directory,
        logger: createLogger({ level: 'error', sinks: [createMemorySink()] }),
      });

      expect(await second.read('twitch')).toBe('jeton-persistant');
    });

    it('gère les caractères non ASCII', async () => {
      await store.write('twitch', 'clé-à-accents-€-🎉');

      expect(await store.read('twitch')).toBe('clé-à-accents-€-🎉');
    });
  });

  describe('chiffrement', () => {
    it("n'écrit jamais la valeur en clair sur le disque", async () => {
      await store.write('twitch', 'jeton-très-secret');

      const files = await readAllFiles(directory);
      expect(files.join('\n')).not.toContain('jeton-très-secret');
    });

    it('produit un chiffré différent à chaque écriture de la même valeur', async () => {
      // Un vecteur d'initialisation réutilisé rendrait deux valeurs identiques
      // reconnaissables — et, avec GCM, casserait l'authentification.
      await store.write('a', 'même-valeur');
      const first = await readAllFiles(directory);

      await store.write('b', 'même-valeur');
      const second = await readAllFiles(directory);

      expect(first.join()).not.toBe(second.join());
    });

    it('refuse une valeur altérée plutôt que de rendre n’importe quoi', async () => {
      // AES-GCM authentifie : une modification d'un octet doit être détectée,
      // pas déchiffrée en silence.
      await store.write('twitch', 'jeton');

      const secretsPath = join(directory, 'secrets.json');
      const raw = JSON.parse(await readFile(secretsPath, 'utf8')) as Record<string, string>;
      const original = raw['twitch'] ?? '';
      raw['twitch'] = `${original.slice(0, -2)}00`;
      await writeFile(secretsPath, JSON.stringify(raw), 'utf8');

      const fresh = createAesSecretStore({
        directory,
        logger: createLogger({ level: 'error', sinks: [createMemorySink()] }),
      });

      expect(await fresh.read('twitch')).toBeNull();
    });

    itPosix('restreint les droits du fichier de clé', async () => {
      await store.write('twitch', 'jeton');

      const mode = (await stat(join(directory, 'secret.key'))).mode & 0o777;
      expect(mode).toBe(0o600);
    });
  });

  describe('robustesse', () => {
    it('repart proprement d’un fichier de secrets corrompu', async () => {
      // Une coupure en pleine écriture ne doit pas empêcher le démarrage : au
      // pire, l'utilisateur se réauthentifie.
      await writeFile(join(directory, 'secrets.json'), '{ tronqué', 'utf8');

      const fresh = createAesSecretStore({
        directory,
        logger: createLogger({ level: 'error', sinks: [createMemorySink()] }),
      });

      expect(await fresh.read('twitch')).toBeNull();
      await expect(fresh.write('twitch', 'nouveau')).resolves.toBeUndefined();
      expect(await fresh.read('twitch')).toBe('nouveau');
    });
  });
});

/** Contenu brut de tous les fichiers du répertoire, pour chercher une fuite. */
async function readAllFiles(directory: string): Promise<string[]> {
  const { readdir } = await import('node:fs/promises');
  const names = await readdir(directory);
  return Promise.all(names.map((name) => readFile(join(directory, name), 'utf8')));
}
