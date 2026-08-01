/**
 * Client EventSub WebSocket.
 *
 * Seul lien avec Twitch pendant toute la durée du subathon. S'il tombe sans se
 * relever, le compteur continue à descendre mais plus rien ne le fait monter — et
 * personne ne s'en aperçoit avant plusieurs minutes.
 *
 * Sa conception répond à trois situations réelles :
 *
 *   - **La coupure silencieuse.** La connexion paraît ouverte mais ne transporte
 *     plus rien. Aucune erreur n'est levée, aucun événement de fermeture n'est
 *     émis. L'absence de message est le seul signal disponible, d'où le chien de
 *     garde armé sur le délai de keepalive négocié avec Twitch.
 *   - **La migration de session.** Twitch demande de basculer sur une nouvelle
 *     URL. L'ancienne connexion n'est fermée qu'après confirmation de la
 *     nouvelle, sous peine de perdre les événements de l'intervalle. Les
 *     souscriptions ne sont pas recréées : Twitch les transfère.
 *   - **La révocation.** Twitch retire une souscription sans fermer la
 *     connexion. Rien ne se voit, sinon que les abonnements cessent de créditer.
 *
 * Le transport est injecté afin que la machine à états soit vérifiable sans
 * aucun socket réel, en injectant les messages de Twitch à la main.
 */

import type { AppEvents, TwitchConnectionStatus } from '../app/app-events.js';
import type { EventBus } from '../app/event-bus.js';
import type { ChronoCastConfig } from '../config/schema.js';
import type { Logger } from '../logging/logger.js';
import type { HelixClient } from './helix-client.js';
import { resolveSubscriptions, type SubscriptionContext } from './subscription-plan.js';

/** Marge appliquée au délai de keepalive avant de déclarer la connexion morte. */
const KEEPALIVE_GRACE_FACTOR = 1.2;

/** Attente initiale avant une nouvelle tentative de connexion. */
const BASE_RECONNECT_DELAY_MS = 1_000;

/** Plafond de l'attente entre deux tentatives. */
const MAX_RECONNECT_DELAY_MS = 60_000;

/** Transport minimal attendu par le client. */
export interface EventSubSocket {
  readonly url: string;
  onOpen(handler: () => void): void;
  onMessage(handler: (data: string) => void): void;
  onClose(handler: (code: number, reason: string) => void): void;
  onError(handler: (error: unknown) => void): void;
  close(): void;
}

/** Fabrique de transport, injectée pour rendre la machine à états testable. */
export type EventSubSocketFactory = (url: string) => EventSubSocket;

/** Minuteurs injectés, afin qu'aucun test n'attende une durée réelle. */
export interface Timers {
  setTimeout(handler: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

/** Contexte transmis au convertisseur pour chaque notification reçue. */
export interface NotificationContext {
  readonly messageId: string;
  readonly receivedAt: number;
  readonly subscriptionType: string;
}

export interface EventSubClient {
  /** Ouvre la connexion et souscrit aux événements du plan. */
  start(): Promise<void>;

  /** Ferme la connexion et interrompt toute tentative de reconnexion. */
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
  /** Identités utilisées pour construire les conditions de souscription. */
  readonly identity: SubscriptionContext;
  /** Appelé pour chaque notification, avant toute interprétation métier. */
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

  /** Connexion en service, celle dont les notifications sont traitées. */
  let activeSocket: EventSubSocket | undefined;

  /**
   * Connexion ouverte sur demande de migration, en attente de son accueil.
   *
   * Tant qu'elle n'a pas confirmé, l'ancienne reste en service : c'est ce qui
   * garantit qu'aucun événement n'est perdu pendant la bascule.
   */
  let migratingSocket: EventSubSocket | undefined;

  let keepaliveTimer: number | undefined;
  let reconnectTimer: number | undefined;

  /** Tentatives consécutives, pour l'espacement exponentiel. */
  let reconnectAttempts = 0;

  /** Vrai après `stop()` : interdit toute reconnexion automatique. */
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

  /**
   * (Ré)arme le chien de garde.
   *
   * Appelé à chaque message reçu, quel qu'en soit le type : keepalive,
   * notification ou message de service. Tout trafic prouve que la connexion vit.
   */
  function armKeepaliveWatchdog(keepaliveSeconds: number): void {
    clearKeepaliveWatchdog();

    const timeoutMs = keepaliveSeconds * 1_000 * KEEPALIVE_GRACE_FACTOR;
    keepaliveTimer = timers.setTimeout(() => {
      logger.warning('aucun message de Twitch dans le délai imparti, reconnexion', { timeoutMs });
      forceReconnect('keepalive expiré');
    }, timeoutMs);
  }

  /** Ferme la connexion courante et programme une nouvelle tentative. */
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

  /**
   * Programme une tentative de connexion avec espacement croissant.
   *
   * Le facteur aléatoire évite qu'une panne de Twitch ne fasse revenir toutes
   * les installations exactement au même instant.
   */
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

  /** Crée les souscriptions du plan pour la session qui vient de s'ouvrir. */
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
        // Une souscription facultative en échec ne doit pas interrompre le
        // subathon : seuls les abonnements et les bits sont vitaux.
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

  /** Traite un message d'accueil, seul porteur de l'identifiant de session. */
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

    // Migration confirmée : la nouvelle connexion prend le relais et l'ancienne
    // peut enfin être fermée. Les souscriptions sont transférées par Twitch, les
    // recréer produirait des doublons facturés au quota.
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

    // Session nouvelle : les souscriptions doivent être créées.
    void createSubscriptions(sessionId);
  }

  /** Traite une demande de migration en ouvrant la connexion cible. */
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

  /** Aiguille un message entrant selon son type. */
  function handleMessage(socket: EventSubSocket, data: string): void {
    let message: unknown;
    try {
      message = JSON.parse(data);
    } catch (error) {
      // Un message illisible ne doit pas rompre la connexion, qui porte tout le
      // reste du subathon.
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

    // Tout trafic prouve que la connexion vit, pas seulement les keepalives.
    if (socket === activeSocket) {
      const keepaliveSeconds = getConfig().twitch.keepaliveTimeoutSeconds;
      armKeepaliveWatchdog(keepaliveSeconds);
    }

    switch (messageType) {
      case 'session_welcome':
        handleWelcome(socket, message['payload']);
        return;

      case 'session_keepalive':
        // Le chien de garde a déjà été réarmé ci-dessus : rien d'autre à faire.
        return;

      case 'notification': {
        // Seule la connexion en service est écoutée : pendant une migration, la
        // nouvelle n'a pas encore confirmé et pourrait doubler les événements.
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
        // Twitch peut introduire de nouveaux types : les ignorer poliment vaut
        // mieux que rompre une connexion qui fonctionne.
        logger.debug('type de message EventSub non géré', { messageType });
    }
  }

  /** Ouvre un transport et branche ses gestionnaires. */
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
      // Une fermeture attendue — migration achevée, arrêt volontaire — ne doit
      // pas déclencher de reconnexion.
      if (stopped || (socket !== activeSocket && socket !== migratingSocket)) {
        return;
      }

      logger.warning('connexion EventSub fermée', { code, reason });
      forceReconnect(`fermeture ${String(code)}`);
    });

    return socket;
  }

  /** Ouvre la connexion principale sur l'URL configurée. */
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
