/**
 * Modèle du tableau de bord.
 *
 * Le panneau reçoit le même flux que l'overlay, mais en fait tout autre chose :
 * il montre un état, il propose des commandes, et il doit dire lesquelles ont
 * un sens à l'instant présent. Cette décision — quoi afficher, quoi activer,
 * quoi retenir — vit ici, dans un module pur, et non dans le câblage.
 *
 * Deux conventions reprises du noyau, pour les mêmes raisons qu'ailleurs :
 *
 *   - **le modèle est immuable**, et renvoyé *identique par référence* quand un
 *     message ne change rien. La vue s'en sert pour ne pas repeindre une liste
 *     inchangée à chaque battement ;
 *   - **rien n'est assaini ici.** Les pseudos traversent tels quels et ne sont
 *     nettoyés qu'à l'écriture, par `safe-dom`. Deux endroits où s'en souvenir,
 *     c'est un endroit où l'oublier.
 */

import type {
  CounterState,
  CounterStatus,
  DomainEventType,
  ServerMessage,
  TwitchConnectionStatus,
} from '../shared/protocol.js';

/**
 * Nombre d'événements récents conservés.
 *
 * Cinq : de quoi vérifier d'un coup d'œil que la chaîne fonctionne. Au-delà,
 * c'est le rôle de la vue historique, qui sait filtrer et paginer.
 */
export const MAX_RECENT_EVENTS = 5;

/** Un événement, réduit à ce que la vignette du tableau de bord affiche. */
export interface RecentEvent {
  readonly id: string;
  /** Non assaini : `safe-dom` s'en charge à l'écriture. */
  readonly userName: string;
  readonly type: DomainEventType;
  readonly rewardSeconds: number;
  /** Faux quand le barème ou un plafond a écarté l'événement. */
  readonly applied: boolean;
  readonly occurredAt: number;
}

export interface DashboardModel {
  /** `null` tant que le premier instantané n'est pas arrivé. */
  readonly counter: CounterState | null;
  readonly twitch: {
    readonly status: TwitchConnectionStatus;
    /** Jamais `undefined` : « undefined » finirait affiché tel quel. */
    readonly detail: string;
  };
  /** Le plus récent d'abord. */
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

/** Vrai si les deux états décrivent exactement la même chose. */
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

/** Intègre un message du serveur. Ne modifie jamais le modèle reçu. */
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
      // Le hub rediffuse à la reconnexion, et deux tests d'overlay lancés dans
      // la même milliseconde partagent leur identifiant.
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
    case 'update':
    case 'pong':
    case 'error':
      // Rien à retenir ici : l'apparence appartient à la vue *apparence*, les
      // journaux à la vue *journaux*, la mise à jour au bandeau de la coquille
      // — elle ne dépend d'aucune vue et doit se voir depuis toutes —, et un
      // `pong` ne dit rien de l'état.
      return model;
  }
}

export interface CounterControls {
  readonly canPause: boolean;
  readonly canResume: boolean;
  readonly canReset: boolean;
}

/**
 * Commandes ayant un sens pour l'état courant.
 *
 * Tout est inerte tant que l'état n'est pas connu : commander un compteur
 * qu'on n'a pas encore reçu, c'est agir à l'aveugle, et la première chose
 * qu'on verrait serait un `400` inexplicable.
 */
export function counterControls(counter: CounterState | null): CounterControls {
  if (counter === null) {
    return { canPause: false, canResume: false, canReset: false };
  }

  return {
    canPause: counter.status === 'running',
    // `finished` compris : créditer du temps rouvre un subathon achevé, la
    // reprise doit pouvoir en faire autant.
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

/** Libellés des types d'événement, pour la liste des derniers reçus. */
export const EVENT_LABELS: Readonly<Record<DomainEventType, string>> = {
  sub: 'Abonnement',
  resub: 'Réabonnement',
  gift: 'Dons d’abonnement',
  bits: 'Bits',
  raid: 'Raid',
  follow: 'Follow',
  command: 'Commande de chat',
};
