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
