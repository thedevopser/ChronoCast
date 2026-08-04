import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createLogger, type LogSink } from '../../../src/core/logging/logger.js';
import type { UpdateInstaller } from '../../../src/core/app/ports.js';
import { sha256Hex } from '../../../src/core/update/digest.js';
import {
  createUpdateService,
  type UpdateFileStore,
  type UpdateService,
  type UpdateStatus,
} from '../../../src/core/update/update-service.js';
import { OWNER, REPO, githubRelease } from '../../fixtures/github-release.js';

/**
 * Le service de mise à jour, de bout en bout et sans rien toucher de réel.
 *
 * `fetch`, minuteurs, horloge, disque et lancement de l'installeur sont tous
 * injectés : aucun test n'ouvre de socket, n'attend une durée réelle ni n'écrit
 * un octet. C'est la condition pour que la seule chose qu'on ne puisse pas
 * vérifier ici soit le `spawn` lui-même, qui tient en cinq lignes dans la
 * coquille.
 *
 * L'invariant que ces tests défendent avant tout : **rien n'est lancé qui n'ait
 * été vérifié**, et **rien ne s'installe sans qu'on l'ait demandé**.
 */

const CURRENT = '0.5.0';
const INSTALLER = 'ChronoCast-Setup-0.5.1.exe';
const BYTES = new TextEncoder().encode('MZ ceci est un installeur');
const DIGEST = sha256Hex(BYTES);

const SILENT: LogSink = { name: 'silencieux', write: () => undefined };

/* -------------------------------------------------------------------------- */
/* Doubles                                                                     */
/* -------------------------------------------------------------------------- */

/** Minuteurs manuels : rien ne se déclenche tant qu'un test ne le demande. */
function createManualTimers() {
  const pending = new Map<number, () => void>();
  let next = 1;

  return {
    timers: {
      setTimeout(handler: () => void, _ms: number): number {
        const id = next++;
        pending.set(id, handler);
        return id;
      },
      clearTimeout(id: number): void {
        pending.delete(id);
      },
    },
    /** Déclenche tous les minuteurs armés, une fois chacun. */
    fire(): void {
      const armed = [...pending.entries()];
      pending.clear();
      for (const [, handler] of armed) {
        handler();
      }
    },
    get armedCount(): number {
      return pending.size;
    },
  };
}

interface FakeStore extends UpdateFileStore {
  readonly saved: Map<string, Uint8Array>;
  cleared: number;
}

function createFakeStore(): FakeStore {
  const saved = new Map<string, Uint8Array>();

  return {
    saved,
    cleared: 0,
    clear(): Promise<void> {
      this.cleared += 1;
      saved.clear();
      return Promise.resolve();
    },
    save(name: string, bytes: Uint8Array): Promise<string> {
      saved.set(name, bytes);
      return Promise.resolve(`/données/updates/${name}`);
    },
  };
}

interface FakeInstaller extends UpdateInstaller {
  readonly launched: string[];
}

function createFakeInstaller(): FakeInstaller {
  const launched: string[] = [];

  return {
    launched,
    run(path: string): Promise<void> {
      launched.push(path);
      return Promise.resolve();
    },
  };
}

/**
 * `fetch` scénarisé : une réponse par URL.
 *
 * Le service fait trois appels dans un cas nominal — la release, le condensat,
 * l'installeur — et l'ordre dans lequel il les fait est une décision qu'on veut
 * pouvoir observer.
 */
function createFakeFetch(routes: Record<string, () => Response>) {
  const calls: string[] = [];

  const fake = (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);

    const route = Object.entries(routes).find(([pattern]) => url.includes(pattern));
    if (route === undefined) {
      return Promise.resolve(new Response('introuvable', { status: 404 }));
    }

    return Promise.resolve(route[1]());
  };

  return { fetch: fake, calls };
}

/** Les trois réponses d'un scénario qui aboutit. */
function happyRoutes(overrides: Record<string, () => Response> = {}) {
  return {
    'api.github.com': () => Response.json(githubRelease('0.5.1')),
    [`${INSTALLER}.sha256`]: () => new Response(`${DIGEST}  ${INSTALLER}\n`),
    [`/download/v0.5.1/${INSTALLER}`]: () => new Response(BYTES),
    ...overrides,
  };
}

interface Harness {
  service: UpdateService;
  store: FakeStore;
  installer: FakeInstaller;
  statuses: UpdateStatus[];
  timers: ReturnType<typeof createManualTimers>;
  calls: string[];
  enabled: boolean;
}

