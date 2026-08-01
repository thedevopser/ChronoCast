import { describe, expect, it, vi } from 'vitest';

import type { SecretStore } from '../../../src/core/app/ports.js';
import { createLogger, type LogRecord, type LogSink } from '../../../src/core/logging/logger.js';
import { createRedactor, REDACTED } from '../../../src/core/logging/redaction.js';
import { createTokenStore } from '../../../src/core/twitch/token-store.js';
import type { TwitchCredentials } from '../../../src/core/twitch/token-store.js';

/**
 * Le magasin de jetons est le point de convergence des trois secrets de
 * ChronoCast : le secret client de l'application Twitch, le jeton d'accès et le
 * jeton de rafraîchissement.
 *
 * Il porte deux responsabilités que rien d'autre ne couvre. La première est le
 * chiffrement au repos, délégué au port `SecretStore` — sous Windows,
 * `safeStorage` s'adosse à DPAPI, si bien qu'un autre compte de la même machine
 * ne peut pas déchiffrer les jetons. La seconde est l'enregistrement des valeurs
 * auprès du rédacteur : dès qu'un jeton est connu, il devient impossible de le
 * faire apparaître dans un log, où qu'il se glisse.
 */

const CREDENTIALS: TwitchCredentials = {
  clientSecret: 'secret-client-tres-long-abc123',
  accessToken: 'jeton-acces-abcdef123456',
  refreshToken: 'jeton-refresh-zyxwvu987654',
  expiresAt: 1_754_000_000_000,
  scopes: ['channel:read:subscriptions', 'bits:read'],
};

