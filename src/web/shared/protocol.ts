/**
 * Contrat du WebSocket local, vu du navigateur.
 *
 * **Ce fichier redéclare le contrat au lieu de le ré-exporter, et ce n'est pas
 * un choix.** `tsconfig.web.json` fixe `rootDir` à `src/web` ; TypeScript
 * refuse alors tout fichier du programme situé hors de cette racine (TS6059),
 * y compris atteint par un `import type` pourtant effacé à la compilation.
 * Retirer `rootDir` ferait émettre le noyau compilé dans `dist/public`, servi
 * au navigateur : hors de question. La règle ESLint qui n'autorise que les
 * `import type` en provenance du noyau va d'ailleurs dans le même sens.
 *
 * La duplication est donc subie. Elle est tenue par
 * `tests/unit/web/shared/protocol.test.ts`, qui voit les deux côtés à la fois
 * et fait échouer la compilation dès qu'un champ diverge. **Toute modification
 * de `src/core/server/protocol.ts` doit être répercutée ici**, faute de quoi le
 * `typecheck` casse — ce qui est exactement l'effet recherché.
 *
 * Le canal est en lecture seule : le serveur diffuse, il n'obéit pas. Les deux
 * seuls messages sortants admis sont `ping` et `subscribe`.
 */

/* -------------------------------------------------------------------------- */
/* Vocabulaire du noyau                                                        */
/* -------------------------------------------------------------------------- */

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
  /**
   * Nom affiché, **choisi par un tiers non fiable**.
   *
   * N'importe quel spectateur peut y placer du HTML, et l'overlay tourne dans
   * une Browser Source OBS. Cette valeur ne franchit jamais autrement que par
   * `textContent`, via `safe-dom.ts`.
   */
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

/**
 * Commande de chat créditant du temps.
 *
 * Contrairement à `userName`, `command` et `seconds` ne sont **pas** choisis
 * librement par un tiers : le nom est contraint par le schéma et les secondes
 * ont traversé le plafond du barème. Cela ne change rien à la règle — tout
 * passe par `safe-dom` — mais explique pourquoi seul `userName` porte
 * l'avertissement.
 */
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

/**
 * Sous-arbre `overlay` de la configuration.
 *
 * Non `readonly`, contrairement au reste : côté noyau ce type est inféré par
 * Zod, qui produit des propriétés mutables. L'assertion d'alignement tolère
 * l'écart de modificateur, mais s'aligner évite d'avoir à se le demander.
 */
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

/* -------------------------------------------------------------------------- */
/* Constantes du protocole                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Version du protocole attendue par cette page.
 *
 * Une Browser Source OBS n'est jamais rechargée automatiquement : après une
 * mise à jour de ChronoCast, une page ancienne peut parfaitement dialoguer avec
 * un serveur neuf. Comparer cette valeur à celle du `hello` est le seul moyen
 * de s'en apercevoir.
 */
export const PROTOCOL_VERSION = 1;

export const CHANNELS = ['counter', 'event', 'log', 'config', 'twitch', 'update'] as const;
export type Channel = (typeof CHANNELS)[number];

/** Ce que le hub attribue tant que le client n'a rien demandé de précis. */
export const DEFAULT_CHANNELS: readonly Channel[] = CHANNELS;

/* -------------------------------------------------------------------------- */
/* Messages du serveur vers le client                                          */
/* -------------------------------------------------------------------------- */

export interface HelloMessage {
  readonly type: 'hello';
  readonly protocolVersion: number;
  readonly appVersion: string;
  readonly port: number;
  /** Port du WebSocket, égal au précédent en mode `shared`. Voir `ws-url.ts`. */
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

  /**
   * Libellé à afficher au-dessus de la bulle, ou absent.
   *
   * Il voyage dans le message parce que l'overlay ne reçoit que le sous-arbre
   * `overlay` de la configuration, alors que ce texte vit dans le barème.
   * Absent vaut « pas de libellé ».
   */
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

/**
 * Phases de la mise à jour automatique.
 *
 * Redéclarées ici comme tout le reste du contrat : `tsconfig.web.json` fixe
 * `rootDir` à `src/web`, et TypeScript refuse tout fichier du programme situé
 * hors de cette racine — y compris atteint par un `import type` pourtant effacé
 * à la compilation. Le test d'assignabilité mutuelle tient les deux côtés
 * ensemble.
 *
 * `disabled` est un choix de l'utilisateur, `unsupported` une propriété du
 * point d'entrée : le panneau ne dit pas la même chose dans les deux cas.
 */
export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'ready'
  | 'error'
  | 'disabled'
  | 'unsupported';

export interface UpdateStatus {
  readonly phase: UpdatePhase;
  readonly currentVersion: string;
  readonly availableVersion: string | null;
  readonly notesUrl: string | null;
  readonly message: string | null;
  readonly checkedAt: number | null;
}

export interface UpdateMessage {
  readonly type: 'update';
  readonly status: UpdateStatus;
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
  | UpdateMessage
  | PongMessage
  | ErrorMessage;

/* -------------------------------------------------------------------------- */
/* Messages du client vers le serveur                                          */
/* -------------------------------------------------------------------------- */

export type ClientMessage =
  | { readonly type: 'ping' }
  | { readonly type: 'subscribe'; readonly channels: Channel[] };

/* -------------------------------------------------------------------------- */
/* Lecture d'un message entrant                                                */
/* -------------------------------------------------------------------------- */

/**
 * Discriminants admis.
 *
 * `Set` plutôt qu'une suite de comparaisons : la liste doit rester alignée sur
 * l'union `ServerMessage`, et une seule énumération est plus facile à tenir.
 */
const SERVER_MESSAGE_TYPES = new Set<string>([
  'hello',
  'state',
  'counter',
  'twitch:status',
  'event',
  'log',
  'config',
  'update',
  'pong',
  'error',
]);

/**
 * Texte reçu sur le socket vers message typé, ou `null`.
 *
 * Zod n'est pas disponible ici : le front est servi en modules ES natifs, sans
 * bundler, et le noyau lui est inaccessible. Le contrôle est donc écrit à la
 * main, et volontairement limité au discriminant — le reste des champs est lu
 * défensivement par ceux qui les consomment.
 *
 * Ce que ce filtre protège n'est pas la confidentialité : le serveur est local
 * et apparié. C'est la **survie de la page**. Une exception levée dans le
 * gestionnaire de message casse la boucle de réception, et une Browser Source
 * OBS n'est jamais rechargée : l'overlay resterait figé jusqu'à ce que le
 * streamer s'en aperçoive, c'est-à-dire en direct.
 */
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
