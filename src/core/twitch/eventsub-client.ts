import type { AppEvents, TwitchConnectionStatus } from '../app/app-events.js';
import type { EventBus } from '../app/event-bus.js';
import type { ChronoCastConfig } from '../config/schema.js';
import type { Logger } from '../logging/logger.js';
import type { HelixClient } from './helix-client.js';
import { resolveSubscriptions, type SubscriptionContext } from './subscription-plan.js';

const KEEPALIVE_GRACE_FACTOR = 1.2;

const BASE_RECONNECT_DELAY_MS = 1_000;

const MAX_RECONNECT_DELAY_MS = 60_000;

export interface EventSubSocket {
  readonly url: string;
  onOpen(handler: () => void): void;
  onMessage(handler: (data: string) => void): void;
  onClose(handler: (code: number, reason: string) => void): void;
  onError(handler: (error: unknown) => void): void;
  close(): void;
}

export type EventSubSocketFactory = (url: string) => EventSubSocket;

export interface Timers {
  setTimeout(handler: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

export interface NotificationContext {
  readonly messageId: string;
  readonly receivedAt: number;
  readonly subscriptionType: string;
}

export interface EventSubClient {
  start(): Promise<void>;

  stop(): Promise<void>;

  getStatus(): TwitchConnectionStatus;
}

export interface EventSubClientOptions {
  readonly getConfig: () => ChronoCastConfig;
  readonly helix: HelixClient;
  readonly createSocket: EventSubSocketFactory;
  readonly timers: Timers;
  readonly bus: EventBus<AppEvents>;
  readonly logger: Logger;
  readonly identity: SubscriptionContext;
  readonly onNotification: (context: NotificationContext, payload: unknown) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export function createEventSubClient(options: EventSubClientOptions): EventSubClient {
  const { getConfig, helix, createSocket, timers, bus, logger, identity, onNotification } = options;

  let status: TwitchConnectionStatus = 'disconnected';

  let activeSocket: EventSubSocket | undefined;

  let migratingSocket: EventSubSocket | undefined;

  let keepaliveTimer: number | undefined;
  let reconnectTimer: number | undefined;

  let reconnectAttempts = 0;

  let stopped = false;

  function setStatus(next: TwitchConnectionStatus, detail?: string): void {
    if (status === next) {
      return;
    }
    status = next;
    bus.emit('twitch:status', detail === undefined ? { status: next } : { status: next, detail });
  }

  function clearKeepaliveWatchdog(): void {
    if (keepaliveTimer !== undefined) {
      timers.clearTimeout(keepaliveTimer);
      keepaliveTimer = undefined;
    }
  }

  function clearReconnectTimer(): void {
    if (reconnectTimer !== undefined) {
      timers.clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    }
  }

  function armKeepaliveWatchdog(keepaliveSeconds: number): void {
    clearKeepaliveWatchdog();

    const timeoutMs = keepaliveSeconds * 1_000 * KEEPALIVE_GRACE_FACTOR;
    keepaliveTimer = timers.setTimeout(() => {
      logger.warning('aucun message de Twitch dans le délai imparti, reconnexion', { timeoutMs });
      forceReconnect('keepalive expiré');
    }, timeoutMs);
  }

  function forceReconnect(reason: string): void {
    if (stopped) {
      return;
    }

    clearKeepaliveWatchdog();

    activeSocket?.close();
    activeSocket = undefined;
    migratingSocket?.close();
    migratingSocket = undefined;

    setStatus('reconnecting', reason);
    scheduleReconnect();
  }

  function scheduleReconnect(): void {
    if (stopped || reconnectTimer !== undefined) {
      return;
    }

    const exponential = BASE_RECONNECT_DELAY_MS * 2 ** reconnectAttempts;
    const capped = Math.min(exponential, MAX_RECONNECT_DELAY_MS);
    const delayMs = capped / 2 + Math.random() * (capped / 2);
    reconnectAttempts += 1;

    logger.info('nouvelle tentative de connexion programmée', {
      delayMs: Math.round(delayMs),
      attempt: reconnectAttempts,
    });

    reconnectTimer = timers.setTimeout(() => {
      reconnectTimer = undefined;
      openConnection();
    }, delayMs);
  }

  async function createSubscriptions(sessionId: string): Promise<void> {
    const config = getConfig();
    const planned = resolveSubscriptions(config.twitch, identity);

    for (const subscription of planned) {
      try {
        await helix.createEventSubSubscription({
          type: subscription.type,
          version: subscription.version,
          condition: subscription.condition,
          sessionId,
        });
      } catch (error) {
        const level = subscription.required ? 'error' : 'warning';
        logger[level]('souscription EventSub en échec', {
          type: subscription.type,
          required: subscription.required,
          cause: error,
        });

        bus.emit('twitch:subscription-failed', {
          subscriptionType: subscription.type,
          required: subscription.required,
          error,
        });
      }
    }

    setStatus('ready');
    logger.info('souscriptions EventSub établies', { count: planned.length });
  }

  function handleWelcome(socket: EventSubSocket, payload: unknown): void {
    const session = isRecord(payload) ? payload['session'] : undefined;
    if (!isRecord(session)) {
      logger.warning('message d\'accueil sans session exploitable');
      return;
    }

    const sessionId = readString(session, 'id');
    if (sessionId === undefined) {
      logger.warning('message d\'accueil sans identifiant de session');
      return;
    }

    const keepaliveSeconds =
      typeof session['keepalive_timeout_seconds'] === 'number'
        ? session['keepalive_timeout_seconds']
        : getConfig().twitch.keepaliveTimeoutSeconds;

    if (socket === migratingSocket) {
      logger.info('migration de session confirmée');
      activeSocket?.close();
      activeSocket = migratingSocket;
      migratingSocket = undefined;
      reconnectAttempts = 0;
      armKeepaliveWatchdog(keepaliveSeconds);
      setStatus('ready');
      return;
    }

    reconnectAttempts = 0;
    armKeepaliveWatchdog(keepaliveSeconds);
    setStatus('connected');

    void createSubscriptions(sessionId);
  }

  function handleReconnectRequest(payload: unknown): void {
    const session = isRecord(payload) ? payload['session'] : undefined;
    const reconnectUrl = isRecord(session) ? readString(session, 'reconnect_url') : undefined;

    if (reconnectUrl === undefined) {
      logger.warning('demande de migration sans URL, ignorée');
      return;
    }

    logger.info('migration de session demandée par Twitch');
    migratingSocket = openSocket(reconnectUrl);
  }

  function handleRevocation(payload: unknown): void {
    const subscription = isRecord(payload) ? payload['subscription'] : undefined;
    const subscriptionType = isRecord(subscription)
      ? (readString(subscription, 'type') ?? 'inconnu')
      : 'inconnu';
    const revocationStatus = isRecord(subscription)
      ? (readString(subscription, 'status') ?? 'inconnu')
      : 'inconnu';

    logger.warning('souscription révoquée par Twitch', {
      type: subscriptionType,
      status: revocationStatus,
    });

    bus.emit('twitch:revocation', { subscriptionType, status: revocationStatus });
  }

  function handleMessage(socket: EventSubSocket, data: string): void {
    let message: unknown;
    try {
      message = JSON.parse(data);
    } catch (error) {
      logger.warning('message EventSub illisible', { cause: error });
      return;
    }

    if (!isRecord(message)) {
      return;
    }

    const metadata = message['metadata'];
    if (!isRecord(metadata)) {
      logger.warning('message EventSub sans métadonnées');
      return;
    }

    const messageType = readString(metadata, 'message_type');
    if (messageType === undefined) {
      logger.warning('message EventSub sans type');
      return;
    }

    if (socket === activeSocket) {
      const keepaliveSeconds = getConfig().twitch.keepaliveTimeoutSeconds;
      armKeepaliveWatchdog(keepaliveSeconds);
    }

    switch (messageType) {
      case 'session_welcome':
        handleWelcome(socket, message['payload']);
        return;

      case 'session_keepalive':
        return;

      case 'notification': {
        if (socket !== activeSocket) {
          return;
        }

        const subscriptionType = readString(metadata, 'subscription_type');
        const messageId = readString(metadata, 'message_id');
        if (subscriptionType === undefined || messageId === undefined) {
          logger.warning('notification sans type ou sans identifiant');
          return;
        }

        const payload = message['payload'];
        onNotification(
          { messageId, receivedAt: Date.now(), subscriptionType },
          isRecord(payload) ? payload['event'] : undefined,
        );
        return;
      }

      case 'session_reconnect':
        handleReconnectRequest(message['payload']);
        return;

      case 'revocation':
        handleRevocation(message['payload']);
        return;

      default:
        logger.debug('type de message EventSub non géré', { messageType });
    }
  }

  function openSocket(url: string): EventSubSocket {
    const socket = createSocket(url);

    socket.onOpen(() => {
      logger.debug('connexion EventSub ouverte', { url });
    });

    socket.onMessage((data) => {
      handleMessage(socket, data);
    });

    socket.onError((error) => {
      logger.warning('erreur de transport EventSub', { cause: error });
    });

    socket.onClose((code, reason) => {
      if (stopped || (socket !== activeSocket && socket !== migratingSocket)) {
        return;
      }

      logger.warning('connexion EventSub fermée', { code, reason });
      forceReconnect(`fermeture ${String(code)}`);
    });

    return socket;
  }

  function openConnection(): void {
    const config = getConfig();
    const url = new URL(config.twitch.eventsubUrl);
    url.searchParams.set(
      'keepalive_timeout_seconds',
      String(config.twitch.keepaliveTimeoutSeconds),
    );

    setStatus('connecting');
    activeSocket = openSocket(url.toString());
  }

  return {
    start(): Promise<void> {
      stopped = false;
      reconnectAttempts = 0;
      openConnection();
      return Promise.resolve();
    },

    stop(): Promise<void> {
      stopped = true;
      clearKeepaliveWatchdog();
      clearReconnectTimer();

      activeSocket?.close();
      activeSocket = undefined;
      migratingSocket?.close();
      migratingSocket = undefined;

      setStatus('disconnected');
      logger.info('client EventSub arrêté');
      return Promise.resolve();
    },

    getStatus(): TwitchConnectionStatus {
      return status;
    },
  };
}
