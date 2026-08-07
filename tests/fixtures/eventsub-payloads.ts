export const channelSubscribe: unknown = {
  user_id: '1234',
  user_login: 'cool_user',
  user_name: 'Cool_User',
  broadcaster_user_id: '1337',
  broadcaster_user_login: 'cooler_user',
  broadcaster_user_name: 'Cooler_User',
  tier: '1000',
  is_gift: false,
};

export const channelSubscribeTier2: unknown = { ...(channelSubscribe as object), tier: '2000' };
export const channelSubscribeTier3: unknown = { ...(channelSubscribe as object), tier: '3000' };

export const channelSubscribeGifted: unknown = { ...(channelSubscribe as object), is_gift: true };

export const channelSubscriptionMessage: unknown = {
  user_id: '1234',
  user_login: 'cool_user',
  user_name: 'Cool_User',
  broadcaster_user_id: '1337',
  broadcaster_user_login: 'cooler_user',
  broadcaster_user_name: 'Cooler_User',
  tier: '1000',
  message: {
    text: 'Love the stream! FevziGG',
    emotes: [{ begin: 23, end: 30, id: '304456832' }],
  },
  cumulative_months: 15,
  streak_months: 1,
  duration_months: 6,
};

export const channelSubscriptionGift: unknown = {
  user_id: '1234',
  user_login: 'cool_user',
  user_name: 'Cool_User',
  broadcaster_user_id: '1337',
  broadcaster_user_login: 'cooler_user',
  broadcaster_user_name: 'Cooler_User',
  total: 2,
  tier: '1000',
  cumulative_total: 284,
  is_anonymous: false,
};

export const channelSubscriptionGiftAnonymous: unknown = {
  user_id: null,
  user_login: null,
  user_name: null,
  broadcaster_user_id: '1337',
  broadcaster_user_login: 'cooler_user',
  broadcaster_user_name: 'Cooler_User',
  total: 5,
  tier: '3000',
  cumulative_total: null,
  is_anonymous: true,
};

export const channelCheer: unknown = {
  is_anonymous: false,
  user_id: '1234',
  user_login: 'cool_user',
  user_name: 'Cool_User',
  broadcaster_user_id: '1337',
  broadcaster_user_login: 'cooler_user',
  broadcaster_user_name: 'Cooler_User',
  message: 'pogchamp',
  bits: 1000,
};

export const channelCheerAnonymous: unknown = {
  is_anonymous: true,
  user_id: null,
  user_login: null,
  user_name: null,
  broadcaster_user_id: '1337',
  broadcaster_user_login: 'cooler_user',
  broadcaster_user_name: 'Cooler_User',
  message: 'anonymous cheer',
  bits: 500,
};

export const channelRaid: unknown = {
  from_broadcaster_user_id: '1234',
  from_broadcaster_user_login: 'cool_user',
  from_broadcaster_user_name: 'Cool_User',
  to_broadcaster_user_id: '1337',
  to_broadcaster_user_login: 'cooler_user',
  to_broadcaster_user_name: 'Cooler_User',
  viewers: 9001,
};

export const channelFollow: unknown = {
  user_id: '1234',
  user_login: 'cool_user',
  user_name: 'Cool_User',
  broadcaster_user_id: '1337',
  broadcaster_user_login: 'cooler_user',
  broadcaster_user_name: 'Cooler_User',
  followed_at: '2026-08-01T18:16:11.17106713Z',
};

const chatNotificationBase = {
  broadcaster_user_id: '1337',
  broadcaster_user_login: 'cooler_user',
  broadcaster_user_name: 'Cooler_User',
  chatter_user_id: '1234',
  chatter_user_login: 'cool_user',
  chatter_user_name: 'Cool_User',
  chatter_is_anonymous: false,
  color: '#9146FF',
  badges: [],
  system_message: '',
  message_id: 'chat-msg-1',
  message: { text: '', fragments: [] },
  sub: null,
  resub: null,
  sub_gift: null,
  community_sub_gift: null,
  gift_paid_upgrade: null,
  prime_paid_upgrade: null,
  pay_it_forward: null,
  raid: null,
  unraid: null,
  announcement: null,
  bits_badge_tier: null,
  charity_donation: null,
};

export const chatNotificationSubPrime: unknown = {
  ...chatNotificationBase,
  notice_type: 'sub',
  sub: { sub_tier: '1000', is_prime: true, duration_months: 1 },
};

export const chatNotificationSubTier1: unknown = {
  ...chatNotificationBase,
  notice_type: 'sub',
  sub: { sub_tier: '1000', is_prime: false, duration_months: 1 },
};

export const chatNotificationResub: unknown = {
  ...chatNotificationBase,
  notice_type: 'resub',
  resub: {
    cumulative_months: 24,
    duration_months: 1,
    streak_months: 3,
    sub_tier: '2000',
    is_prime: false,
    is_gift: false,
    gifter_is_anonymous: null,
    gifter_user_id: null,
    gifter_user_name: null,
    gifter_user_login: null,
  },
};

export const chatNotificationCommunitySubGift: unknown = {
  ...chatNotificationBase,
  notice_type: 'community_sub_gift',
  community_sub_gift: {
    id: 'community-gift-1',
    total: 10,
    sub_tier: '1000',
    cumulative_total: 100,
  },
};

export const chatNotificationSubGiftInCommunity: unknown = {
  ...chatNotificationBase,
  notice_type: 'sub_gift',
  sub_gift: {
    duration_months: 1,
    cumulative_total: 100,
    recipient_user_id: '5678',
    recipient_user_name: 'Lucky_User',
    recipient_user_login: 'lucky_user',
    sub_tier: '1000',
    community_gift_id: 'community-gift-1',
  },
};

export const chatNotificationSubGiftStandalone: unknown = {
  ...chatNotificationBase,
  notice_type: 'sub_gift',
  sub_gift: {
    duration_months: 1,
    cumulative_total: 42,
    recipient_user_id: '5678',
    recipient_user_name: 'Lucky_User',
    recipient_user_login: 'lucky_user',
    sub_tier: '3000',
    community_gift_id: null,
  },
};

export const chatNotificationAnnouncement: unknown = {
  ...chatNotificationBase,
  notice_type: 'announcement',
  announcement: { color: 'PRIMARY' },
};

function chatMessage(text: string, badges: unknown[]): unknown {
  return {
    broadcaster_user_id: '1337',
    broadcaster_user_login: 'cooler_user',
    broadcaster_user_name: 'Cooler_User',
    chatter_user_id: '4321',
    chatter_user_login: 'modo_utile',
    chatter_user_name: 'Modo_Utile',
    message_id: 'b1f4c9de-0000-4000-8000-000000000000',
    message: { text },
    badges,
  };
}

const MODERATOR_BADGES: unknown[] = [{ set_id: 'moderator', id: '1', info: '' }];

export const chatMessageModeratorAddTime: unknown = chatMessage('!addtime 300', MODERATOR_BADGES);

export const chatMessageViewerAddTime: unknown = chatMessage('!addtime 300', []);

export const chatMessageSmallTalk: unknown = chatMessage('bonne chance !', MODERATOR_BADGES);

export const chatMessageModeratorTooMuch: unknown = chatMessage(
  '!addtime 99999',
  MODERATOR_BADGES,
);

export const chatMessageModeratorNotANumber: unknown = chatMessage(
  '!addtime beaucoup',
  MODERATOR_BADGES,
);
