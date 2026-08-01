/**
 * Client WebSocket des pages, et sa reconnexion.
 *
 * Le risque couvert est propre à OBS. Une Browser Source n'est **jamais**
 * rechargée automatiquement : elle est chargée une fois, au démarrage de la
 * scène, et vit ensuite des heures. Si la connexion tombe — redémarrage de
 * ChronoCast, mise en veille de la machine, changement de port — personne ne
 * viendra rafraîchir la page. Le client doit donc se reconnecter seul,
 * indéfiniment, sans intervention.
 *
 * Ce qu'il ne doit pas faire non plus : marteler le serveur. D'où le retrait
 * exponentiel plafonné, vérifié ici sur la suite complète des délais plutôt
 * que sur le premier.
 *
 * Rien n'attend réellement : le socket, les minuteurs et la source d'aléa sont
 * injectés. Un test qui prendrait trente secondes pour vérifier un plafond de
 * trente secondes ne serait pas exécuté assez souvent pour servir.
 */

import { describe, expect, it, vi } from 'vitest';

import type { ServerMessage } from '../../../../src/web/shared/protocol.js';
import {
  backoffDelay,
  createWsClient,
  type WsClientStatus,
  type WsSocket,
} from '../../../../src/web/shared/ws-client.js';

/* -------------------------------------------------------------------------- */
/* Doublures                                                                   */
/* -------------------------------------------------------------------------- */

interface SocketDouble {
  readonly socket: WsSocket;
  readonly sent: string[];
  closedByClient: boolean;
  open(): void;
  receive(data: unknown): void;
  fail(): void;
  disconnect(): void;
}

function createSocketDouble(): SocketDouble {
  const sent: string[] = [];
  const double: SocketDouble = {
    socket: {
      send: (data: string) => sent.push(data),
      close: () => {
        double.closedByClient = true;
      },
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
    },
    sent,
    closedByClient: false,
    open: () => double.socket.onopen?.(),
    receive: (data: unknown) => double.socket.onmessage?.(data),
    fail: () => double.socket.onerror?.(),
    disconnect: () => double.socket.onclose?.(),
  };
  return double;
}

/** Minuteurs contrôlés à la main : aucune attente réelle, aucun `vi.useFakeTimers`. */
function createTimerDouble() {
  const pending = new Map<number, { run: () => void; delay: number }>();
  let nextId = 1;

  return {
    port: {
      setTimeout: (run: () => void, delay: number): number => {
        const id = nextId++;
        pending.set(id, { run, delay });
        return id;
      },
      clearTimeout: (id: number): void => {
        pending.delete(id);
      },
    },
    /** Délais des minuteurs en attente, dans l'ordre de programmation. */
    delays: (): number[] => [...pending.values()].map((entry) => entry.delay),
    pendingCount: (): number => pending.size,
    /** Déclenche le minuteur le plus ancien. */
    fire: (): void => {
      const [id] = [...pending.keys()];
      if (id === undefined) {
        throw new Error('aucun minuteur en attente');
      }
      const entry = pending.get(id);
      pending.delete(id);
      entry?.run();
    },
  };
}

interface Harness {
  readonly client: ReturnType<typeof createWsClient>;
  readonly timers: ReturnType<typeof createTimerDouble>;
  readonly sockets: SocketDouble[];
  readonly messages: ServerMessage[];
  readonly statuses: WsClientStatus[];
  /** Dernier socket créé. */
  last(): SocketDouble;
}

function createHarness(random = () => 0.5): Harness {
  const timers = createTimerDouble();
  const sockets: SocketDouble[] = [];
  const messages: ServerMessage[] = [];
  const statuses: WsClientStatus[] = [];

  const client = createWsClient({
    url: 'ws://127.0.0.1:3777/ws',
    channels: ['counter', 'event', 'config'],
    createSocket: () => {
      const double = createSocketDouble();
      sockets.push(double);
      return double.socket;
    },
    onMessage: (message) => messages.push(message),
    onStatusChange: (status) => statuses.push(status),
    timers: timers.port,
    random,
  });

  return {
    client,
    timers,
    sockets,
    messages,
    statuses,
    last: () => {
      const socket = sockets.at(-1);
      if (socket === undefined) {
        throw new Error('aucun socket créé');
      }
      return socket;
    },
  };
}

/* -------------------------------------------------------------------------- */

describe('backoffDelay', () => {
  const options = { initialDelayMs: 500, maxDelayMs: 30_000, factor: 2, jitterRatio: 0.2 };

  it('rend le délai initial à la première tentative', () => {
    // Aléa neutre : 0,5 place le jitter pile au centre de sa fourchette.
    expect(backoffDelay(1, options, () => 0.5)).toBe(500);
  });

  it('double le délai à chaque tentative', () => {
    expect(backoffDelay(2, options, () => 0.5)).toBe(1_000);
    expect(backoffDelay(3, options, () => 0.5)).toBe(2_000);
    expect(backoffDelay(4, options, () => 0.5)).toBe(4_000);
  });

  it('plafonne le délai', () => {
    // Sans plafond, la vingtième tentative attendrait plusieurs jours et
    // l'overlay ne reviendrait jamais.
    expect(backoffDelay(20, options, () => 0.5)).toBe(30_000);
  });

  it('applique un jitter borné de part et d’autre du délai', () => {
    expect(backoffDelay(2, options, () => 0)).toBe(800);
    expect(backoffDelay(2, options, () => 1)).toBe(1_200);
  });

  it('ne rend jamais un délai négatif', () => {
    expect(backoffDelay(1, { ...options, jitterRatio: 2 }, () => 0)).toBeGreaterThanOrEqual(0);
  });
});

