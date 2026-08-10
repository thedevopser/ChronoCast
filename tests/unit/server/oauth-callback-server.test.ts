import { describe, expect, it } from 'vitest';

import { createLogger } from '../../../src/core/logging/logger.js';
import {
  createOAuthCallbackServer,
  OAUTH_CALLBACK_TTL_MS,
} from '../../../src/core/server/oauth-callback-server.js';
import type { Router } from '../../../src/core/server/router.js';

const SILENT_ROUTER: Router = {
  handle: () => Promise.resolve({ status: 204, headers: {}, body: '' }),
};

function createHarness(options: { failStart?: boolean } = {}) {
  const events: string[] = [];
  const pending = new Map<number, { run: () => void; delay: number }>();
  let nextTimerId = 1;

  const server = createOAuthCallbackServer({
    router: SILENT_ROUTER,
    createServer: () => {
      events.push('créé');
      return {
        start: () => {
          if (options.failStart === true) {
            return Promise.reject(new Error('EADDRINUSE'));
          }
          events.push('démarré');
          return Promise.resolve(37_771);
        },
        stop: () => {
          events.push('arrêté');
          return Promise.resolve();
        },
      };
    },
    timers: {
      setTimeout: (run, delay) => {
        const id = nextTimerId++;
        pending.set(id, { run, delay });
        return id;
      },
      clearTimeout: (id) => {
        pending.delete(id);
      },
    },
    logger: createLogger({ level: 'error', sinks: [] }),
  });

  return {
    server,
    events,
    delays: () => [...pending.values()].map((entry) => entry.delay),
    pendingCount: () => pending.size,
    expire: () => {
      const [id] = [...pending.keys()];
      if (id === undefined) {
        throw new Error('aucune expiration programmée');
      }
      const entry = pending.get(id);
      pending.delete(id);
      entry?.run();
    },
  };
}

describe('createOAuthCallbackServer', () => {
  describe('armement', () => {
    it('n’écoute pas tant qu’aucun flux n’est ouvert', () => {
      const harness = createHarness();

      expect(harness.server.isArmed()).toBe(false);
      expect(harness.events).toStrictEqual([]);
    });

    it('démarre le serveur à l’armement', async () => {
      const harness = createHarness();

      await harness.server.arm();

      expect(harness.events).toStrictEqual(['créé', 'démarré']);
      expect(harness.server.isArmed()).toBe(true);
    });

    it('programme l’extinction automatique', async () => {
      const harness = createHarness();

      await harness.server.arm();

      expect(harness.delays()).toStrictEqual([OAUTH_CALLBACK_TTL_MS]);
    });

    it('ne démarre pas un second serveur si l’on réarme', async () => {
      const harness = createHarness();
      await harness.server.arm();

      await harness.server.arm();

      expect(harness.events).toStrictEqual(['créé', 'démarré']);
      expect(harness.pendingCount()).toBe(1);
    });

    it('propage un port déjà occupé', async () => {
      const harness = createHarness({ failStart: true });

      await expect(harness.server.arm()).rejects.toThrow(/EADDRINUSE/u);
      expect(harness.server.isArmed()).toBe(false);
    });
  });

  describe('extinction', () => {
    it('arrête le serveur et annule l’expiration', async () => {
      const harness = createHarness();
      await harness.server.arm();

      await harness.server.disarm();

      expect(harness.events).toStrictEqual(['créé', 'démarré', 'arrêté']);
      expect(harness.pendingCount()).toBe(0);
      expect(harness.server.isArmed()).toBe(false);
    });

    it('s’éteint seul à l’échéance', async () => {
      const harness = createHarness();
      await harness.server.arm();

      harness.expire();
      await Promise.resolve();

      expect(harness.events).toContain('arrêté');
      expect(harness.server.isArmed()).toBe(false);
    });

    it('accepte d’être désarmé alors qu’il ne l’était pas', async () => {
      const harness = createHarness();

      await expect(harness.server.disarm()).resolves.toBeUndefined();
      expect(harness.events).toStrictEqual([]);
    });

    it('peut être réarmé après extinction', async () => {
      const harness = createHarness();
      await harness.server.arm();
      await harness.server.disarm();

      await harness.server.arm();

      expect(harness.events).toStrictEqual(['créé', 'démarré', 'arrêté', 'créé', 'démarré']);
      expect(harness.server.isArmed()).toBe(true);
    });
  });
});
