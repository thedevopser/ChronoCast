import { z } from 'zod';

import type { CounterChangeOrigin, TwitchConnectionStatus } from '../app/app-events.js';
import type { OverlayConfig } from '../config/schema.js';
import type { CounterState } from '../counter/counter-state.js';
import type { DomainEvent } from '../events/domain-event.js';
import type { LogRecord } from '../logging/logger.js';

export const PROTOCOL_VERSION = 2;

export const CHANNELS = ['counter', 'event', 'log', 'config', 'twitch'] as const;
export type Channel = (typeof CHANNELS)[number];

export const DEFAULT_CHANNELS: readonly Channel[] = CHANNELS;

export interface HelloMessage {
  readonly type: 'hello';
  readonly protocolVersion: number;
  readonly appVersion: string;
  readonly port: number;
  readonly wsPort: number;
  readonly overlay: OverlayConfig;
}

export interface StateMessage {
  readonly type: 'state';
  readonly counter: CounterState;
  readonly twitch: { readonly status: TwitchConnectionStatus; readonly detail?: string };
}

export interface CounterMessage {
  readonly type: 'counter';
  readonly state: CounterState;
  readonly origin: CounterChangeOrigin;
  readonly deltaMs: number;
  readonly reason: string;
}

export interface TwitchStatusMessage {
  readonly type: 'twitch:status';
  readonly status: TwitchConnectionStatus;
  readonly detail?: string;
}

export interface EventMessage {
  readonly type: 'event';
  readonly event: DomainEvent;
  readonly rewardSeconds: number;
  readonly applied: boolean;

  readonly label?: string;
}

export interface LogMessage {
  readonly type: 'log';
  readonly record: LogRecord;
}

export interface ConfigMessage {
  readonly type: 'config';
  readonly overlay: OverlayConfig;
}

export interface PongMessage {
  readonly type: 'pong';
}

export interface ErrorMessage {
  readonly type: 'error';
  readonly code: string;
  readonly message: string;
}

export type ServerMessage =
  | HelloMessage
  | StateMessage
  | CounterMessage
  | TwitchStatusMessage
  | EventMessage
  | LogMessage
  | ConfigMessage
  | PongMessage
  | ErrorMessage;

export function channelOf(message: ServerMessage): Channel | null {
  switch (message.type) {
    case 'counter':
      return 'counter';
    case 'event':
      return 'event';
    case 'log':
      return 'log';
    case 'config':
      return 'config';
    case 'twitch:status':
      return 'twitch';
    case 'hello':
    case 'state':
    case 'pong':
    case 'error':
      return null;
  }
}

export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ping') }).strip(),
  z
    .object({
      type: z.literal('subscribe'),
      channels: z.array(z.enum(CHANNELS)).min(1).max(CHANNELS.length),
    })
    .strip(),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;