describe('createWsClient', () => {
  describe('connexion', () => {
    it('ouvre un socket sur l’URL fournie', () => {
      const harness = createHarness();
      const createSocket = vi.fn(() => createSocketDouble().socket);

      const client = createWsClient({
        url: 'ws://127.0.0.1:9999/ws',
        channels: ['counter'],
        createSocket,
        onMessage: () => undefined,
        timers: harness.timers.port,
      });
      client.start();

      expect(createSocket).toHaveBeenCalledWith('ws://127.0.0.1:9999/ws');
    });

    it('annonce ses canaux dès l’ouverture', () => {
      // Sans cet abonnement, le hub pousse tout — y compris chaque ligne de
      // journal — vers une Browser Source qui n'en fait rien.
      const harness = createHarness();
      harness.client.start();

      harness.last().open();

      expect(harness.last().sent).toStrictEqual([
        JSON.stringify({ type: 'subscribe', channels: ['counter', 'event', 'config'] }),
      ]);
    });

    it('signale ses changements d’état', () => {
      const harness = createHarness();

      harness.client.start();
      harness.last().open();

      expect(harness.statuses).toStrictEqual(['connecting', 'open']);
    });
  });

  describe('réception', () => {
    it('transmet un message bien formé', () => {
      const harness = createHarness();
      harness.client.start();
      harness.last().open();

      harness.last().receive('{"type":"pong"}');

      expect(harness.messages).toStrictEqual([{ type: 'pong' }]);
    });

    it('ignore une charge utile illisible sans rompre la connexion', () => {
      const harness = createHarness();
      harness.client.start();
      harness.last().open();

      harness.last().receive('{ceci n’est pas du JSON');
      harness.last().receive('{"type":"pong"}');

      // Le message valide qui suit doit passer : la boucle a survécu.
      expect(harness.messages).toStrictEqual([{ type: 'pong' }]);
    });
  });

  describe('reconnexion', () => {
    it('reprogramme une connexion après une coupure', () => {
      const harness = createHarness();
      harness.client.start();
      harness.last().open();

      harness.last().disconnect();

      expect(harness.timers.delays()).toStrictEqual([500]);
      expect(harness.statuses).toStrictEqual(['connecting', 'open', 'reconnecting']);
    });

    it('rouvre un socket à l’échéance du minuteur', () => {
      const harness = createHarness();
      harness.client.start();
      harness.last().open();
      harness.last().disconnect();

      harness.timers.fire();

      expect(harness.sockets).toHaveLength(2);
    });

    it('espace les tentatives successives tant que la connexion échoue', () => {
      const harness = createHarness();
      harness.client.start();

      const observed: number[] = [];
      for (let attempt = 0; attempt < 4; attempt++) {
        harness.last().disconnect();
        observed.push(harness.timers.delays()[0] ?? -1);
        harness.timers.fire();
      }

      expect(observed).toStrictEqual([500, 1_000, 2_000, 4_000]);
    });

    it('repart du délai initial après une connexion réussie', () => {
      // Sans cette remise à zéro, une coupure brève survenue tard dans un
      // subathon ferait attendre trente secondes pour rien.
      const harness = createHarness();
      harness.client.start();

      harness.last().disconnect();
      harness.timers.fire();
      harness.last().disconnect();
      harness.timers.fire();

      harness.last().open();
      harness.last().disconnect();

      expect(harness.timers.delays()).toStrictEqual([500]);
    });

    it('ne programme qu’une seule reconnexion quand l’erreur précède la fermeture', () => {
      // Un navigateur émet `error` puis `close` sur un échec de connexion :
      // les compter deux fois doublerait la cadence des tentatives.
      const harness = createHarness();
      harness.client.start();

      harness.last().fail();
      harness.last().disconnect();

      expect(harness.timers.pendingCount()).toBe(1);
    });
  });

  describe('arrêt', () => {
    it('ferme le socket courant', () => {
      const harness = createHarness();
      harness.client.start();
      harness.last().open();

      harness.client.stop();

      expect(harness.last().closedByClient).toBe(true);
    });

    it('ne se reconnecte plus après un arrêt demandé', () => {
      const harness = createHarness();
      harness.client.start();
      harness.last().open();

      harness.client.stop();
      harness.last().disconnect();

      expect(harness.timers.pendingCount()).toBe(0);
      expect(harness.sockets).toHaveLength(1);
    });

    it('annule une reconnexion déjà programmée', () => {
      const harness = createHarness();
      harness.client.start();
      harness.last().disconnect();

      harness.client.stop();

      expect(harness.timers.pendingCount()).toBe(0);
    });
  });
});
