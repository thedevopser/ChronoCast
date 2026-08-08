import type {
  CounterState,
  CounterStatus,
  DomainEventType,
  ServerMessage,
  TwitchConnectionStatus,
} from '../shared/protocol.js';

export const MAX_RECENT_EVENTS = 5;

export interface RecentEvent {
  readonly id: string;
  readonly userName: string;
  readonly type: DomainEventType;
  readonly rewardSeconds: number;
  readonly applied: boolean;
  readonly occurredAt: number;
}

export interface DashboardModel {
  readonly counter: CounterState | null;
  readonly twitch: {
    readonly status: TwitchConnectionStatus;
    readonly detail: string;
  };
  readonly events: readonly RecentEvent[];
  readonly appVersion: string;
  readonly port: number;
}

const EMPTY: DashboardModel = {
  counter: null,
  twitch: { status: 'disconnected', detail: '' },
  events: [],
  appVersion: '',
  port: 0,
};

export function createDashboardModel(): DashboardModel {
  return EMPTY;
}

function sameCounter(left: CounterState | null, right: CounterState): boolean {
  return (
    left !== null &&
    left.remainingMs === right.remainingMs &&
    left.status === right.status &&
    left.updatedAt === right.updatedAt &&
    left.initialMs === right.initialMs &&
    left.totalAddedMs === right.totalAddedMs &&
    left.totalRemovedMs === right.totalRemovedMs
  );
}

function sameTwitch(
  current: DashboardModel['twitch'],
  status: TwitchConnectionStatus,
  detail: string,
): boolean {
  return current.status === status && current.detail === detail;
}

export function applyMessage(model: DashboardModel, message: ServerMessage): DashboardModel {
  switch (message.type) {
    case 'hello':
      return { ...model, appVersion: message.appVersion, port: message.port };

    case 'state': {
      const detail = message.twitch.detail ?? '';
      if (sameCounter(model.counter, message.counter) && sameTwitch(model.twitch, message.twitch.status, detail)) {
        return model;
      }
      return {
        ...model,
        counter: message.counter,
        twitch: { status: message.twitch.status, detail },
      };
    }

    case 'counter':
      return sameCounter(model.counter, message.state)
        ? model
        : { ...model, counter: message.state };

    case 'twitch:status': {
      const detail = message.detail ?? '';
      return sameTwitch(model.twitch, message.status, detail)
        ? model
        : { ...model, twitch: { status: message.status, detail } };
    }

    case 'event': {
      if (model.events.some((entry) => entry.id === message.event.id)) {
        return model;
      }

      const entry: RecentEvent = {
        id: message.event.id,
        userName: message.event.userName,
        type: message.event.type,
        rewardSeconds: message.rewardSeconds,
        applied: message.applied,
        occurredAt: message.event.occurredAt,
      };

      return { ...model, events: [entry, ...model.events].slice(0, MAX_RECENT_EVENTS) };
    }

    case 'config':
    case 'log':
    case 'pong':
    case 'error':
      return model;
  }
}

export interface CounterControls {
  readonly canPause: boolean;
  readonly canResume: boolean;
  readonly canReset: boolean;
}

export function counterControls(counter: CounterState | null): CounterControls {
  if (counter === null) {
    return { canPause: false, canResume: false, canReset: false };
  }

  return {
    canPause: counter.status === 'running',
    canResume: counter.status !== 'running',
    canReset: true,
  };
}

const COUNTER_LABELS: Readonly<Record<CounterStatus, string>> = {
  idle: 'Pas encore démarré',
  running: 'En cours',
  paused: 'En pause',
  finished: 'Terminé',
};

const TWITCH_LABELS: Readonly<Record<TwitchConnectionStatus, string>> = {
  disconnected: 'Déconnecté',
  connecting: 'Connexion…',
  connected: 'Connecté',
  ready: 'À l’écoute',
  reconnecting: 'Reconnexion…',
};

export function statusLabel(status: CounterStatus): string {
  return COUNTER_LABELS[status];
}

export function twitchLabel(status: TwitchConnectionStatus): string {
  return TWITCH_LABELS[status];
}

export const EVENT_LABELS: Readonly<Record<DomainEventType, string>> = {
  sub: 'Abonnement',
  resub: 'Réabonnement',
  gift: 'Dons d’abonnement',
  bits: 'Bits',
  raid: 'Raid',
  follow: 'Follow',
  command: 'Commande de chat',
};
