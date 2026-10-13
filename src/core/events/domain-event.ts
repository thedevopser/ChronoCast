export type DomainEventType = 'sub' | 'resub' | 'gift' | 'bits' | 'command';

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

// Ce à quoi les bits ont été dépensés. Les bits comptent pareil dans tous les cas : le champ ne
// sert qu'à le dire dans l'historique.
export type BitsUsage = 'cheer' | 'power_up' | 'custom_power_up' | 'unknown';

export interface BitsEvent extends BaseDomainEvent {
  readonly type: 'bits';
  readonly bits: number;

  /** Absent, c'est un cheer : les entrées d'avant les Power-ups n'en portent pas. */
  readonly usage?: BitsUsage;
}

export interface CommandEvent extends BaseDomainEvent {
  readonly command: string;

  readonly type: 'command';

  readonly seconds: number;
}

export type DomainEvent = SubEvent | ResubEvent | GiftEvent | BitsEvent | CommandEvent;
