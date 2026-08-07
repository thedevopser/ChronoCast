/**
 * Vocabulaire d'événements de ChronoCast.
 *
 * Forme normalisée à laquelle le module Twitch réduit les charges utiles
 * EventSub, et seule forme que connaissent le barème, le compteur et
 * l'historique. Rien de spécifique à Twitch ne franchit cette frontière :
 * ajouter une autre source d'événements ne demanderait qu'un nouveau
 * convertisseur.
 *
 * Ce fichier ne contient que des types, il n'y a donc rien à y tester.
 *
 * Avertissement de sécurité : `userName` et `message` sont **choisis par un
 * tiers non fiable**. N'importe quel spectateur peut y placer du HTML. Toute
 * insertion dans le DOM doit passer par `textContent`.
 */

/** Nature de l'événement. */
export type DomainEventType = 'sub' | 'resub' | 'gift' | 'bits' | 'raid' | 'follow' | 'command';

/**
 * Palier d'abonnement.
 *
 * `prime` n'est distinguable de `tier1` que via `channel.chat.notification` :
 * `channel.subscribe` renvoie `tier: "1000"` dans les deux cas, sans aucun
 * indicateur. Sans ce flux, un abonnement Prime est donc reçu comme un Tier 1.
 */
export type SubscriptionTier = 'tier1' | 'tier2' | 'tier3' | 'prime';

/** Palier d'un abonnement offert. Un don ne peut pas être Prime. */
export type GiftTier = Exclude<SubscriptionTier, 'prime'>;

/**
 * Provenance de l'événement.
 *
 * Sert à la déduplication croisée : le même abonnement peut arriver à la fois
 * par `channel.subscribe` et par `channel.chat.notification`.
 *
 * `chat-command` s'en distingue par nature : ce n'est pas une seconde façon
 * d'apprendre un même fait de plateforme, c'est une **intention humaine**. Deux
 * commandes identiques sont deux intentions, jamais un doublon.
 */
export type DomainEventSource = 'eventsub' | 'chat-notification' | 'manual' | 'chat-command';

interface BaseDomainEvent {
  /**
   * Identifiant unique, repris du `message_id` de l'enveloppe EventSub.
   * C'est la clé de déduplication des retransmissions de Twitch.
   */
  readonly id: string;

  /** Instant de survenue, en millisecondes depuis l'époque. */
  readonly occurredAt: number;

  readonly userId: string;

  /** Nom affiché. Contenu contrôlé par un tiers : jamais inséré en HTML. */
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
  /** Nombre d'abonnements offerts dans cet événement. */
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
 * **Seul événement dont les secondes ne viennent pas du barème** : un
 * modérateur les a tapées dans son message. C'est un écart assumé au principe
 * « aucune valeur métier hors du schéma », et c'est le besoin qui l'impose —
 * une durée qu'aucun barème ne pouvait prévoir, créditée sans lâcher la manette.
 *
 * Ce que le schéma garde est le **plafond**, appliqué deux fois : refus dans
 * `command-service.ts` avant même de produire cet événement, écrêtage défensif
 * dans `reward-engine.ts` pour les chemins qui ne passent pas par lui.
 */
export interface CommandEvent extends BaseDomainEvent {
  /** Nom de la commande, sans le préfixe. Contenu contraint par le schéma. */
  readonly command: string;

  readonly type: 'command';

  /** Secondes demandées. Toujours strictement positives à ce stade. */
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
