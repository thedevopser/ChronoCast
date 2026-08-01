/**
 * Hub WebSocket : le lien entre l'application et les pages ouvertes.
 *
 * Trois situations dictent sa conception, et aucune n'est théorique.
 *
 * **OBS n'est pas rechargé.** Une Browser Source reste ouverte des heures, parfois
 * toute la durée du subathon. Le hub doit donc supporter des connexions très
 * longues et, surtout, repérer celles qui sont mortes sans l'avoir dit — une
 * fenêtre OBS fermée brutalement laisse un socket ouvert côté serveur. D'où le
 * ping/pong et la terminaison des sockets muettes : diffuser dans le vide donne un
 * compteur figé que personne ne sait expliquer.
 *
 * **Le décompte ne se diffuse pas à chaque top.** Le compteur bat quatre fois par
 * seconde ; l'overlay interpole localement en `requestAnimationFrame` et n'a
 * besoin que d'un point de synchronisation par seconde. Les mutations, elles,
 * partent immédiatement : c'est le gift sub qui doit apparaître tout de suite, pas
 * la seconde qui s'écoule.
 *
 * **Le canal est en lecture seule.** Il diffuse, il ne commande pas : toute
 * mutation passe par l'API HTTP avec son jeton. Un message entrant inattendu est
 * donc une anomalie, et se traite comme telle — erreur puis fermeture.
 *
 * Comme le client EventSub, le hub ne connaît qu'une interface de socket et reçoit
 * sa fabrique de l'extérieur : `ws-adapter.ts` est le seul fichier à importer `ws`.
 */

import type { AppEvents } from '../app/app-events.js';
import type { Clock } from '../app/ports.js';
import type { EventBus, Unsubscribe } from '../app/event-bus.js';
import type { ChronoCastConfig } from '../config/schema.js';
import type { CounterState } from '../counter/counter-state.js';
import type { Logger, LogRecord } from '../logging/logger.js';
import {
  CHANNELS,
  DEFAULT_CHANNELS,
  PROTOCOL_VERSION,
  channelOf,
  clientMessageSchema,
  type Channel,
  type ServerMessage,
} from './protocol.js';
import { isAllowedWebSocketOrigin } from './security/csrf.js';

/**
 * Socket vue par le hub.
 *
 * Volontairement réduite à ce dont il se sert. Tout ce qui relève de `ws` — les
 * trames, les codes de fermeture, la mise en mémoire tampon — reste dans
 * l'adaptateur.
 */
export interface HubSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  /** Trame `ping` du protocole WebSocket, à laquelle un client conforme répond seul. */
  ping(): void;
  onMessage(handler: (data: string) => void): void;
  onClose(handler: () => void): void;
  onPong(handler: () => void): void;
}

/** Minuteurs injectés : le battement de vivacité ne doit pas imposer d'attente réelle aux tests. */
export interface HubTimers {
  setInterval(handler: () => void, ms: number): number;
  clearInterval(id: number): void;
}

/** Contexte de la poignée de main, extrait des en-têtes par l'adaptateur. */
export interface HandshakeContext {
  readonly origin?: string;
}

/** Instantané servi à la connexion, avant toute diffusion. */
export interface HubSnapshot {
  readonly counter: CounterState;
  readonly twitch: { readonly status: AppEvents['twitch:status']['status']; readonly detail?: string };
}

export interface WsHub {
  /** S'abonne au bus et arme le battement de vivacité. */
  start(): void;

  /** Ferme toutes les connexions, désarme le battement et se désabonne. */
  stop(): void;

  /** Adopte une connexion entrante, ou la referme si son origine est refusée. */
  accept(socket: HubSocket, context: HandshakeContext): void;

  clientCount(): number;

  /** Pousse une ligne de journal. Câblé comme puits de journalisation par l'application. */
  publishLog(record: LogRecord): void;

  /** Pousse la configuration d'overlay après une modification. */
  publishConfig(): void;
}

