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
      expect(updated.rewards.bits.unit).toBe(DEFAULT_CONFIG.rewards.bits.unit);
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

      await service.update({
        goals: {
          tiers: [
            { target: 5, label: 'Premier' },
            { target: 10, label: 'Second' },
          ],
        },
      });

      const updated = await service.update({ goals: { tiers: [{ target: 50, label: 'Seul' }] } });

      expect(updated.goals.tiers).toEqual([{ target: 50, label: 'Seul' }]);
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

  describe('import et réglage Twitch de l’utilisateur', () => {
    const MINE = {
      ...DEFAULT_CONFIG,
      twitch: {
        ...DEFAULT_CONFIG.twitch,
        clientId: 'mon-application',
        broadcasterUserId: '1337',
        broadcasterLogin: 'moi',
        enableChatCommands: true,
        keepaliveTimeoutSeconds: 45,
      },
    };

    it('garde le réglage Twitch en place quand le fichier en apporte un autre', async () => {
      const { service } = createService(MINE);
      await service.load();
      const shared = {
        ...DEFAULT_CONFIG,
        twitch: { ...DEFAULT_CONFIG.twitch, clientId: 'son-application', broadcasterUserId: '42' },
      };

      const imported = await service.import(JSON.stringify(shared));

      expect(imported.twitch).toStrictEqual(MINE.twitch);
    });

    it('garde le réglage Twitch en place quand le fichier n’en apporte aucun', async () => {
      const { service } = createService(MINE);
      await service.load();
      const { twitch: _omitted, ...withoutTwitch } = DEFAULT_CONFIG;

      const imported = await service.import(JSON.stringify(withoutTwitch));

      expect(imported.twitch).toStrictEqual(MINE.twitch);
    });

    it('n’est pas refusé pour un réglage Twitch invalide, qu’il ignore', async () => {
      const { service } = createService(MINE);
      await service.load();
      const shared = { ...DEFAULT_CONFIG, twitch: { keepaliveTimeoutSeconds: 1 } };

      const imported = await service.import(JSON.stringify(shared));

      expect(imported.twitch).toStrictEqual(MINE.twitch);
    });

    it('écrit sur le disque le réglage Twitch gardé', async () => {
      const { service, double } = createService(MINE);
      await service.load();

      await service.import(JSON.stringify({ ...DEFAULT_CONFIG, twitch: { clientId: 'son-application' } }));

      expect(double.persisted).toMatchObject({ twitch: MINE.twitch });
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

    it('réécrit une configuration antérieure au Happy Hour pour qu\'elle porte la clé', async () => {
      const legacy = structuredClone(DEFAULT_CONFIG) as unknown as Record<string, unknown> & {
        rewards: Record<string, unknown>;
      };
      legacy['schemaVersion'] = 2;
      delete legacy.rewards['happyHour'];
      const { service, double } = createService(legacy);

      const loaded = await service.load();

      expect(loaded.rewards.happyHour).toBe(false);
      expect(double.persisted).toMatchObject({ rewards: { happyHour: false } });
    });

    describe('import d’une configuration exportée quand la barre comptait en abonnements', () => {
      const EXPORTED = {
        schemaVersion: 5,
        goals: {
          bitsPerSub: 500,
          tiers: [{ target: 50, label: 'Je me rase la tête' }],
          overlay: { fontSize: 40 },
        },
        rewards: { bits: { mode: 'tiers', linear: {}, tiers: [{ minBits: 200, seconds: 100 }] } },
      };

      it('garde sa barre, en mode subs, avec ses paliers et son apparence', async () => {
        const { service } = createService();
        await service.load();

        const imported = await service.import(JSON.stringify(EXPORTED));

        expect(imported.goals.mode).toBe('subs');
        expect(imported.goals.unitLabel).toBe('abo.');
        expect(imported.goals.tiers).toStrictEqual([{ target: 50, label: 'Je me rase la tête' }]);
        expect(imported.goals.overlay.fontSize).toBe(40);
      });

      it('convertit ses paliers de bits en taux unique', async () => {
        const { service } = createService();
        await service.load();

        const imported = await service.import(JSON.stringify(EXPORTED));

        expect(imported.rewards.bits).toStrictEqual({ unit: 200, seconds: 100 });
      });

      it('laisse en mode points une configuration exportée depuis', async () => {
        const { service } = createService();
        await service.load();

        const imported = await service.import(
          JSON.stringify({ ...EXPORTED, schemaVersion: CONFIG_SCHEMA_VERSION }),
        );

        expect(imported.goals.mode).toBe('points');
        expect(imported.goals.tiers).toStrictEqual([{ target: 50, label: 'Je me rase la tête' }]);
      });
    });

    describe('import d’une configuration qui ne porte pas de barème Happy Hour', () => {
      const LEGACY = {
        schemaVersion: 5,
        rewards: {
          happyHour: true,
          sub: { prime: 100, tier1: 300, tier2: 600, tier3: 900 },
        },
      };

      it('le dérive du barème importé, doublé', async () => {
        const { service } = createService();
        await service.load();

        const imported = await service.import(JSON.stringify(LEGACY));

        expect(imported.rewards.happyHourRewards.sub.tier1).toBe(600);
        expect(imported.rewards.happyHourRewards.gift.tier1).toBe(360);
      });

      it('respecte un barème Happy Hour déjà réglé', async () => {
        const { service } = createService();
        await service.load();

        const imported = await service.import(
          JSON.stringify({
            ...LEGACY,
            rewards: { ...LEGACY.rewards, happyHourRewards: { sub: { tier1: 42 } } },
          }),
        );

        expect(imported.rewards.happyHourRewards.sub.tier1).toBe(42);
      });
    });

    it('ne réécrit rien lorsque la version est déjà à jour', async () => {
      const { service, double } = createService();
      const avant = double.persisted;

      await service.load();

      expect(double.persisted).toBe(avant);
    });
  });
});
