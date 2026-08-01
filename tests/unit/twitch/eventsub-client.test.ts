import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import type { AppEvents } from '../../../src/core/app/app-events.js';
import { createEventBus, type EventBus } from '../../../src/core/app/event-bus.js';
import { DEFAULT_CONFIG } from '../../../src/core/config/defaults.js';
import { configSchema, type ChronoCastConfig } from '../../../src/core/config/schema.js';
import { createLogger, type LogRecord, type LogSink } from '../../../src/core/logging/logger.js';
import {
  createEventSubClient,
  type EventSubSocket,
  type EventSubSocketFactory,
  type NotificationContext,
} from '../../../src/core/twitch/eventsub-client.js';
import type { HelixClient } from '../../../src/core/twitch/helix-client.js';

/**
 * Le client EventSub est le seul lien avec Twitch pendant tout le subathon. S'il
 * tombe sans se relever, le compteur continue à descendre mais plus rien ne le
 * fait monter — et personne ne s'en aperçoit avant plusieurs minutes.
 *
 * Sa conception répond donc à trois situations réelles :
 *
 *   - **la coupure silencieuse**, où la connexion paraît ouverte mais ne
 *     transporte plus rien. D'où le chien de garde armé sur le keepalive :
 *     l'absence de message est le seul signal disponible.
 *   - **la migration de session**, où Twitch demande de basculer sur une
 *     nouvelle URL. L'ancienne connexion ne doit être fermée qu'après
 *     confirmation de la nouvelle, sous peine de perdre les événements de
 *     l'intervalle.
 *   - **la révocation**, où Twitch retire une souscription sans fermer la
 *     connexion. Rien ne se voit, sinon que les subs cessent de créditer.
 */

const SESSION_ID = 'session-abc';
const RECONNECT_URL = 'wss://eventsub.wss.twitch.tv/ws?challenge=xyz';

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

/** Socket simulée : les tests injectent les messages de Twitch à la main. */
function createSocketDouble(url: string) {
  const handlers: {
    open?: () => void;
    message?: (data: string) => void;
    close?: (code: number, reason: string) => void;
    error?: (error: unknown) => void;
  } = {};

  let closed = false;

  const socket: EventSubSocket = {
    url,
    onOpen: (handler) => {
      handlers.open = handler;
    },
    onMessage: (handler) => {
      handlers.message = handler;
    },
    onClose: (handler) => {
      handlers.close = handler;
    },
    onError: (handler) => {
      handlers.error = handler;
    },
    close: () => {
      closed = true;
    },
  };

  return {
    socket,
    get closed(): boolean {
      return closed;
    },
    open(): void {
      handlers.open?.();
    },
    send(message: unknown): void {
      handlers.message?.(JSON.stringify(message));
    },
    sendRaw(data: string): void {
      handlers.message?.(data);
    },
    fail(error: unknown): void {
      handlers.error?.(error);
    },
    remoteClose(code = 1006, reason = 'coupure'): void {
      handlers.close?.(code, reason);
    },
  };
}

/** Minuteurs pilotés à la main : aucun test n'attend une durée réelle. */
function createFakeTimers() {
  let nextId = 1;
  const pending = new Map<number, { readonly runAt: number; readonly handler: () => void }>();
  let currentTime = 0;

  return {
    timers: {
      setTimeout(handler: () => void, ms: number): number {
        const id = nextId++;
        pending.set(id, { runAt: currentTime + ms, handler });
        return id;
      },
      clearTimeout(id: number): void {
        pending.delete(id);
      },
    },
    get pendingCount(): number {
      return pending.size;
    },
    /** Avance le temps et déclenche les minuteurs échus, dans l'ordre. */
    advance(ms: number): void {
      currentTime += ms;
      const due = [...pending.entries()]
        .filter(([, entry]) => entry.runAt <= currentTime)
        .sort((left, right) => left[1].runAt - right[1].runAt);

      for (const [id, entry] of due) {
        pending.delete(id);
        entry.handler();
      }
    },
  };
}

function welcomeMessage(sessionId = SESSION_ID, keepaliveSeconds = 30): unknown {
  return {
    metadata: {
      message_id: 'welcome-1',
      message_type: 'session_welcome',
      message_timestamp: '2026-08-01T10:00:00Z',
    },
    payload: {
      session: {
        id: sessionId,
        status: 'connected',
        keepalive_timeout_seconds: keepaliveSeconds,
        reconnect_url: null,
        connected_at: '2026-08-01T10:00:00Z',
      },
    },
  };
}