function createSecretStoreDouble(options: { encryptionAvailable?: boolean } = {}) {
  const values = new Map<string, string>();

  const secretStore: SecretStore = {
    isEncryptionAvailable: () => options.encryptionAvailable ?? true,
    read: (key: string) => Promise.resolve(values.get(key) ?? null),
    write: (key: string, value: string) => {
      values.set(key, value);
      return Promise.resolve();
    },
    delete: (key: string) => {
      values.delete(key);
      return Promise.resolve();
    },
  };

  return { secretStore, values };
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

function createStore(options: { encryptionAvailable?: boolean } = {}) {
  const double = createSecretStoreDouble(options);
  const redactor = createRedactor();
  const sink = createMemorySink();
  const logger = createLogger({ level: 'debug', sinks: [sink], redactor });

  return {
    store: createTokenStore({ secretStore: double.secretStore, redactor, logger }),
    double,
    redactor,
    sink,
    logger,
  };
}

describe('createTokenStore', () => {
  describe('cycle nominal', () => {
    it('relit les identifiants qui viennent d\'être enregistrés', async () => {
      const { store } = createStore();

      await store.save(CREDENTIALS);

      await expect(store.load()).resolves.toEqual(CREDENTIALS);
    });

    it('ne renvoie rien avant tout enregistrement', async () => {
      const { store } = createStore();

      await expect(store.load()).resolves.toBeNull();
    });

    it('efface les identifiants sur demande', async () => {
      const { store } = createStore();
      await store.save(CREDENTIALS);

      await store.clear();

      await expect(store.load()).resolves.toBeNull();
    });

    it('remplace les identifiants précédents lors d\'un nouvel enregistrement', async () => {
      const { store } = createStore();
      await store.save(CREDENTIALS);

      const renouveles: TwitchCredentials = { ...CREDENTIALS, accessToken: 'nouveau-jeton-acces-123' };
      await store.save(renouveles);

      await expect(store.load()).resolves.toEqual(renouveles);
    });
  });

  describe('protection des secrets dans les logs', () => {
    it('rend le jeton d\'accès inloggable dès son enregistrement', async () => {
      const { store, logger, sink } = createStore();

      await store.save(CREDENTIALS);
      logger.info(`appel refusé avec ${CREDENTIALS.accessToken}`);

      expect(sink.records.at(-1)?.message).toBe(`appel refusé avec ${REDACTED}`);
    });

    it('protège aussi le jeton de rafraîchissement et le secret client', async () => {
      const { store, logger, sink } = createStore();

      await store.save(CREDENTIALS);
      logger.info(`${CREDENTIALS.refreshToken} et ${CREDENTIALS.clientSecret}`);

      expect(sink.records.at(-1)?.message).toBe(`${REDACTED} et ${REDACTED}`);
    });

    it('protège les jetons relus au démarrage', async () => {
      // Au lancement suivant, les jetons viennent du disque et non d'un appel à
      // save : ils doivent être protégés tout autant.
      const premier = createStore();
      await premier.store.save(CREDENTIALS);
      const serialise = [...premier.double.values.entries()];

      const second = createStore();
      for (const [key, value] of serialise) {
        await second.double.secretStore.write(key, value);
      }
      await second.store.load();
      second.logger.info(CREDENTIALS.accessToken);

      expect(second.sink.records.at(-1)?.message).toBe(REDACTED);
    });

    it('cesse de masquer les jetons après effacement', async () => {
      const { store, logger, sink } = createStore();
      await store.save(CREDENTIALS);

      await store.clear();
      logger.info(CREDENTIALS.accessToken);

      // Un jeton révoqué n'est plus un secret : continuer à le masquer
      // encombrerait inutilement les logs.
      expect(sink.records.at(-1)?.message).toBe(CREDENTIALS.accessToken);
    });
  });

  describe('robustesse', () => {
    it('ne renvoie rien lorsque le contenu stocké est illisible', async () => {
      const { store, double } = createStore();
      await double.secretStore.write('twitch-credentials', 'pas du json');

      await expect(store.load()).resolves.toBeNull();
    });

    it('journalise un avertissement pour un contenu illisible', async () => {
      const { store, double, sink } = createStore();
      await double.secretStore.write('twitch-credentials', 'pas du json');

      await store.load();

      expect(sink.records.some((record) => record.level === 'warning')).toBe(true);
    });

    it('ne renvoie rien lorsqu\'un champ obligatoire manque', async () => {
      const { store, double } = createStore();
      await double.secretStore.write(
        'twitch-credentials',
        JSON.stringify({ accessToken: 'seul', expiresAt: 1 }),
      );

      await expect(store.load()).resolves.toBeNull();
    });

    it('propage un échec d\'écriture du magasin de secrets', async () => {
      // Ne pas pouvoir enregistrer un jeton fraîchement obtenu doit être visible
      // de l'appelant : l'utilisateur devra sinon se réauthentifier sans le
      // comprendre au prochain démarrage.
      const { store, double } = createStore();
      vi.spyOn(double.secretStore, 'write').mockRejectedValueOnce(new Error('trousseau verrouillé'));

      await expect(store.save(CREDENTIALS)).rejects.toThrow();
    });
  });

  describe('disponibilité du chiffrement', () => {
    it('avertit lorsque le chiffrement du système n\'est pas disponible', async () => {
      const { store, sink } = createStore({ encryptionAvailable: false });

      await store.save(CREDENTIALS);

      const alerte = sink.records.find((record) => record.level === 'warning');
      expect(alerte?.message).toContain('chiffrement');
    });

    it('enregistre malgré tout les identifiants', async () => {
      // Refuser d'enregistrer rendrait l'application inutilisable ; l'utilisateur
      // est averti et décide.
      const { store } = createStore({ encryptionAvailable: false });

      await store.save(CREDENTIALS);

      await expect(store.load()).resolves.toEqual(CREDENTIALS);
    });

    it('n\'avertit pas lorsque le chiffrement est disponible', async () => {
      const { store, sink } = createStore({ encryptionAvailable: true });

      await store.save(CREDENTIALS);

      expect(sink.records.some((record) => record.level === 'warning')).toBe(false);
    });
  });
});
