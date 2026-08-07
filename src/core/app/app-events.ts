import type { CounterState } from '../counter/counter-state.js';
import type { RewardComputation } from '../counter/reward-engine.js';
import type { DomainEvent } from '../events/domain-event.js';
import type { OAuthOutcome } from '../server/oauth-callback.js';

export type CounterChangeOrigin = 'tick' | 'manual' | 'twitch' | 'restore';

export interface CounterChangedPayload {
  readonly state: CounterState;
  readonly origin: CounterChangeOrigin;
  readonly deltaMs: number;
  readonly reason: string;
}

export interface CounterEventAppliedPayload {
  readonly event: DomainEvent;
  readonly reward: RewardComputation;
  readonly state: CounterState;
}

export interface CounterPersistFailedPayload {
  readonly state: CounterState;
  readonly error: unknown;
}

export type TwitchConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'ready'
  | 'reconnecting';

export interface TwitchStatusPayload {
  readonly status: TwitchConnectionStatus;
  readonly detail?: string;
}

export interface TwitchRevocationPayload {
  readonly subscriptionType: string;
  readonly status: string;
}

export interface TwitchSubscriptionFailedPayload {
  readonly subscriptionType: string;
  readonly required: boolean;
  readonly error: unknown;
}

export interface AppEvents extends Record<string, unknown> {
  readonly 'counter:changed': CounterChangedPayload;

  readonly 'counter:finished': { readonly state: CounterState };

  readonly 'counter:event-applied': CounterEventAppliedPayload;

  readonly 'counter:persist-failed': CounterPersistFailedPayload;

  readonly 'twitch:status': TwitchStatusPayload;

  readonly 'twitch:revocation': TwitchRevocationPayload;

  readonly 'twitch:subscription-failed': TwitchSubscriptionFailedPayload;

  readonly 'oauth:settled': { readonly outcome: OAuthOutcome };
}
