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

export interface GoalView {
  readonly subs: number;
  readonly index: number;
  readonly total: number;
  readonly from: number;
  readonly to: number;
  readonly label: string;
  readonly complete: boolean;
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

  // Non vide tant qu'une souscription activée exige une portée que le jeton n'a pas : seule une
  // reconnexion peut l'accorder.
  readonly missingScopes: readonly string[];

  readonly happyHour: boolean;

  // Nulle tant que le serveur n'a rien annoncé : le tableau de bord n'affiche pas une progression
  // qu'il ne connaît pas.
  readonly goal: GoalView | null;
}

const EMPTY: DashboardModel = {
  counter: null,
  twitch: { status: 'disconnected', detail: '' },
  events: [],
  appVersion: '',
  port: 0,
  missingScopes: [],
  happyHour: false,
  goal: null,
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

function sameScopes(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((scope, index) => scope === right[index]);
}

function sameGoal(left: GoalView | null, right: GoalView): boolean {
  return (
    left !== null &&
    left.subs === right.subs &&
    left.index === right.index &&
    left.total === right.total &&
    left.from === right.from &&
    left.to === right.to &&
    left.label === right.label &&
    left.complete === right.complete
  );
}

export function applyMessage(model: DashboardModel, message: ServerMessage): DashboardModel {
  switch (message.type) {
    case 'hello':
      return {
        ...model,
        appVersion: message.appVersion,
        port: message.port,
        happyHour: message.happyHour,
      };

    case 'state': {
      const detail = message.twitch.detail ?? '';
      const missingScopes = message.twitch.missingScopes ?? [];
      if (
        sameCounter(model.counter, message.counter) &&
        sameTwitch(model.twitch, message.twitch.status, detail) &&
        sameScopes(model.missingScopes, missingScopes)
      ) {
        return model;
      }
      return {
        ...model,
        counter: message.counter,
        twitch: { status: message.twitch.status, detail },
        missingScopes,
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
      return model.happyHour === message.happyHour
        ? model
        : { ...model, happyHour: message.happyHour };

    case 'goal': {
      const goal: GoalView = {
        subs: message.subs,
        index: message.index,
        total: message.total,
        from: message.from,
        to: message.to,
        label: message.label,
        complete: message.complete,
      };

      return sameGoal(model.goal, goal) ? model : { ...model, goal };
    }

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

export interface HappyHourLabels {
  readonly state: string;
  readonly action: string;
}

export function happyHourLabels(active: boolean): HappyHourLabels {
  return active
    ? { state: 'Actif ×2', action: 'Désactiver' }
    : { state: 'Éteint', action: 'Activer' };
}

/** Part parcourue du palier courant, entre 0 et 1. Pilote la barre par une variable CSS. */
export function goalProgressRatio(goal: {
  readonly subs: number;
  readonly from: number;
  readonly to: number;
}): number {
  const span = goal.to - goal.from;
  if (span <= 0) {
    return 0;
  }

  const walked = (goal.subs - goal.from) / span;
  return Math.min(1, Math.max(0, walked));
}

/**
 * La remise à zéro efface une progression sans retour possible : le premier clic arme, le second
 * exécute. L'instant est passé en argument plutôt que lu d'une horloge interne, pour rester
 * décidable sans minuterie.
 */
export const RESET_ARM_WINDOW_MS = 5_000;

export function isResetArmed(armedAt: number | null, now: number): boolean {
  return armedAt !== null && now - armedAt <= RESET_ARM_WINDOW_MS;
}

export function resetLabel(armed: boolean): string {
  return armed ? 'Confirmer la remise à zéro' : 'Remettre la progression à zéro';
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
  gift: 'Sub offerts',
  bits: 'Bits',
  command: 'Commande de chat',
};
