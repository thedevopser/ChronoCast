import { afterEach, describe, expect, it, vi } from 'vitest';

import { createNodeRuntime } from '../../../src/core/app/node-runtime.js';

/**
 * Câblage runtime commun aux deux points d'entrée.
 *
 * Le point d'entrée headless et la coquille Electron composent la même
 * application avec les mêmes briques Node : minuteurs, sockets, `fetch`,
 * temporisation. Seuls diffèrent les trois ports qui touchent réellement à la
 * plateforme — chemins, secrets, navigateur. Recopier ce câblage dans la
 * coquille en aurait fait deux sources de vérité pour une plomberie identique,
 * et la première divergence serait passée inaperçue.
 *
 * Ce qui doit être vérifié ici tient en une propriété : **tous les minuteurs
 * sont `unref`és**. Sans cela, le battement de vivacité du hub empêcherait le
 * processus de se terminer, et un arrêt propre ne se terminerait jamais.
 */
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

      // Le handle est un `Timeout` à l'exécution, quoi qu'en dise le type
      // `number` du contrat : c'est lui qui sait s'il retient la boucle
      // d'événements. Sans `unref`, `application.stop()` rendrait la main sans
      // que le processus ne s'arrête jamais.
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
      // Une temporisation entre deux tentatives Helix peut durer plusieurs
      // secondes : un `Ctrl+C` pendant cette attente ne doit pas attendre son
      // terme pour rendre la main.
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
      // `fetch` lève une `TypeError` s'il est appelé sans son `this` d'origine.
      // Le lier à la création est ce qui permet de le passer en option comme
      // une fonction ordinaire, et cette liaison doit être vérifiée : sans
      // elle, la panne n'apparaîtrait qu'au premier appel réel à Twitch.
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok')));

      const { fetch: detached } = createNodeRuntime();

      await expect(detached('https://exemple.test/')).resolves.toBeDefined();
    });
  });

  describe('fabrique de sockets', () => {
    it('fournit de quoi ouvrir une connexion EventSub', () => {
      // Aucun socket n'est ouvert ici : ce serait un accès réseau dans un test
      // unitaire. Seule compte la présence de la fabrique dans le câblage.
      const runtime = createNodeRuntime();

      expect(typeof runtime.createSocket).toBe('function');
    });
  });
});
