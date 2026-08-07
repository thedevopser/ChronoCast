import { afterEach, describe, expect, it, vi } from 'vitest';

import { createNodeRuntime } from '../../../src/core/app/node-runtime.js';

describe('createNodeRuntime', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('minuteurs du hub WebSocket', () => {
    it('déclenche le rappel de façon répétée', async () => {
      const runtime = createNodeRuntime();
      let calls = 0;

      const id = runtime.hubTimers.setInterval(() => {
        calls += 1;
      }, 2);

      await vi.waitFor(() => {
        expect(calls).toBeGreaterThanOrEqual(2);
      });

      runtime.hubTimers.clearInterval(id);
    });

    it('arrête le rappel une fois annulé', async () => {
      const runtime = createNodeRuntime();
      let calls = 0;

      const id = runtime.hubTimers.setInterval(() => {
        calls += 1;
      }, 2);

      await vi.waitFor(() => {
        expect(calls).toBeGreaterThanOrEqual(1);
      });
      runtime.hubTimers.clearInterval(id);

      const observed = calls;
      await new Promise((done) => setTimeout(done, 20).unref());

      expect(calls).toBe(observed);
    });

    it('n’empêche pas le processus de se terminer', () => {
      const runtime = createNodeRuntime();

      const id = runtime.hubTimers.setInterval(() => undefined, 1_000);

      expect((id as unknown as NodeJS.Timeout).hasRef()).toBe(false);

      runtime.hubTimers.clearInterval(id);
    });
  });

  describe('minuteurs du client EventSub', () => {
    it('déclenche le rappel une fois', async () => {
      const runtime = createNodeRuntime();
      let calls = 0;

      runtime.eventSubTimers.setTimeout(() => {
        calls += 1;
      }, 2);

      await vi.waitFor(() => {
        expect(calls).toBe(1);
      });
    });

    it('n’exécute rien après annulation', async () => {
      const runtime = createNodeRuntime();
      let called = false;

      const id = runtime.eventSubTimers.setTimeout(() => {
        called = true;
      }, 5);
      runtime.eventSubTimers.clearTimeout(id);

      await new Promise((done) => setTimeout(done, 20).unref());

      expect(called).toBe(false);
    });

    it('n’empêche pas le processus de se terminer', () => {
      const runtime = createNodeRuntime();

      const id = runtime.eventSubTimers.setTimeout(() => undefined, 1_000);

      expect((id as unknown as NodeJS.Timeout).hasRef()).toBe(false);

      runtime.eventSubTimers.clearTimeout(id);
    });
  });

  describe('sleep', () => {
    it('résout après le délai demandé', async () => {
      const runtime = createNodeRuntime();
      const start = Date.now();

      await runtime.sleep(5);

      expect(Date.now() - start).toBeGreaterThanOrEqual(4);
    });

    it('n’empêche pas le processus de se terminer pendant l’attente', async () => {
      const runtime = createNodeRuntime();

      await expect(runtime.sleep(1)).resolves.toBeUndefined();
    });
  });

  describe('fetch', () => {
    it('délègue à l’implémentation globale', async () => {
      const global = vi.fn().mockResolvedValue(new Response('ok'));
      vi.stubGlobal('fetch', global);

      const runtime = createNodeRuntime();
      await runtime.fetch('https://exemple.test/');

      expect(global).toHaveBeenCalledWith('https://exemple.test/');
    });

    it('reste appelable détaché de son objet', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok')));

      const { fetch: detached } = createNodeRuntime();

      await expect(detached('https://exemple.test/')).resolves.toBeDefined();
    });
  });

  describe('fabrique de sockets', () => {
    it('fournit de quoi ouvrir une connexion EventSub', () => {
      const runtime = createNodeRuntime();

      expect(typeof runtime.createSocket).toBe('function');
    });
  });
});