function notificationMessage(messageId: string, subscriptionType: string, event: unknown): unknown {
  return {
    metadata: {
      message_id: messageId,
      message_type: 'notification',
      message_timestamp: '2026-08-01T10:00:00Z',
      subscription_type: subscriptionType,
      subscription_version: '1',
    },
    payload: {
      subscription: { id: 'sub-1', type: subscriptionType, version: '1', status: 'enabled' },
      event,
    },
  };
}

describe('createEventSubClient', () => {
  let sockets: ReturnType<typeof createSocketDouble>[];
  let timers: ReturnType<typeof createFakeTimers>;
  let bus: EventBus<AppEvents>;
  let sink: ReturnType<typeof createMemorySink>;
  let helix: HelixClient;
  // Mocks typés d'après le contrat réel : `vi.fn()` sans paramètre de type
  // attend une implémentation renvoyant void, ce qui interdit nos promesses.
  let createSubscription: Mock<HelixClient['createEventSubSubscription']>;
  let onNotification: Mock<(context: NotificationContext, payload: unknown) => void>;

  beforeEach(() => {
    sockets = [];
    timers = createFakeTimers();
    bus = createEventBus<AppEvents>();
    sink = createMemorySink();
    createSubscription = vi
      .fn<HelixClient['createEventSubSubscription']>()
      .mockImplementation((request) =>
        Promise.resolve({
          id: `sub-${request.type}`,
          type: request.type,
          version: request.version,
          status: 'enabled',
        }),
      );
    onNotification = vi.fn<(context: NotificationContext, payload: unknown) => void>();

    helix = {
      getCurrentUser: () =>
        Promise.resolve({ id: '1337', login: 'cooler_user', displayName: 'Cooler_User' }),
      createEventSubSubscription: createSubscription,
      listEventSubSubscriptions: () => Promise.resolve([]),
      deleteEventSubSubscription: () => Promise.resolve(),
    };
  });

  const socketFactory: EventSubSocketFactory = (url: string) => {
    const double = createSocketDouble(url);
    sockets.push(double);
    return double.socket;
  };

  function createClient(config: ChronoCastConfig = DEFAULT_CONFIG) {
    return createEventSubClient({
      getConfig: () => config,
      helix,
      createSocket: socketFactory,
      timers: timers.timers,
      bus,
      logger: createLogger({ level: 'debug', sinks: [sink] }),
      onNotification,
      identity: { broadcasterUserId: '1337', userId: '1337' },
    });
  }

  /** Ouvre la connexion et joue l'accueil, situation de départ de la plupart des tests. */
  async function connect(client: ReturnType<typeof createClient>) {
    await client.start();
    sockets[0]?.open();
    sockets[0]?.send(welcomeMessage());
    // Les souscriptions sont créées de façon asynchrone après l'accueil.
    await vi.waitFor(() => {
      expect(client.getStatus()).toBe('ready');
    });
  }

  describe('établissement de la connexion', () => {
    it('ouvre la connexion sur l\'URL configurée', async () => {
      const client = createClient();

      await client.start();

      expect(sockets[0]?.socket.url).toContain('eventsub.wss.twitch.tv');
    });

    it('négocie le délai de keepalive configuré', async () => {
      const client = createClient(configSchema.parse({ twitch: { keepaliveTimeoutSeconds: 45 } }));

      await client.start();

      expect(sockets[0]?.socket.url).toContain('keepalive_timeout_seconds=45');
    });

    it('crée les souscriptions dès réception de l\'accueil', async () => {
      const client = createClient();

      await connect(client);

      expect(createSubscription).toHaveBeenCalled();
      const types = createSubscription.mock.calls.map((call) => (call[0] as { type: string }).type);
      expect(types).toContain('channel.subscribe');
    });

    it('rattache les souscriptions à la session annoncée', async () => {
      const client = createClient();

      await connect(client);

      const premier = createSubscription.mock.calls[0]?.[0] as { sessionId: string };
      expect(premier.sessionId).toBe(SESSION_ID);
    });

    it('passe à l\'état prêt une fois les souscriptions créées', async () => {
      const client = createClient();

      await connect(client);

      expect(client.getStatus()).toBe('ready');
    });

    it('publie chaque changement d\'état sur le bus', async () => {
      const client = createClient();
      const statuts: string[] = [];
      bus.on('twitch:status', (payload) => statuts.push(payload.status));

      await connect(client);

      expect(statuts).toContain('connecting');
      expect(statuts).toContain('ready');
    });
  });

  describe('réception des notifications', () => {
    it('transmet la notification avec son contexte', async () => {
      const client = createClient();
      await connect(client);

      sockets[0]?.send(
        notificationMessage('msg-1', 'channel.subscribe', { user_id: '1', tier: '1000' }),
      );

      expect(onNotification).toHaveBeenCalledTimes(1);
      const [context, payload] = onNotification.mock.calls[0] as [
        { messageId: string; subscriptionType: string },
        unknown,
      ];
      expect(context.messageId).toBe('msg-1');
      expect(context.subscriptionType).toBe('channel.subscribe');
      expect(payload).toMatchObject({ tier: '1000' });
    });

    it('ignore un message qui n\'est pas du JSON', async () => {
      const client = createClient();
      await connect(client);

      expect(() => {
        sockets[0]?.sendRaw('pas du json');
      }).not.toThrow();
      expect(onNotification).not.toHaveBeenCalled();
    });

    it('ignore un message dépourvu de type', async () => {
      const client = createClient();
      await connect(client);

      sockets[0]?.send({ payload: {} });

      expect(onNotification).not.toHaveBeenCalled();
    });

    it('ignore un type de message inconnu sans rompre la connexion', async () => {
      const client = createClient();
      await connect(client);

      sockets[0]?.send({ metadata: { message_type: 'message_du_futur' }, payload: {} });

      expect(client.getStatus()).toBe('ready');
    });
  });

  describe('chien de garde sur le keepalive', () => {
    it('reconnecte lorsque plus aucun message n\'arrive', async () => {
      // Cas réel de la coupure silencieuse : la connexion paraît ouverte mais ne
      // transporte plus rien. L'absence de message est le seul signal.
      const client = createClient();
      await connect(client);

      // Le chien de garde expire et programme une reconnexion, qui reste
      // soumise à l'espacement : elle n'est pas immédiate.
      timers.advance(30_000 * 1.2 + 1);
      expect(client.getStatus()).toBe('reconnecting');

      timers.advance(60_000);

      expect(sockets).toHaveLength(2);
    });

    it('réarme le chien de garde à chaque keepalive', async () => {
      const client = createClient();
      await connect(client);

      for (let index = 0; index < 5; index += 1) {
        timers.advance(20_000);
        sockets[0]?.send({ metadata: { message_type: 'session_keepalive' }, payload: {} });
      }

      expect(sockets).toHaveLength(1);
    });

    it('réarme le chien de garde à chaque notification', async () => {
      const client = createClient();
      await connect(client);

      timers.advance(20_000);
      sockets[0]?.send(notificationMessage('msg-1', 'channel.subscribe', {}));
      timers.advance(20_000);

      expect(sockets).toHaveLength(1);
    });
  });

  describe('migration de session', () => {
    it('ouvre la nouvelle connexion sur l\'URL fournie', async () => {
      const client = createClient();
      await connect(client);

      sockets[0]?.send({
        metadata: { message_type: 'session_reconnect' },
        payload: { session: { id: SESSION_ID, reconnect_url: RECONNECT_URL } },
      });

      expect(sockets[1]?.socket.url).toBe(RECONNECT_URL);
    });

    it('ne ferme l\'ancienne connexion qu\'après confirmation de la nouvelle', async () => {
      // Fermer trop tôt perdrait les événements survenus dans l'intervalle.
      const client = createClient();
      await connect(client);

      sockets[0]?.send({
        metadata: { message_type: 'session_reconnect' },
        payload: { session: { id: SESSION_ID, reconnect_url: RECONNECT_URL } },
      });
      expect(sockets[0]?.closed).toBe(false);

      sockets[1]?.open();
      sockets[1]?.send(welcomeMessage('session-nouvelle'));

      expect(sockets[0]?.closed).toBe(true);
    });

    it('ne recrée aucune souscription après migration', async () => {
      // Twitch transfère les souscriptions vers la nouvelle session : les
      // recréer produirait des doublons facturés au quota.
      const client = createClient();
      await connect(client);
      const avant = createSubscription.mock.calls.length;

      sockets[0]?.send({
        metadata: { message_type: 'session_reconnect' },
        payload: { session: { id: SESSION_ID, reconnect_url: RECONNECT_URL } },
      });
      sockets[1]?.open();
      sockets[1]?.send(welcomeMessage('session-nouvelle'));

      expect(createSubscription.mock.calls.length).toBe(avant);
    });

    it('ignore une demande de migration sans URL', async () => {
      const client = createClient();
      await connect(client);

      sockets[0]?.send({
        metadata: { message_type: 'session_reconnect' },
        payload: { session: { id: SESSION_ID, reconnect_url: null } },
      });

      expect(sockets).toHaveLength(1);
    });
  });

  describe('révocation', () => {
    it('signale la révocation sur le bus', async () => {
      // Twitch retire la souscription sans fermer la connexion : rien ne se voit,
      // sinon que les subs cessent de créditer.
      const client = createClient();
      await connect(client);
      const revocations = vi.fn();
      bus.on('twitch:revocation', revocations);

      sockets[0]?.send({
        metadata: { message_type: 'revocation' },
        payload: {
          subscription: { id: 'sub-1', type: 'channel.subscribe', status: 'authorization_revoked' },
        },
      });

      expect(revocations).toHaveBeenCalledWith(
        expect.objectContaining({ subscriptionType: 'channel.subscribe' }),
      );
    });

    it('journalise un avertissement', async () => {
      const client = createClient();
      await connect(client);

      sockets[0]?.send({
        metadata: { message_type: 'revocation' },
        payload: {
          subscription: { id: 'sub-1', type: 'channel.subscribe', status: 'user_removed' },
        },
      });

      expect(sink.records.some((record) => record.level === 'warning')).toBe(true);
    });
  });

  describe('reconnexion après coupure', () => {
    it('rouvre une connexion après une fermeture distante', async () => {
      const client = createClient();
      await connect(client);

      sockets[0]?.remoteClose();
      timers.advance(60_000);

      expect(sockets.length).toBeGreaterThan(1);
    });

    it('espace les tentatives successives', async () => {
      const client = createClient();
      await client.start();

      sockets[0]?.remoteClose();
      timers.advance(60_000);
      const apresPremiere = sockets.length;
      sockets[apresPremiere - 1]?.remoteClose();
      timers.advance(1_000);

      // La seconde tentative attend plus longtemps que la première : sans
      // espacement, une panne de Twitch produirait une tempête de connexions.
      expect(sockets.length).toBe(apresPremiere);
    });

    it('recrée les souscriptions après une véritable reconnexion', async () => {
      // À la différence d'une migration, une reconnexion ouvre une session
      // nouvelle : les souscriptions ne sont pas transférées.
      const client = createClient();
      await connect(client);
      const avant = createSubscription.mock.calls.length;

      sockets[0]?.remoteClose();
      timers.advance(60_000);
      sockets[1]?.open();
      sockets[1]?.send(welcomeMessage('session-2'));
      await vi.waitFor(() => {
        expect(createSubscription.mock.calls.length).toBeGreaterThan(avant);
      });

      expect(createSubscription.mock.calls.length).toBeGreaterThan(avant);
    });

    it('signale l\'état de reconnexion sur le bus', async () => {
      const client = createClient();
      await connect(client);
      const statuts: string[] = [];
      bus.on('twitch:status', (payload) => statuts.push(payload.status));

      sockets[0]?.remoteClose();

      expect(statuts).toContain('reconnecting');
    });
  });

  describe('échec de souscription', () => {
    it('poursuit lorsque seule une souscription facultative échoue', async () => {
      const client = createClient(configSchema.parse({ twitch: { enableRaid: true } }));
      createSubscription.mockImplementation((request) => {
        if (request.type === 'channel.raid') {
          return Promise.reject(new Error('quota dépassé'));
        }
        return Promise.resolve({
          id: 'x',
          type: request.type,
          version: request.version,
          status: 'enabled',
        });
      });

      await client.start();
      sockets[0]?.open();
      sockets[0]?.send(welcomeMessage());
      await vi.waitFor(() => {
        expect(client.getStatus()).toBe('ready');
      });

      expect(client.getStatus()).toBe('ready');
    });

    it('signale l\'échec d\'une souscription indispensable', async () => {
      const client = createClient();
      createSubscription.mockRejectedValue(new Error('portée manquante'));
      const echecs = vi.fn();
      bus.on('twitch:subscription-failed', echecs);

      await client.start();
      sockets[0]?.open();
      sockets[0]?.send(welcomeMessage());
      await vi.waitFor(() => {
        expect(echecs).toHaveBeenCalled();
      });

      expect(echecs).toHaveBeenCalled();
    });
  });

  describe('arrêt', () => {
    it('ferme la connexion', async () => {
      const client = createClient();
      await connect(client);

      await client.stop();

      expect(sockets[0]?.closed).toBe(true);
    });

    it('ne reconnecte plus après un arrêt volontaire', async () => {
      const client = createClient();
      await connect(client);

      await client.stop();
      sockets[0]?.remoteClose();
      timers.advance(60_000);

      expect(sockets).toHaveLength(1);
    });

    it('annule les minuteurs en attente', async () => {
      const client = createClient();
      await connect(client);

      await client.stop();

      expect(timers.pendingCount).toBe(0);
    });

    it('revient à l\'état déconnecté', async () => {
      const client = createClient();
      await connect(client);

      await client.stop();

      expect(client.getStatus()).toBe('disconnected');
    });
  });
});
