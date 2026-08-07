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

export interface HubSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  ping(): void;
  onMessage(handler: (data: string) => void): void;
  onClose(handler: () => void): void;
  onPong(handler: () => void): void;
}

export interface HubTimers {
  setInterval(handler: () => void, ms: number): number;
  clearInterval(id: number): void;
}

export interface HandshakeContext {
  readonly origin?: string;
}

export interface HubSnapshot {
  readonly counter: CounterState;
  readonly twitch: { readonly status: AppEvents['twitch:status']['status']; readonly detail?: string };
}

export interface WsHub {
  start(): void;

  stop(): void;

  accept(socket: HubSocket, context: HandshakeContext): void;

  clientCount(): number;

  publishLog(record: LogRecord): void;

  publishConfig(): void;
}

export interface WsHubOptions {
  readonly bus: EventBus<AppEvents>;
  readonly getConfig: () => ChronoCastConfig;
  readonly getSnapshot: () => HubSnapshot;
  readonly clock: Clock;
  readonly timers: HubTimers;
  readonly getPort: () => number;
  readonly getWsPort: () => number;
  readonly appVersion: string;
  readonly logger: Logger;
}

const POLICY_VIOLATION = 1008;

const GOING_AWAY = 1001;

interface Client {
  readonly socket: HubSocket;
  channels: ReadonlySet<Channel>;
  awaitingPong: boolean;
}

export function createWsHub(options: WsHubOptions): WsHub {
  const { bus, getConfig, getSnapshot, clock, timers, getPort, getWsPort, appVersion, logger } =
    options;
  const scoped = logger.child('ws');

  const clients = new Set<Client>();
  const subscriptions: Unsubscribe[] = [];

  let heartbeatId: number | null = null;
  let running = false;

  let lastTickBroadcastAt = Number.NEGATIVE_INFINITY;

  function sendTo(client: Client, message: ServerMessage): void {
    try {
      client.socket.send(JSON.stringify(message));
    } catch (error) {
      scoped.debug('client écarté après un échec d’écriture', { cause: error });
      drop(client);
    }
  }

  function drop(client: Client): void {
    clients.delete(client);
    try {
      client.socket.close(GOING_AWAY);
    } catch {
      // Socket déjà morte : le client est retiré dans tous les cas.
    }
  }

  function broadcast(message: ServerMessage): void {
    const channel = channelOf(message);

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

  function handleMessage(client: Client, raw: string): void {
    function reject(code: string, message: string): void {
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
          broadcast(
            payload.detail === undefined
              ? { type: 'twitch:status', status: payload.status }
              : { type: 'twitch:status', status: payload.status, detail: payload.detail },
          );
        }),
      );

      subscriptions.push(
        bus.on('counter:event-applied', (payload) => {
          const base = {
            type: 'event',
            event: payload.event,
            rewardSeconds: payload.reward.seconds,
            applied: payload.reward.applied,
          } as const;

          const label = getConfig().rewards.chatCommand.overlayText;
          broadcast(
            payload.event.type === 'command' && label !== ''
              ? { ...base, label }
              : base,
          );
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
        wsPort: getWsPort(),
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

export { CHANNELS };
