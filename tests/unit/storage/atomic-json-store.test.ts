import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createLogger, type LogRecord, type LogSink } from '../../../src/core/logging/logger.js';
import {
  createAtomicJsonStore,
  StoreWriteError,
} from '../../../src/core/storage/atomic-json-store.js';

interface Compteur {
  readonly restantMs: number;
  readonly statut: string;
}

const DEFAUT: Compteur = { restantMs: 43_200_000, statut: 'idle' };

function parseCompteur(raw: unknown): Compteur {
  if (typeof raw !== 'object' || raw === null) {
    throw new TypeError('objet attendu');
  }
  const candidate = raw as Record<string, unknown>;
  if (typeof candidate['restantMs'] !== 'number' || typeof candidate['statut'] !== 'string') {
    throw new TypeError('forme invalide');
  }
  return { restantMs: candidate['restantMs'], statut: candidate['statut'] };
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

describe('createAtomicJsonStore', () => {
  let directory: string;
  let filePath: string;
  let sink: ReturnType<typeof createMemorySink>;

  function createStore() {
    return createAtomicJsonStore<Compteur>({
      filePath,
      parse: parseCompteur,
      createDefault: () => DEFAUT,
      logger: createLogger({ level: 'debug', sinks: [sink] }),
    });
  }

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'chronocast-store-'));
    filePath = join(directory, 'compteur.json');
    sink = createMemorySink();
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  describe('cycle nominal', () => {
    it('relit la valeur qui vient d\'être écrite', async () => {
      const store = createStore();

      await store.write({ restantMs: 1000, statut: 'running' });

      await expect(store.read()).resolves.toEqual({ restantMs: 1000, statut: 'running' });
    });

    it('relit la valeur depuis une instance neuve, comme après un redémarrage', async () => {
      await createStore().write({ restantMs: 555, statut: 'paused' });

      await expect(createStore().read()).resolves.toEqual({ restantMs: 555, statut: 'paused' });
    });

    it('crée les répertoires parents manquants', async () => {
      filePath = join(directory, 'niveau1', 'niveau2', 'compteur.json');

      await createStore().write(DEFAUT);

      await expect(readFile(filePath, 'utf8')).resolves.toContain('43200000');
    });

    it('renvoie la valeur par défaut au tout premier démarrage', async () => {
      await expect(createStore().read()).resolves.toEqual(DEFAUT);
    });

    it('ne crée aucun fichier lors d\'une lecture sur magasin vide', async () => {
      await createStore().read();

      await expect(readdir(directory)).resolves.toEqual([]);
    });
  });

  describe('atomicité', () => {
    it('ne laisse aucun fichier temporaire derrière lui', async () => {
      await createStore().write(DEFAUT);

      const entries = await readdir(directory);
      expect(entries.filter((entry) => entry.endsWith('.tmp'))).toEqual([]);
    });

    it('conserve la version précédente dans un fichier de secours', async () => {
      const store = createStore();

      await store.write({ restantMs: 1, statut: 'premier' });
      await store.write({ restantMs: 2, statut: 'second' });

      const backup = await readFile(`${filePath}.bak`, 'utf8');
      expect(JSON.parse(backup)).toEqual({ restantMs: 1, statut: 'premier' });
    });

    it('sérialise les écritures concurrentes sans corrompre le fichier', async () => {
      const store = createStore();

      await Promise.all(
        Array.from({ length: 20 }, (_, index) =>
          store.write({ restantMs: index, statut: 'concurrent' }),
        ),
      );

      const result = await store.read();
      expect(result.statut).toBe('concurrent');
      expect(result.restantMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('récupération après corruption', () => {
    it('se rabat sur le fichier de secours quand le principal est tronqué', async () => {
      const store = createStore();
      await store.write({ restantMs: 100, statut: 'bon' });
      await store.write({ restantMs: 200, statut: 'plus-recent' });

      await writeFile(filePath, '{"restantMs": 20', 'utf8');

      await expect(createStore().read()).resolves.toEqual({ restantMs: 100, statut: 'bon' });
    });

    it('se rabat sur le fichier de secours quand le principal viole le schéma', async () => {
      const store = createStore();
      await store.write({ restantMs: 100, statut: 'bon' });
      await store.write({ restantMs: 200, statut: 'plus-recent' });

      await writeFile(filePath, JSON.stringify({ restantMs: 'pas-un-nombre' }), 'utf8');

      await expect(createStore().read()).resolves.toEqual({ restantMs: 100, statut: 'bon' });
    });

    it('journalise un avertissement lorsqu\'il recourt au fichier de secours', async () => {
      const store = createStore();
      await store.write({ restantMs: 100, statut: 'bon' });
      await store.write({ restantMs: 200, statut: 'plus-recent' });
      await writeFile(filePath, 'corrompu', 'utf8');

      await createStore().read();

      expect(sink.records.some((record) => record.level === 'warning')).toBe(true);
    });

    it('revient aux valeurs par défaut quand les deux fichiers sont corrompus', async () => {
      await createStore().write({ restantMs: 100, statut: 'bon' });
      await writeFile(filePath, 'corrompu', 'utf8');
      await writeFile(`${filePath}.bak`, 'corrompu aussi', 'utf8');

      await expect(createStore().read()).resolves.toEqual(DEFAUT);
    });

    it('journalise une erreur quand aucune version exploitable ne subsiste', async () => {
      await createStore().write({ restantMs: 100, statut: 'bon' });
      await writeFile(filePath, 'corrompu', 'utf8');
      await writeFile(`${filePath}.bak`, 'corrompu aussi', 'utf8');

      await createStore().read();

      expect(sink.records.some((record) => record.level === 'error')).toBe(true);
    });

    it('préserve la copie du fichier corrompu pour analyse', async () => {
      await createStore().write({ restantMs: 100, statut: 'bon' });
      await writeFile(filePath, 'corrompu', 'utf8');
      await writeFile(`${filePath}.bak`, 'corrompu aussi', 'utf8');

      await createStore().read();

      const entries = await readdir(directory);
      expect(entries.some((entry) => entry.includes('corrupt'))).toBe(true);
    });
  });

  describe('échec d\'écriture', () => {
    it('signale un échec d\'écriture par une erreur typée', async () => {
      const store = createAtomicJsonStore<Compteur>({
        filePath: directory,
        parse: parseCompteur,
        createDefault: () => DEFAUT,
        logger: createLogger({ level: 'debug', sinks: [sink] }),
      });

      await expect(store.write(DEFAUT)).rejects.toBeInstanceOf(StoreWriteError);
    });

    it('expose le chemin concerné dans l\'erreur levée', async () => {
      const store = createAtomicJsonStore<Compteur>({
        filePath: directory,
        parse: parseCompteur,
        createDefault: () => DEFAUT,
        logger: createLogger({ level: 'debug', sinks: [sink] }),
      });

      await expect(store.write(DEFAUT)).rejects.toMatchObject({ filePath: directory });
    });
  });
});