export interface WsHubOptions {
  readonly bus: EventBus<AppEvents>;
  readonly getConfig: () => ChronoCastConfig;
  /** Lu à chaque connexion : le nouveau client doit voir l'état courant, pas celui du démarrage. */
  readonly getSnapshot: () => HubSnapshot;
  readonly clock: Clock;
  readonly timers: HubTimers;
  /** Port réellement retenu, transmis au client pour qu'il construise ses URL. */
  readonly getPort: () => number;
  readonly appVersion: string;
  readonly logger: Logger;
}

/** Code de fermeture « violation de politique » : origine refusée, message invalide. */
const POLICY_VIOLATION = 1008;

/** Code de fermeture « arrêt du service ». */
const GOING_AWAY = 1001;

interface Client {
  readonly socket: HubSocket;
  channels: ReadonlySet<Channel>;
  /** Vrai lorsqu'un ping est parti sans réponse : au battement suivant, le socket est terminé. */
  awaitingPong: boolean;
}

export function createWsHub(options: WsHubOptions): WsHub {
  const { bus, getConfig, getSnapshot, clock, timers, getPort, appVersion, logger } = options;
  const scoped = logger.child('ws');

  const clients = new Set<Client>();
  const subscriptions: Unsubscribe[] = [];

  let heartbeatId: number | null = null;
  let running = false;

  /** Repère de la dernière diffusion du décompte, sur l'horloge monotone. */
  let lastTickBroadcastAt = Number.NEGATIVE_INFINITY;

  function sendTo(client: Client, message: ServerMessage): void {
    try {
      client.socket.send(JSON.stringify(message));
    } catch (error) {
      // Une socket qui lève à l'écriture est morte. La garder ferait échouer
      // chaque diffusion suivante : on l'écarte sans bruit.
      scoped.debug('client écarté après un échec d’écriture', { cause: error });
      drop(client);
    }
  }

  function drop(client: Client): void {
    clients.delete(client);
    try {
      client.socket.close(GOING_AWAY);
    } catch {
      // La socket est déjà tombée : il n'y a rien de plus à faire, et lever ici
      // interromprait la diffusion aux autres clients.
    }
  }

  function broadcast(message: ServerMessage): void {
    const channel = channelOf(message);

    // L'instantané protège de la modification concurrente : `sendTo` peut retirer
    // un client de l'ensemble en cours d'itération.
    for (const client of [...clients]) {
      if (channel !== null && !client.channels.has(channel)) {
        continue;
      }
      sendTo(client, message);
    }
  }

  function snapshotMessage(): ServerMessage {
    const snapshot = getSnapshot();
    return { type: 'state', counter: snapshot.counter, twitch: snapshot.twitch };
  }

  /**
   * Traite un message entrant.
   *
   * Toute anomalie ferme la connexion. C'est brutal, et c'est voulu : le canal
   * n'accepte que deux messages, un client conforme n'en émet jamais d'autre, et
   * un client non conforme n'a rien à faire là.
   */
  function handleMessage(client: Client, raw: string): void {
    function reject(code: string, message: string): void {
      // Le message reçu n'est jamais réfléchi dans l'erreur : le renvoyer le
      // ferait traverser une couche qui pourrait l'interpréter.
      sendTo(client, { type: 'error', code, message });
      drop(client);
    }

    const maxMessageBytes = getConfig().server.websocket.maxMessageBytes;
    if (Buffer.byteLength(raw, 'utf8') > maxMessageBytes) {
      scoped.warning('message WebSocket refusé : plafond dépassé', { maxMessageBytes });
      reject('message_too_large', 'Message trop volumineux.');
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      reject('invalid_json', 'Message illisible.');
      return;
    }

    const validated = clientMessageSchema.safeParse(parsed);
    if (!validated.success) {
      reject('invalid_message', 'Message non conforme au protocole.');
      return;
    }

    switch (validated.data.type) {
      case 'ping':
        sendTo(client, { type: 'pong' });
        return;
      case 'subscribe':
        client.channels = new Set(validated.data.channels);
        return;
    }
  }

  function onHeartbeat(): void {
    for (const client of [...clients]) {
      if (client.awaitingPong) {
        // Un battement entier sans réponse : la connexion est morte, quoi qu'en
        // dise le système d'exploitation.
        scoped.debug('client muet terminé');
        drop(client);
        continue;
      }

      client.awaitingPong = true;
      try {
        client.socket.ping();
      } catch (error) {
        scoped.debug('client écarté après un échec de ping', { cause: error });
        drop(client);
      }
    }
  }

  return {
    start(): void {
      if (running) {
        return;
      }
      running = true;

      subscriptions.push(
        bus.on('counter:changed', (payload) => {
          // Le lissage ne concerne que l'érosion naturelle : une mutation part
          // immédiatement, sans quoi un gift sub attendrait jusqu'à une seconde.
          if (payload.origin === 'tick') {
            const now = clock.monotonicMs();
            const interval = getConfig().server.websocket.stateBroadcastIntervalMs;
            if (now - lastTickBroadcastAt < interval) {
              return;
            }
            lastTickBroadcastAt = now;
          }

          broadcast({
            type: 'counter',
            state: payload.state,
            origin: payload.origin,
            deltaMs: payload.deltaMs,
            reason: payload.reason,
          });
        }),
      );

      subscriptions.push(
        bus.on('twitch:status', (payload) => {
          // Construction conditionnelle : `exactOptionalPropertyTypes` distingue
          // une propriété absente d'une propriété valant `undefined`, et le
          // message sérialisé ne doit pas porter de `detail: null`.
          broadcast(
            payload.detail === undefined
              ? { type: 'twitch:status', status: payload.status }
              : { type: 'twitch:status', status: payload.status, detail: payload.detail },
          );
        }),
      );

      subscriptions.push(
        bus.on('counter:event-applied', (payload) => {
          broadcast({
            type: 'event',
            event: payload.event,
            rewardSeconds: payload.reward.seconds,
            applied: payload.reward.applied,
          });
        }),
      );

      heartbeatId = timers.setInterval(
        onHeartbeat,
        getConfig().server.websocket.heartbeatIntervalMs,
      );
    },

    stop(): void {
      if (!running) {
        return;
      }
      running = false;

      for (const unsubscribe of subscriptions.splice(0)) {
        unsubscribe();
      }

      if (heartbeatId !== null) {
        timers.clearInterval(heartbeatId);
        heartbeatId = null;
      }

      for (const client of [...clients]) {
        drop(client);
      }
    },

    accept(socket: HubSocket, context: HandshakeContext): void {
      if (!isAllowedWebSocketOrigin(context.origin)) {
        // Une page tierce ne doit pas pouvoir ouvrir ce canal : elle y lirait
        // l'état du compteur et la configuration d'overlay.
        scoped.warning('connexion WebSocket refusée : origine non locale');
        socket.close(POLICY_VIOLATION, 'origine refusée');
        return;
      }

      const client: Client = {
        socket,
        channels: new Set(DEFAULT_CHANNELS),
        awaitingPong: false,
      };

      clients.add(client);

      socket.onMessage((data) => {
        handleMessage(client, data);
      });
      socket.onClose(() => {
        clients.delete(client);
      });
      socket.onPong(() => {
        client.awaitingPong = false;
      });

      sendTo(client, {
        type: 'hello',
        protocolVersion: PROTOCOL_VERSION,
        appVersion,
        port: getPort(),
        // Seule la section `overlay` est transmise : elle ne contient aucun
        // secret, contrairement à la configuration complète.
        overlay: getConfig().overlay,
      });

      sendTo(client, snapshotMessage());
    },

    clientCount(): number {
      return clients.size;
    },

    publishLog(record: LogRecord): void {
      broadcast({ type: 'log', record });
    },

    publishConfig(): void {
      broadcast({ type: 'config', overlay: getConfig().overlay });
    },
  };
}

/** Réexporté pour que l'adaptateur et les tests partagent la liste sans la recopier. */
export { CHANNELS };