function createHarness(
  options: { routes?: Record<string, () => Response>; enabled?: boolean; store?: FakeStore } = {},
): Harness {
  const timers = createManualTimers();
  const store = options.store ?? createFakeStore();
  const installer = createFakeInstaller();
  const statuses: UpdateStatus[] = [];
  const { fetch, calls } = createFakeFetch(options.routes ?? happyRoutes());

  const harness: Harness = {
    store,
    installer,
    statuses,
    timers,
    calls,
    enabled: options.enabled ?? true,
    service: undefined as unknown as UpdateService,
  };

  harness.service = createUpdateService({
    currentVersion: CURRENT,
    owner: OWNER,
    repo: REPO,
    fetch,
    timers: timers.timers,
    clock: { now: () => 1_700_000_000_000, monotonicMs: () => 0 },
    files: store,
    installer,
    logger: createLogger({ level: 'debug', sinks: [SILENT] }),
    isEnabled: () => harness.enabled,
    onStatus: (status) => statuses.push(status),
  });

  return harness;
}

/* -------------------------------------------------------------------------- */
/* Tests                                                                       */
/* -------------------------------------------------------------------------- */

describe('createUpdateService', () => {
  describe('cas nominal', () => {
    it('télécharge, vérifie et se déclare prêt', async () => {
      const h = createHarness();

      await h.service.check();

      expect(h.service.getStatus()).toMatchObject({
        phase: 'ready',
        availableVersion: '0.5.1',
        currentVersion: CURRENT,
      });
      expect([...h.store.saved.keys()]).toEqual([INSTALLER]);
    });

    it('n’écrit sur le disque qu’après avoir vérifié le condensat', async () => {
      // L'ordre est l'invariant : un fichier écrit avant vérification serait un
      // exécutable non vérifié posé dans `%APPDATA%`, que rien n'empêcherait
      // ensuite de lancer à la main.
      const h = createHarness();

      await h.service.check();

      const digestCall = h.calls.findIndex((url) => url.endsWith('.sha256'));
      const installerCall = h.calls.findIndex((url) => url.endsWith(INSTALLER));

      expect(digestCall).toBeGreaterThanOrEqual(0);
      expect(digestCall).toBeLessThan(installerCall);
    });

    it('publie chaque transition d’état', async () => {
      const h = createHarness();

      await h.service.check();

      expect(h.statuses.map((status) => status.phase)).toEqual(['checking', 'downloading', 'ready']);
    });

    it('n’annonce rien à installer quand l’application est à jour', async () => {
      const h = createHarness({
        routes: { 'api.github.com': () => Response.json(githubRelease(CURRENT)) },
      });

      await h.service.check();

      expect(h.service.getStatus()).toMatchObject({ phase: 'idle', availableVersion: null });
      expect(h.store.saved.size).toBe(0);
    });
  });

  describe('intégrité', () => {
    it('ne conserve rien quand le condensat ne correspond pas', async () => {
      // Le test central du lot. Un installeur dont l'empreinte diffère est un
      // installeur qui n'est pas celui qui a été publié — et rien, dans
      // Windows, ne le dira à l'utilisateur à notre place.
      const h = createHarness({
        routes: happyRoutes({
          [`${INSTALLER}.sha256`]: () => new Response(`${'ab'.repeat(32)}  ${INSTALLER}\n`),
        }),
      });

      await h.service.check();

      expect(h.service.getStatus().phase).toBe('error');
      expect(h.store.saved.size).toBe(0);
    });

    it('refuse d’installer quand le condensat ne correspond pas', async () => {
      const h = createHarness({
        routes: happyRoutes({
          [`${INSTALLER}.sha256`]: () => new Response(`${'ab'.repeat(32)}  ${INSTALLER}\n`),
        }),
      });

      await h.service.check();
      await expect(h.service.install()).rejects.toThrow();

      expect(h.installer.launched).toEqual([]);
    });

    it('refuse un condensat portant sur un autre fichier', async () => {
      const h = createHarness({
        routes: happyRoutes({
          [`${INSTALLER}.sha256`]: () => new Response(`${DIGEST}  autre-chose.exe\n`),
        }),
      });

      await h.service.check();

      expect(h.service.getStatus().phase).toBe('error');
      expect(h.store.saved.size).toBe(0);
    });

    it('refuse un installeur plus gros que ce que la release annonce', async () => {
      // Une réponse sans fin remplirait le disque de l'utilisateur, et le
      // ferait pendant un direct.
      const enorme = new Uint8Array(4_000_000);
      const h = createHarness({
        routes: happyRoutes({
          [`/download/v0.5.1/${INSTALLER}`]: () => new Response(enorme),
        }),
      });

      await h.service.check();

      expect(h.service.getStatus().phase).toBe('error');
      expect(h.store.saved.size).toBe(0);
    });
  });

  describe('échecs réseau', () => {
    it('survit à un `fetch` qui lève', async () => {
      const h = createHarness({
        routes: {
          'api.github.com': () => {
            throw new Error('réseau injoignable');
          },
        },
      });

      await expect(h.service.check()).resolves.toMatchObject({ phase: 'error' });
    });

    it('survit à un quota GitHub dépassé', async () => {
      const h = createHarness({
        routes: { 'api.github.com': () => new Response('rate limit', { status: 403 }) },
      });

      await h.service.check();

      expect(h.service.getStatus().phase).toBe('error');
    });

    it('survit à une charge utile qui n’est pas du JSON', async () => {
      const h = createHarness({
        routes: { 'api.github.com': () => new Response('<html>maintenance</html>') },
      });

      await h.service.check();

      expect(h.service.getStatus().phase).toBe('error');
    });

    it('se remet d’un échec à la vérification suivante', async () => {
      let premier = true;
      const h = createHarness({
        routes: happyRoutes({
          'api.github.com': () => {
            if (premier) {
              premier = false;
              return new Response('rate limit', { status: 403 });
            }
            return Response.json(githubRelease('0.5.1'));
          },
        }),
      });

      await h.service.check();
      expect(h.service.getStatus().phase).toBe('error');

      await h.service.check();
      expect(h.service.getStatus().phase).toBe('ready');
    });

    it('envoie un `User-Agent`, faute de quoi GitHub refuse la requête', async () => {
      const seen: (HeadersInit | undefined)[] = [];
      const h = createHarness();

      // Le double de `fetch` ne conserve pas les en-têtes : on les observe par
      // un second service câblé sur un espion.
      const spy = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        seen.push(init?.headers);
        return Promise.resolve(Response.json(githubRelease(CURRENT)));
      });

      const service = createUpdateService({
        currentVersion: CURRENT,
        owner: OWNER,
        repo: REPO,
        fetch: spy,
        timers: h.timers.timers,
        clock: { now: () => 0, monotonicMs: () => 0 },
        files: h.store,
        installer: h.installer,
        logger: createLogger({ level: 'debug', sinks: [SILENT] }),
        isEnabled: () => true,
        onStatus: () => undefined,
      });

      await service.check();

      expect(JSON.stringify(seen[0])).toContain('User-Agent');
    });
  });

  describe('installation', () => {
    it('lance l’installeur vérifié, et lui seul', async () => {
      const h = createHarness();

      await h.service.check();
      await h.service.install();

      expect(h.installer.launched).toEqual([`/données/updates/${INSTALLER}`]);
    });

    it('refuse d’installer tant que rien n’est prêt', async () => {
      // Le panneau et le tray n'affichent le bouton que sur l'état `ready`,
      // mais l'API est atteignable directement : le refus vit ici, pas dans la
      // vue.
      const h = createHarness();

      await expect(h.service.install()).rejects.toThrow();
      expect(h.installer.launched).toEqual([]);
    });

    it('n’installe jamais de lui-même', async () => {
      // Le point qui protège le direct : télécharger est automatique,
      // installer ne l'est jamais. Aucun chemin ne doit mener à `run` sans un
      // appel explicite.
      const h = createHarness();

      await h.service.check();
      h.timers.fire();

      expect(h.installer.launched).toEqual([]);
    });
  });

  describe('nettoyage et téléchargement ne se marchent pas dessus', () => {
    /**
     * Magasin dont le nettoyage ne se termine que sur demande.
     *
     * C'est le seul moyen d'éprouver l'ordre de façon déterministe : le défaut
     * d'origine ne se voyait que sous charge, et une suite verte quatre-vingt
     * dix-neuf fois sur cent est pire qu'une suite rouge.
     */
    function createDeferredStore(): { store: FakeStore; finishClear: () => void } {
      const store = createFakeStore();
      let finish!: () => void;
      const pending = new Promise<void>((resolve) => {
        finish = resolve;
      });

      store.clear = () => {
        store.cleared += 1;
        return pending.then(() => {
          store.saved.clear();
        });
      };

      return { store, finishClear: finish };
    }

    it('n’écrit pas tant que le nettoyage du démarrage n’est pas terminé', async () => {
      // Le défaut tel qu'il s'est produit : `start()` lançait `clear()` sans
      // l'attendre, si bien qu'un `rm -rf` lent effaçait l'installeur écrit
      // entre-temps. En production le premier contrôle est différé de trente
      // secondes et la course ne se voyait pas ; sous charge, si.
      //
      // L'assertion porte sur l'**ordre** et non sur la survie du fichier :
      // observer la survie dépendrait de l'ordonnancement des microtâches,
      // c'est-à-dire d'un test vert quatre-vingt-dix-neuf fois sur cent — pire
      // qu'un test rouge.
      const { store, finishClear } = createDeferredStore();
      const h = createHarness({ store });

      h.service.start();
      const checking = h.service.check();

      // Les trois requêtes parties, le téléchargement est allé aussi loin
      // qu'il pouvait : sans le correctif, l'écriture a déjà eu lieu ici.
      await vi.waitFor(() => {
        expect(h.calls).toHaveLength(3);
      });
      await new Promise((resolve) => setImmediate(resolve));

      expect(store.saved.size).toBe(0);

      finishClear();
      await checking;

      expect([...store.saved.keys()]).toEqual([INSTALLER]);
      expect(h.service.getStatus().phase).toBe('ready');
    });

    it('n’écrit rien si le réglage a été coupé pendant le téléchargement', async () => {
      // L'autre moitié de la même course. Couper le réglage vide le
      // répertoire ; un téléchargement déjà lancé ne doit pas y déposer un
      // installeur juste après, sans quoi l'utilisateur se retrouverait avec
      // cent mégaoctets qu'il vient explicitement de refuser.
      const h = createHarness();

      const checking = h.service.check();
      h.enabled = false;
      await checking;

      expect(h.store.saved.size).toBe(0);
      expect(h.installer.launched).toEqual([]);
    });
  });

  describe('cadence', () => {
    it('ne vérifie rien au démarrage, mais arme un premier rendez-vous', () => {
      // Disputer le démarrage au service de l'overlay pour aller interroger
      // GitHub serait payer une commodité avec ce que l'utilisateur attend.
      const h = createHarness();

      h.service.start();

      expect(h.calls).toEqual([]);
      expect(h.timers.armedCount).toBe(1);
    });

    it('vérifie au premier rendez-vous puis se réarme', async () => {
      const h = createHarness();

      h.service.start();
      h.timers.fire();
      await vi.waitFor(() => {
        expect(h.service.getStatus().phase).toBe('ready');
      });

      expect(h.timers.armedCount).toBe(1);
    });

    it('vide le répertoire des téléchargements au démarrage', () => {
      // Un `.exe` laissé là est celui d'une version déjà installée, et il pèse
      // une centaine de mégaoctets.
      const h = createHarness();

      h.service.start();

      expect(h.store.cleared).toBe(1);
    });

    it('désarme tout à l’arrêt', () => {
      const h = createHarness();

      h.service.start();
      h.service.stop();

      expect(h.timers.armedCount).toBe(0);
    });
  });

  describe('réglage', () => {
    it('n’émet aucune requête quand la mise à jour est désactivée', async () => {
      const h = createHarness({ enabled: false });

      h.service.start();
      await h.service.check();

      expect(h.calls).toEqual([]);
      expect(h.service.getStatus().phase).toBe('disabled');
    });

    it('n’arme aucun minuteur quand la mise à jour est désactivée', () => {
      const h = createHarness({ enabled: false });

      h.service.start();

      expect(h.timers.armedCount).toBe(0);
    });

    it('reprend la main dès que le réglage est réactivé', async () => {
      const h = createHarness({ enabled: false });

      h.service.start();
      h.enabled = true;
      h.service.refresh();

      await vi.waitFor(() => {
        expect(h.service.getStatus().phase).not.toBe('disabled');
      });
      expect(h.timers.armedCount).toBe(1);
    });

    it('oublie ce qui était prêt quand le réglage est coupé', async () => {
      // Laisser un bouton « installer » actif alors que l'utilisateur vient de
      // dire non ferait dire à l'interface l'inverse du réglage.
      const h = createHarness();

      await h.service.check();
      expect(h.service.getStatus().phase).toBe('ready');

      h.enabled = false;
      h.service.refresh();

      expect(h.service.getStatus().phase).toBe('disabled');
      expect(h.store.saved.size).toBe(0);
    });
  });
});

describe('createUpdateService sans port d’installation', () => {
  let statuses: UpdateStatus[];

  beforeEach(() => {
    statuses = [];
  });

  it('reste inerte quand aucun installeur n’est fourni', async () => {
    // C'est le cas du point d'entrée headless : il n'est ni packagé ni
    // installé, et proposer une mise à jour qu'il ne saurait pas appliquer
    // serait une promesse en l'air.
    const timers = createManualTimers();
    const { fetch, calls } = createFakeFetch(happyRoutes());

    const service = createUpdateService({
      currentVersion: CURRENT,
      owner: OWNER,
      repo: REPO,
      fetch,
      timers: timers.timers,
      clock: { now: () => 0, monotonicMs: () => 0 },
      files: createFakeStore(),
      installer: null,
      logger: createLogger({ level: 'debug', sinks: [SILENT] }),
      isEnabled: () => true,
      onStatus: (status) => statuses.push(status),
    });

    service.start();
    await service.check();

    expect(calls).toEqual([]);
    expect(timers.armedCount).toBe(0);
    expect(service.getStatus().phase).toBe('unsupported');
  });
});
