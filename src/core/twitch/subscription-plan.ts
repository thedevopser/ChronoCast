import type { TwitchConfig } from '../config/schema.js';

export interface SubscriptionContext {
  readonly broadcasterUserId: string;

  readonly userId: string;
}

export interface SubscriptionDefinition {
  readonly type: string;

  readonly version: string;

  readonly scopes: readonly string[];

  readonly required: boolean;

  readonly isEnabled: (config: TwitchConfig) => boolean;

  readonly buildCondition: (context: SubscriptionContext) => Record<string, string>;
}

export interface ResolvedSubscription {
  readonly type: string;
  readonly version: string;
  readonly required: boolean;
  readonly condition: Record<string, string>;
}

function broadcasterCondition(context: SubscriptionContext): Record<string, string> {
  return { broadcaster_user_id: context.broadcasterUserId };
}

export const SUBSCRIPTION_PLAN: readonly SubscriptionDefinition[] = [
  {
    type: 'channel.chat.notification',
    version: '1',
    scopes: ['user:read:chat', 'user:bot'],
    required: false,
    isEnabled: (config) => config.enableChatNotifications,
    buildCondition: (context) => ({
      broadcaster_user_id: context.broadcasterUserId,
      user_id: context.userId,
    }),
  },
  {
    type: 'channel.chat.message',
    version: '1',
    scopes: ['user:read:chat', 'user:bot'],
    required: false,
    isEnabled: (config) => config.enableChatCommands,
    buildCondition: (context) => ({
      broadcaster_user_id: context.broadcasterUserId,
      user_id: context.userId,
    }),
  },
  {
    type: 'channel.subscribe',
    version: '1',
    scopes: ['channel:read:subscriptions'],
    required: true,
    isEnabled: () => true,
    buildCondition: broadcasterCondition,
  },
  {
    type: 'channel.subscription.message',
    version: '1',
    scopes: ['channel:read:subscriptions'],
    required: true,
    isEnabled: () => true,
    buildCondition: broadcasterCondition,
  },
  {
    type: 'channel.subscription.gift',
    version: '1',
    scopes: ['channel:read:subscriptions'],
    required: true,
    isEnabled: () => true,
    buildCondition: broadcasterCondition,
  },
  {
    type: 'channel.cheer',
    version: '1',
    scopes: ['bits:read'],
    required: true,
    isEnabled: () => true,
    buildCondition: broadcasterCondition,
  },
];

export function resolveSubscriptions(
  config: TwitchConfig,
  context: SubscriptionContext,
): ResolvedSubscription[] {
  return SUBSCRIPTION_PLAN.filter((definition) => definition.isEnabled(config)).map(
    (definition) => ({
      type: definition.type,
      version: definition.version,
      required: definition.required,
      condition: definition.buildCondition(context),
    }),
  );
}

// Dérivé du plan, jamais écrit à la main : une liste de réglages en dur pourrirait en silence
// dès qu'une souscription serait ajoutée.
function enabledTypes(config: TwitchConfig): string[] {
  return SUBSCRIPTION_PLAN.filter((definition) => definition.isEnabled(config)).map(
    (definition) => definition.type,
  );
}

export function requiresRestart(previous: TwitchConfig, next: TwitchConfig): boolean {
  if (previous.broadcasterUserId !== next.broadcasterUserId) {
    return true;
  }

  if (previous.eventsubUrl !== next.eventsubUrl) {
    return true;
  }

  return enabledTypes(previous).join('|') !== enabledTypes(next).join('|');
}

export function requiredScopes(config: TwitchConfig): string[] {
  const scopes = new Set<string>();

  for (const definition of SUBSCRIPTION_PLAN) {
    if (!definition.isEnabled(config)) {
      continue;
    }
    for (const scope of definition.scopes) {
      scopes.add(scope);
    }
  }

  return [...scopes];
}
