import { describe, expect, it, vi } from 'vitest';

import { createLogger, type LogRecord, type LogSink } from '../../../src/core/logging/logger.js';
import {
  ConfigImportError,
  ConfigNotLoadedError,
  createConfigService,
} from '../../../src/core/config/config-service.js';
import { DEFAULT_CONFIG } from '../../../src/core/config/defaults.js';
import { CONFIG_SCHEMA_VERSION, type ChronoCastConfig } from '../../../src/core/config/schema.js';
import type { AtomicJsonStore } from '../../../src/core/storage/atomic-json-store.js';

/**
 * Le service de configuration est le seul point d'écriture des réglages. Il
 * garantit trois choses que l'interface d'administration ne peut pas assurer
 * seule : une configuration invalide n'est jamais persistée, une mise à jour
 * partielle n'efface jamais les réglages voisins, et l'import d'un fichier
 * fourni par l'utilisateur est validé avant d'être appliqué.
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

/** Magasin simulé, conservant la valeur en mémoire. */
function createStoreDouble(initial?: unknown) {
  let persisted: unknown = initial;
  let failNextWrite: Error | undefined;

  const store: AtomicJsonStore<ChronoCastConfig> & { readonly writes: number } = {
    filePath: '/mémoire/config.json',
    writes: 0,
    read: () => Promise.resolve(persisted as ChronoCastConfig),
    write: (value: ChronoCastConfig) => {
      if (failNextWrite !== undefined) {
        const failure = failNextWrite;
        failNextWrite = undefined;
        return Promise.reject(failure);
      }
      persisted = value;
      return Promise.resolve();
    },
  };

  return {
    store,
    get persisted(): unknown {
      return persisted;
    },
    failNextWrite(error: Error): void {
      failNextWrite = error;
    },
  };
}

function createService(initial?: unknown) {
  const sink = createMemorySink();
  const double = createStoreDouble(initial ?? DEFAULT_CONFIG);
  const service = createConfigService({
    store: double.store,
    logger: createLogger({ level: 'debug', sinks: [sink] }),
  });
  return { service, double, sink };
}

