import type {
  DomainEvent,
  GiftTier,
  SubscriptionTier,
} from '../events/domain-event.js';

export interface MapContext {
  readonly messageId: string;

  readonly receivedAt: number;

  readonly subscriptionType: string;
}

export type MapResult =
  | { readonly kind: 'event'; readonly event: DomainEvent; readonly reason: string }
  | { readonly kind: 'ignored'; readonly reason: string }
  | { readonly kind: 'invalid'; readonly reason: string };

const ANONYMOUS_DISPLAY_NAME = 'Anonyme';

const ANONYMOUS_USER_ID = 'anonymous';

const TIER_BY_CODE: Readonly<Record<string, GiftTier>> = {
  '1000': 'tier1',
  '2000': 'tier2',
  '3000': 'tier3',
};

function ignored(reason: string): MapResult {
  return { kind: 'ignored', reason };
}

function invalid(reason: string): MapResult {
  return { kind: 'invalid', reason };
}

function produced(event: DomainEvent, reason: string): MapResult {
  return { kind: 'event', event, reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function readNumber(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readRecord(source: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = source[key];
  return isRecord(value) ? value : undefined;
}

function readTier(source: Record<string, unknown>, key: string): GiftTier | undefined {
  const code = readString(source, key);
  return code === undefined ? undefined : TIER_BY_CODE[code];
}

function readActor(
  source: Record<string, unknown>,
  idKey: string,
  nameKey: string,
): { readonly userId: string; readonly userName: string } {
  return {
    userId: readString(source, idKey) ?? ANONYMOUS_USER_ID,
    userName: readString(source, nameKey) ?? ANONYMOUS_DISPLAY_NAME,
  };
}

function mapChannelSubscribe(context: MapContext, payload: Record<string, unknown>): MapResult {
  if (payload['is_gift'] === true) {
    return ignored('abonnement offert, comptabilisé avec le don');
  }

  const tier = readTier(payload, 'tier');
  if (tier === undefined) {
    return invalid(`palier d'abonnement inconnu : ${String(payload['tier'])}`);
  }

  const actor = readActor(payload, 'user_id', 'user_name');
  return produced(
    {
      id: context.messageId,
      type: 'sub',
      tier,
      occurredAt: context.receivedAt,
      source: 'eventsub',
      ...actor,
    },
    'abonnement',
  );
}

function mapSubscriptionMessage(context: MapContext, payload: Record<string, unknown>): MapResult {
  const tier = readTier(payload, 'tier');
  if (tier === undefined) {
    return invalid(`palier de réabonnement inconnu : ${String(payload['tier'])}`);
  }

  const actor = readActor(payload, 'user_id', 'user_name');
  return produced(
    {
      id: context.messageId,
      type: 'resub',
      tier,
      cumulativeMonths: readNumber(payload, 'cumulative_months') ?? 1,
      occurredAt: context.receivedAt,
      source: 'eventsub',
      ...actor,
    },
    'réabonnement',
  );
}

function mapSubscriptionGift(context: MapContext, payload: Record<string, unknown>): MapResult {
  const tier = readTier(payload, 'tier');
  if (tier === undefined) {
    return invalid(`palier de don inconnu : ${String(payload['tier'])}`);
  }

  const total = readNumber(payload, 'total');
  if (total === undefined) {
    return invalid("total d'abonnements offerts absent");
  }

  const actor = readActor(payload, 'user_id', 'user_name');
  return produced(
    {
      id: context.messageId,
      type: 'gift',
      tier,
      total,
      isAnonymous: payload['is_anonymous'] === true,
      occurredAt: context.receivedAt,
      source: 'eventsub',
      ...actor,
    },
    "don d'abonnements",
  );
}

function mapCheer(context: MapContext, payload: Record<string, unknown>): MapResult {
  const bits = readNumber(payload, 'bits');
  if (bits === undefined) {
    return invalid('nombre de bits absent');
  }

  const actor = readActor(payload, 'user_id', 'user_name');
  return produced(
    {
      id: context.messageId,
      type: 'bits',
      bits,
      occurredAt: context.receivedAt,
      source: 'eventsub',
      ...actor,
    },
    'don de bits',
  );
}

function mapRaid(context: MapContext, payload: Record<string, unknown>): MapResult {
  const viewers = readNumber(payload, 'viewers');
  if (viewers === undefined) {
    return invalid('nombre de spectateurs absent');
  }

  const actor = readActor(payload, 'from_broadcaster_user_id', 'from_broadcaster_user_name');
  return produced(
    {
      id: context.messageId,
      type: 'raid',
      viewers,
      occurredAt: context.receivedAt,
      source: 'eventsub',
      ...actor,
    },
    'raid',
  );
}

function mapFollow(context: MapContext, payload: Record<string, unknown>): MapResult {
  const userId = readString(payload, 'user_id');
  if (userId === undefined) {
    return invalid('identifiant du suiveur absent');
  }

  return produced(
    {
      id: context.messageId,
      type: 'follow',
      occurredAt: context.receivedAt,
      source: 'eventsub',
      userId,
      userName: readString(payload, 'user_name') ?? userId,
    },
    'follow',
  );
}

function readChatTier(source: Record<string, unknown>): SubscriptionTier | undefined {
  const tier = readTier(source, 'sub_tier');
  if (tier === undefined) {
    return undefined;
  }
  return source['is_prime'] === true ? 'prime' : tier;
}

function mapChatNotification(context: MapContext, payload: Record<string, unknown>): MapResult {
  const noticeType = readString(payload, 'notice_type');
  if (noticeType === undefined) {
    return invalid('type de notification de chat absent');
  }

  const actor = readActor(payload, 'chatter_user_id', 'chatter_user_name');
  const base = {
    id: context.messageId,
    occurredAt: context.receivedAt,
    source: 'chat-notification',
    ...actor,
  } as const;

  switch (noticeType) {
    case 'sub': {
      const details = readRecord(payload, 'sub');
      if (details === undefined) {
        return invalid("détail d'abonnement absent");
      }
      const tier = readChatTier(details);
      if (tier === undefined) {
        return invalid(`palier d'abonnement inconnu : ${String(details['sub_tier'])}`);
      }
      return produced({ ...base, type: 'sub', tier }, 'abonnement (chat)');
    }

    case 'resub': {
      const details = readRecord(payload, 'resub');
      if (details === undefined) {
        return invalid('détail de réabonnement absent');
      }
      const tier = readChatTier(details);
      if (tier === undefined) {
        return invalid(`palier de réabonnement inconnu : ${String(details['sub_tier'])}`);
      }
      return produced(
        {
          ...base,
          type: 'resub',
          tier,
          cumulativeMonths: readNumber(details, 'cumulative_months') ?? 1,
        },
        'réabonnement (chat)',
      );
    }

    case 'community_sub_gift': {
      const details = readRecord(payload, 'community_sub_gift');
      if (details === undefined) {
        return invalid('détail de don groupé absent');
      }
      const tier = readTier(details, 'sub_tier');
      if (tier === undefined) {
        return invalid(`palier de don groupé inconnu : ${String(details['sub_tier'])}`);
      }
      const total = readNumber(details, 'total');
      if (total === undefined) {
        return invalid('total du don groupé absent');
      }
      return produced(
        { ...base, type: 'gift', tier, total, isAnonymous: payload['chatter_is_anonymous'] === true },
        'don groupé (chat)',
      );
    }

    case 'sub_gift': {
      const details = readRecord(payload, 'sub_gift');
      if (details === undefined) {
        return invalid('détail de don absent');
      }

      if (readString(details, 'community_gift_id') !== undefined) {
        return ignored("don individuel rattaché à un don groupé déjà comptabilisé");
      }

      const tier = readTier(details, 'sub_tier');
      if (tier === undefined) {
        return invalid(`palier de don inconnu : ${String(details['sub_tier'])}`);
      }
      return produced(
        { ...base, type: 'gift', tier, total: 1, isAnonymous: payload['chatter_is_anonymous'] === true },
        'don individuel (chat)',
      );
    }

    default:
      return ignored(`notification de chat « ${noticeType} » sans effet sur le compteur`);
  }
}

export function mapNotification(context: MapContext, payload: unknown): MapResult {
  if (!isRecord(payload)) {
    return invalid(`charge utile inattendue : ${typeof payload}`);
  }

  switch (context.subscriptionType) {
    case 'channel.subscribe':
      return mapChannelSubscribe(context, payload);
    case 'channel.subscription.message':
      return mapSubscriptionMessage(context, payload);
    case 'channel.subscription.gift':
      return mapSubscriptionGift(context, payload);
    case 'channel.cheer':
      return mapCheer(context, payload);
    case 'channel.raid':
      return mapRaid(context, payload);
    case 'channel.follow':
      return mapFollow(context, payload);
    case 'channel.chat.notification':
      return mapChatNotification(context, payload);
    default:
      return ignored(`type de souscription non géré : ${context.subscriptionType}`);
  }
}

export function semanticKey(event: DomainEvent): string {
  switch (event.type) {
    case 'sub':
      return `sub:${event.userId}:${event.tier === 'prime' ? 'tier1' : event.tier}`;
    case 'resub':
      return `resub:${event.userId}:${event.tier === 'prime' ? 'tier1' : event.tier}`;
    case 'gift':
      return `gift:${event.userId}:${event.tier}:${String(event.total)}`;
    case 'bits':
      return `bits:${event.userId}:${String(event.bits)}`;
    case 'raid':
      return `raid:${event.userId}:${String(event.viewers)}`;
    case 'follow':
      return `follow:${event.userId}`;
    case 'command':
      return `command:${event.id}`;
  }
}
