import { appendFile, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createLogger, type LogRecord, type LogSink } from '../../../src/core/logging/logger.js';
import { createJsonlStore } from '../../../src/core/storage/jsonl-store.js';

/**
 * L'historique des événements et les logs sont des flux : on y ajoute sans cesse,
 * on ne modifie jamais. Le format JSONL — une entrée JSON par ligne — est le seul
 * qui rende l'ajout naturellement résistant à une coupure : une ligne tronquée en
 * fin de fichier est simplement ignorée à la relecture, sans compromettre les
 * précédentes.
 *
 * La rotation est quotidienne, ce qui rend la purge triviale : un fichier par
 * jour se supprime sans avoir à réécrire quoi que ce soit.
 */

interface Evenement {
  readonly type: string;
  readonly secondes: number;
}

function parseEvenement(raw: unknown): Evenement {
  if (typeof raw !== 'object' || raw === null) {
    throw new TypeError('objet attendu');
  }
  const candidate = raw as Record<string, unknown>;
  if (typeof candidate['type'] !== 'string' || typeof candidate['secondes'] !== 'number') {
    throw new TypeError('forme invalide');
  }
  return { type: candidate['type'], secondes: candidate['secondes'] };
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

describe('createJsonlStore', () => {
  let directory: string;
  let sink: ReturnType<typeof createMemorySink>;
  let currentDate: Date;

  function createStore(retentionDays = 30) {
    return createJsonlStore<Evenement>({
      directory,
      baseName: 'events',
      parse: parseEvenement,
      logger: createLogger({ level: 'debug', sinks: [sink] }),
      retentionDays,
      now: () => currentDate,
    });
  }

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'chronocast-jsonl-'));
    sink = createMemorySink();
    currentDate = new Date('2026-08-01T12:00:00.000Z');
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  describe('ajout', () => {
    it('écrit une entrée sur une seule ligne', async () => {
      await createStore().append({ type: 'sub', secondes: 180 });

      const content = await readFile(join(directory, 'events-2026-08-01.jsonl'), 'utf8');
      expect(content).toBe('{"type":"sub","secondes":180}\n');
    });

    it('conserve l\'ordre des ajouts successifs', async () => {
      const store = createStore();

      await store.append({ type: 'premier', secondes: 1 });
      await store.append({ type: 'second', secondes: 2 });

      await expect(store.readAll()).resolves.toEqual([
        { type: 'premier', secondes: 1 },
        { type: 'second', secondes: 2 },
      ]);
    });

    it('crée le répertoire manquant', async () => {
      directory = join(directory, 'historique');

      await createStore().append({ type: 'sub', secondes: 180 });

      await expect(readdir(directory)).resolves.toEqual(['events-2026-08-01.jsonl']);
    });

    it('sérialise les ajouts concurrents sans entrelacer les lignes', async () => {
      const store = createStore();

      await Promise.all(
        Array.from({ length: 30 }, (_, index) =>
          store.append({ type: 'concurrent', secondes: index }),
        ),
      );

      const entries = await store.readAll();
      expect(entries).toHaveLength(30);
      expect(entries.map((entry) => entry.secondes).sort((a, b) => a - b)).toEqual(
        Array.from({ length: 30 }, (_, index) => index),
      );
    });
  });

  describe('rotation quotidienne', () => {
    it('bascule sur un nouveau fichier au changement de jour', async () => {
      const store = createStore();
      await store.append({ type: 'hier', secondes: 1 });

      currentDate = new Date('2026-08-02T00:30:00.000Z');
      await store.append({ type: 'aujourdhui', secondes: 2 });

      await expect(readdir(directory)).resolves.toEqual([
        'events-2026-08-01.jsonl',
        'events-2026-08-02.jsonl',
      ]);
    });

    it('relit les entrées de tous les jours dans l\'ordre chronologique', async () => {
      const store = createStore();
      await store.append({ type: 'hier', secondes: 1 });
      currentDate = new Date('2026-08-02T00:30:00.000Z');
      await store.append({ type: 'aujourdhui', secondes: 2 });

      await expect(store.readAll()).resolves.toEqual([
        { type: 'hier', secondes: 1 },
        { type: 'aujourdhui', secondes: 2 },
      ]);
    });
  });

  describe('lecture partielle', () => {
    it('renvoie une liste vide quand rien n\'a été écrit', async () => {
      await expect(createStore().readAll()).resolves.toEqual([]);
    });

    it('renvoie les dernières entrées demandées, dans l\'ordre chronologique', async () => {
      const store = createStore();
      for (let index = 0; index < 10; index += 1) {
        await store.append({ type: 'evenement', secondes: index });
      }

      const derniers = await store.tail(3);

      expect(derniers.map((entry) => entry.secondes)).toEqual([7, 8, 9]);
    });

    it('traverse plusieurs fichiers pour compléter la fin demandée', async () => {
      const store = createStore();
      await store.append({ type: 'hier', secondes: 1 });
      currentDate = new Date('2026-08-02T00:30:00.000Z');
      await store.append({ type: 'aujourdhui', secondes: 2 });

      await expect(store.tail(2)).resolves.toEqual([
        { type: 'hier', secondes: 1 },
        { type: 'aujourdhui', secondes: 2 },
      ]);
    });

    it('ne renvoie rien lorsque zéro entrée est demandée', async () => {
      const store = createStore();
      await store.append({ type: 'evenement', secondes: 1 });

      await expect(store.tail(0)).resolves.toEqual([]);
    });
  });

  describe('résistance aux fichiers abîmés', () => {
    it('ignore une dernière ligne tronquée par une coupure', async () => {
      const store = createStore();
      await store.append({ type: 'complet', secondes: 1 });
      await appendFile(join(directory, 'events-2026-08-01.jsonl'), '{"type":"tronq', 'utf8');

      await expect(store.readAll()).resolves.toEqual([{ type: 'complet', secondes: 1 }]);
    });

    it('ignore une ligne violant le schéma et poursuit la lecture', async () => {
      await writeFile(
        join(directory, 'events-2026-08-01.jsonl'),
        '{"type":"bon","secondes":1}\n{"type":"mauvais"}\n{"type":"suivant","secondes":2}\n',
        'utf8',
      );

      await expect(createStore().readAll()).resolves.toEqual([
        { type: 'bon', secondes: 1 },
        { type: 'suivant', secondes: 2 },
      ]);
    });

    it('journalise un avertissement pour chaque ligne écartée', async () => {
      await writeFile(
        join(directory, 'events-2026-08-01.jsonl'),
        '{"type":"bon","secondes":1}\n{"type":"mauvais"}\n',
        'utf8',
      );

      await createStore().readAll();

      expect(sink.records.some((record) => record.level === 'warning')).toBe(true);
    });

    it('tolère les lignes vides', async () => {
      await writeFile(
        join(directory, 'events-2026-08-01.jsonl'),
        '{"type":"bon","secondes":1}\n\n\n{"type":"autre","secondes":2}\n',
        'utf8',
      );

      await expect(createStore().readAll()).resolves.toHaveLength(2);
    });

    it('ignore les fichiers étrangers présents dans le répertoire', async () => {
      await writeFile(join(directory, 'notes.txt'), 'contenu quelconque', 'utf8');
      await createStore().append({ type: 'sub', secondes: 180 });

      await expect(createStore().readAll()).resolves.toEqual([{ type: 'sub', secondes: 180 }]);
    });
  });

  describe('purge selon la rétention', () => {
    it('supprime les fichiers plus anciens que la rétention', async () => {
      await writeFile(join(directory, 'events-2026-06-01.jsonl'), '', 'utf8');
      await writeFile(join(directory, 'events-2026-07-30.jsonl'), '', 'utf8');
      const store = createStore(7);

      await store.purge();

      await expect(readdir(directory)).resolves.toEqual(['events-2026-07-30.jsonl']);
    });

    it('renvoie le nombre de fichiers supprimés', async () => {
      await writeFile(join(directory, 'events-2026-06-01.jsonl'), '', 'utf8');
      await writeFile(join(directory, 'events-2026-06-02.jsonl'), '', 'utf8');

      await expect(createStore(7).purge()).resolves.toBe(2);
    });

    it('conserve le fichier du jour même avec une rétention nulle', async () => {
      const store = createStore(0);
      await store.append({ type: 'aujourdhui', secondes: 1 });

      await store.purge();

      await expect(readdir(directory)).resolves.toEqual(['events-2026-08-01.jsonl']);
    });

    it('ne touche pas aux fichiers étrangers', async () => {
      await writeFile(join(directory, 'notes.txt'), 'contenu', 'utf8');

      await createStore(0).purge();

      await expect(readdir(directory)).resolves.toContain('notes.txt');
    });
  });
});