describe('createConfigService', () => {
  describe('chargement', () => {
    it('expose la configuration une fois chargée', async () => {
      const { service } = createService();

      const loaded = await service.load();

      expect(loaded).toEqual(DEFAULT_CONFIG);
      expect(service.get()).toEqual(DEFAULT_CONFIG);
    });

    it('refuse d\'être interrogé avant chargement', () => {
      const { service } = createService();

      expect(() => service.get()).toThrow(ConfigNotLoadedError);
    });

    it('complète une configuration partielle avec les valeurs par défaut', async () => {
      const { service } = createService({ counter: { initialSeconds: 3_600 } });

      const loaded = await service.load();

      expect(loaded.counter.initialSeconds).toBe(3_600);
      expect(loaded.rewards.sub.tier1).toBe(DEFAULT_CONFIG.rewards.sub.tier1);
    });

    it('revient aux valeurs par défaut lorsque le contenu est inexploitable', async () => {
      const { service, sink } = createService({ counter: { initialSeconds: -5 } });

      const loaded = await service.load();

      expect(loaded).toEqual(DEFAULT_CONFIG);
      expect(sink.records.some((record) => record.level === 'error')).toBe(true);
    });
  });

  describe('mise à jour partielle', () => {
    it('applique la modification demandée', async () => {
      const { service } = createService();
      await service.load();

      const updated = await service.update({ counter: { initialSeconds: 7_200 } });

      expect(updated.counter.initialSeconds).toBe(7_200);
    });

    it('préserve les réglages voisins de celui modifié', async () => {
      const { service } = createService();
      await service.load();

      const updated = await service.update({ rewards: { sub: { tier1: 600 } } });

      expect(updated.rewards.sub.tier1).toBe(600);
      expect(updated.rewards.sub.tier2).toBe(DEFAULT_CONFIG.rewards.sub.tier2);
      expect(updated.rewards.bits.mode).toBe(DEFAULT_CONFIG.rewards.bits.mode);
    });

    it('persiste immédiatement la nouvelle configuration', async () => {
      const { service, double } = createService();
      await service.load();

      await service.update({ overlay: { fontSize: 120 } });

      expect(double.persisted).toMatchObject({ overlay: { fontSize: 120 } });
    });

    it('remplace intégralement un tableau plutôt que de le fusionner', async () => {
      const { service } = createService();
      await service.load();

      const updated = await service.update({
        rewards: { bits: { tiers: [{ minBits: 50, seconds: 30 }] } },
      });

      // Fusionner deux tableaux par index produirait un barème hybride que
      // l'utilisateur n'a jamais demandé.
      expect(updated.rewards.bits.tiers).toEqual([{ minBits: 50, seconds: 30 }]);
    });

    it('refuse une valeur invalide sans rien persister', async () => {
      const { service, double } = createService();
      await service.load();
      const avant = double.persisted;

      await expect(service.update({ server: { httpPort: 99_999 } })).rejects.toThrow();

      expect(double.persisted).toBe(avant);
      expect(service.get().server.httpPort).toBe(DEFAULT_CONFIG.server.httpPort);
    });

    it('conserve l\'état en mémoire lorsque la persistance échoue', async () => {
      const { service, double } = createService();
      await service.load();
      double.failNextWrite(new Error('disque plein'));

      await expect(service.update({ overlay: { fontSize: 42 } })).rejects.toThrow();

      // L'utilisateur doit voir la valeur réellement persistée, pas celle qu'il
      // croyait avoir enregistrée.
      expect(service.get().overlay.fontSize).toBe(DEFAULT_CONFIG.overlay.fontSize);
    });

    it('notifie les abonnés du changement', async () => {
      const { service } = createService();
      await service.load();
      const listener = vi.fn();
      service.onChange(listener);

      await service.update({ overlay: { fontSize: 64 } });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0]?.[0]).toMatchObject({ overlay: { fontSize: 64 } });
    });

    it('cesse de notifier après désabonnement', async () => {
      const { service } = createService();
      await service.load();
      const listener = vi.fn();
      const unsubscribe = service.onChange(listener);

      unsubscribe();
      await service.update({ overlay: { fontSize: 64 } });

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('export et import', () => {
    it('exporte une configuration relisible', async () => {
      const { service } = createService();
      await service.load();

      const exported = service.export();

      expect(JSON.parse(exported)).toEqual(DEFAULT_CONFIG);
    });

    it('applique une configuration importée valide', async () => {
      const { service } = createService();
      await service.load();
      const candidate = { ...DEFAULT_CONFIG, counter: { ...DEFAULT_CONFIG.counter, initialSeconds: 1_800 } };

      const imported = await service.import(JSON.stringify(candidate));

      expect(imported.counter.initialSeconds).toBe(1_800);
    });

    it('refuse un JSON syntaxiquement invalide', async () => {
      const { service } = createService();
      await service.load();

      await expect(service.import('{ pas du json')).rejects.toBeInstanceOf(ConfigImportError);
    });

    it('refuse une configuration violant le schéma', async () => {
      const { service } = createService();
      await service.load();

      await expect(
        service.import(JSON.stringify({ server: { host: '0.0.0.0' } })),
      ).rejects.toBeInstanceOf(ConfigImportError);
    });

    it('laisse la configuration courante intacte après un import refusé', async () => {
      const { service } = createService();
      await service.load();

      await expect(service.import('{ pas du json')).rejects.toThrow();

      expect(service.get()).toEqual(DEFAULT_CONFIG);
    });

    it('écarte les clés inconnues d\'un fichier importé', async () => {
      const { service } = createService();
      await service.load();

      const imported = await service.import(
        JSON.stringify({ counter: { initialSeconds: 900 }, malveillant: { charge: 'utile' } }),
      );

      expect(imported).not.toHaveProperty('malveillant');
      expect(imported.counter.initialSeconds).toBe(900);
    });

    it('neutralise une tentative de pollution de prototype à l\'import', async () => {
      const { service } = createService();
      await service.load();

      await service.import('{"__proto__": {"compromis": true}}');

      expect(({} as Record<string, unknown>)['compromis']).toBeUndefined();
    });
  });

  describe('migration de version', () => {
    it('met à jour le numéro de version d\'une configuration ancienne', async () => {
      const { service } = createService({ schemaVersion: 0, counter: { initialSeconds: 600 } });

      const loaded = await service.load();

      expect(loaded.schemaVersion).toBe(CONFIG_SCHEMA_VERSION);
      expect(loaded.counter.initialSeconds).toBe(600);
    });

    it('persiste la configuration migrée', async () => {
      const { service, double } = createService({ schemaVersion: 0 });

      await service.load();

      expect(double.persisted).toMatchObject({ schemaVersion: CONFIG_SCHEMA_VERSION });
    });

    it('ne réécrit rien lorsque la version est déjà à jour', async () => {
      const { service, double } = createService();
      const avant = double.persisted;

      await service.load();

      expect(double.persisted).toBe(avant);
    });
  });
});
