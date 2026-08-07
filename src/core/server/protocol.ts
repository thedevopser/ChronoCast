/**
 * Contrat du WebSocket local.
 *
 * Source de vérité unique des messages échangés entre le serveur et les pages.
 * La Phase 5 ajoutera `src/web/shared/protocol.ts`, qui se contentera de
 * ré-exporter ces types : la règle ESLint sur `src/web/**` autorise déjà les
 * imports de types depuis le noyau, et un type effacé à la compilation ne crée
 * aucun couplage à l'exécution. Une seule définition, donc rien à désynchroniser.
 *
 * Le canal est **en lecture seule**. Il diffuse, il ne commande pas : toute
 * mutation passe par l'API HTTP avec son jeton. Les deux seuls messages entrants
 * admis — `ping` et `subscribe` — sont exactement ce dont l'overlay a besoin, et
 * rien de plus. Réduire la surface d'un canal que n'importe quelle page locale
 * peut ouvrir vaut mieux que la protéger.
 */

import { z } from 'zod';

import type { CounterChangeOrigin, TwitchConnectionStatus } from '../app/app-events.js';
import type { OverlayConfig } from '../config/schema.js';
import type { CounterState } from '../counter/counter-state.js';
import type { DomainEvent } from '../events/domain-event.js';
import type { LogRecord } from '../logging/logger.js';
import type { UpdateStatus } from '../update/update-service.js';

/**
 * Version du protocole.
 *
 * À incrémenter dès qu'un message change de forme. L'overlay tourne dans une
 * Browser Source OBS qui n'est pas rechargée automatiquement : après une mise à
 * jour, une page ancienne peut parfaitement parler à un serveur neuf, et elle
 * doit pouvoir s'en apercevoir.
 */
export const PROTOCOL_VERSION = 1;

/**
 * Flux auxquels un client peut s'abonner.
 *
 * L'overlay ne demande que `counter`, `event` et `config` ; le panneau
 * d'administration prend tout. Sans ce filtre, chaque ligne de journal serait
 * poussée vers OBS, qui n'en fait rien.
 */
export const CHANNELS = ['counter', 'event', 'log', 'config', 'twitch', 'update'] as const;
export type Channel = (typeof CHANNELS)[number];

/** Abonnement par défaut : tout, tant que le client n'a rien demandé de précis. */
export const DEFAULT_CHANNELS: readonly Channel[] = CHANNELS;

/* -------------------------------------------------------------------------- */
/* Messages du serveur vers le client                                          */
/* -------------------------------------------------------------------------- */

/** Premier message de toute connexion : ce que le client a besoin de savoir. */
export interface HelloMessage {
  readonly type: 'hello';
  readonly protocolVersion: number;
  readonly appVersion: string;
  /** Port réellement retenu, qui peut différer de celui demandé après un repli. */
  readonly port: number;
  /**
   * Port du WebSocket, égal au précédent en mode `shared`.
   *
   * Il n'est **pas** ce qui rend le mode `separate` utilisable : ce message
   * arrive sur la connexion qu'il aurait fallu savoir ouvrir. C'est le
   * marqueur substitué dans le HTML qui joue ce rôle. Il est annoncé ici pour
   * que le contrat soit auto-descriptif et qu'un client puisse vérifier qu'il
   * parle bien au port qu'il croit.
   */
  readonly wsPort: number;
  readonly overlay: OverlayConfig;
}

/** Instantané complet, envoyé à la connexion puis à chaque resynchronisation. */
export interface StateMessage {
  readonly type: 'state';
  readonly counter: CounterState;
  readonly twitch: { readonly status: TwitchConnectionStatus; readonly detail?: string };
}

/** Le compteur a changé. Diffusé au fil de l'eau pour les mutations. */
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

/** Un événement Twitch a crédité du temps : de quoi animer l'overlay. */
export interface EventMessage {
  readonly type: 'event';
  readonly event: DomainEvent;
  readonly rewardSeconds: number;
  readonly applied: boolean;

  /**
   * Libellé à afficher au-dessus de la bulle, ou absent.
   *
   * Aujourd'hui renseigné pour les seules commandes de chat, depuis
   * `rewards.chatCommand.overlayText`. Il voyage dans le message plutôt que
   * d'être lu par l'overlay : celui-ci ne reçoit que le sous-arbre `overlay`
   * de la configuration, et le libellé vit dans le barème.
   *
   * **Ce texte ne vient pas du réseau** — il est saisi dans le panneau, borné
   * par le schéma. `safe-dom` s'y applique malgré tout, comme partout.
   */
  readonly label?: string;
}

export interface LogMessage {
  readonly type: 'log';
  readonly record: LogRecord;
}

/** La configuration a changé : l'overlay réapplique ses variables CSS sans rechargement. */
export interface ConfigMessage {
  readonly type: 'config';
  readonly overlay: OverlayConfig;
}

/** Réponse à un `ping` client. Le heartbeat protocolaire, lui, passe par les trames WebSocket. */
export interface PongMessage {
  readonly type: 'pong';
}

export interface ErrorMessage {
  readonly type: 'error';
  readonly code: string;
  readonly message: string;
}

/**
 * État de la mise à jour automatique.
 *
 * Diffusé à chaque transition. Le panneau en fait un bandeau ; l'overlay ne le
 * reçoit jamais, puisqu'il ne s'abonne qu'à `counter`, `event` et `config` —
 * une mise à jour disponible n'a rien à faire devant les spectateurs.
 */
export interface UpdateMessage {
  readonly type: 'update';
  readonly status: UpdateStatus;
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

/** Canal auquel se rattache un message diffusé, ou `null` s'il échappe au filtre. */
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
    case 'update':
      return 'update';
    // `hello`, `state`, `pong` et `error` sont adressés, jamais filtrés : les
    // retenir laisserait un client sans réponse à sa propre demande.
    case 'hello':
    case 'state':
    case 'pong':
    case 'error':
      return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Messages du client vers le serveur                                          */
/* -------------------------------------------------------------------------- */

/**
 * Schéma des messages entrants.
 *
 * Tout ce qui vient d'une page est du texte non fiable, même sur la boucle
 * locale : la page peut avoir été ouverte par un lien. Zod est la seule porte
 * d'entrée, et l'union discriminée refuse par construction un type inconnu.
 */
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
