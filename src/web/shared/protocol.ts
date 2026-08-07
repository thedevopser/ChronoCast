export type CounterStatus = 'idle' | 'running' | 'paused' | 'finished';

export interface CounterState {
  readonly remainingMs: number;
  readonly status: CounterStatus;
  readonly initialMs: number;
  readonly totalAddedMs: number;
  readonly totalRemovedMs: number;
  readonly startedAt: number | null;
  readonly finishedAt: number | null;
  readonly updatedAt: number;
  readonly schemaVersion: number;
}

export type CounterChangeOrigin = 'tick' | 'manual' | 'twitch' | 'restore';

export type TwitchConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'ready'
  | 'reconnecting';

export type DomainEventType = 'sub' | 'resub' | 'gift' | 'bits' | 'raid' | 'follow' | 'command';
export type SubscriptionTier = 'tier1' | 'tier2' | 'tier3' | 'prime';
export type GiftTier = Exclude<SubscriptionTier, 'prime'>;
export type DomainEventSource = 'eventsub' | 'chat-notification' | 'manual' | 'chat-command';

interface BaseDomainEvent {
  readonly id: string;
  readonly occurredAt: number;
  readonly userId: string;
  readonly userName: string;
  readonly source: DomainEventSource;
}

export interface SubEvent extends BaseDomainEvent {
  readonly type: 'sub';
  readonly tier: SubscriptionTier;
}

export interface ResubEvent extends BaseDomainEvent {
  readonly type: 'resub';
  readonly tier: SubscriptionTier;
  readonly cumulativeMonths: number;
}

export interface GiftEvent extends BaseDomainEvent {
  readonly type: 'gift';
  readonly tier: GiftTier;
  readonly total: number;
  readonly isAnonymous: boolean;
}

export interface BitsEvent extends BaseDomainEvent {
  readonly type: 'bits';
  readonly bits: number;
}

export interface RaidEvent extends BaseDomainEvent {
  readonly type: 'raid';
  readonly viewers: number;
}

export interface FollowEvent extends BaseDomainEvent {
  readonly type: 'follow';
}

export interface CommandEvent extends BaseDomainEvent {
  readonly command: string;
  readonly type: 'command';
  readonly seconds: number;
}

export type DomainEvent =
  | SubEvent
  | ResubEvent
  | GiftEvent
  | BitsEvent
  | RaidEvent
  | FollowEvent
  | CommandEvent;

export type LogLevel = 'debug' | 'info' | 'warning' | 'error';

export interface LogRecord {
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly scope: string;
  readonly message: string;
  readonly context?: Record<string, unknown>;
}

export interface OverlayConfig {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  letterSpacing: number;
  color: string;
  showDays: boolean;
  hideEmptyHours: boolean;
  textAlign: 'left' | 'center' | 'right';
  shadow: {
    enabled: boolean;
    color: string;
    blur: number;
    offsetX: number;
    offsetY: number;
  };
  outline: {
    enabled: boolean;
    color: string;
    width: number;
  };
  glow: {
    enabled: boolean;
    color: string;
    radius: number;
  };
  gradient: {
    onText: boolean;
    onFrame: boolean;
    from: string;
    to: string;
    angleDeg: number;
  };
  frame: {
    enabled: boolean;
    color: string;
    width: number;
    radius: number;
    paddingX: number;
    paddingY: number;
    fillColor: string;
    fillOpacity: number;
  };
  animation: {
    onAdd: 'none' | 'flash' | 'pulse' | 'shake';
    durationMs: number;
  };
  toast: {
    enabled: boolean;
    durationMs: number;
    color: string;
    fontSize: number;
  };
  enableCustomCss: boolean;
}

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

export type ClientMessage =
  | { readonly type: 'ping' }
  | { readonly type: 'subscribe'; readonly channels: Channel[] };

const SERVER_MESSAGE_TYPES = new Set<string>([
  'hello',
  'state',
  'counter',
  'twitch:status',
  'event',
  'log',
  'config',
  'pong',
  'error',
]);

export function parseServerMessage(raw: unknown): ServerMessage | null {
  if (typeof raw !== 'string') {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const candidate = parsed as { type?: unknown };
  if (typeof candidate.type !== 'string' || !SERVER_MESSAGE_TYPES.has(candidate.type)) {
    return null;
  }

  return parsed as ServerMessage;
}
