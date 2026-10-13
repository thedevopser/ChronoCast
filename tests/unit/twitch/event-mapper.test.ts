import { describe, expect, it } from 'vitest';

import { mapNotification, semanticKey } from '../../../src/core/twitch/event-mapper.js';
import type { DomainEvent } from '../../../src/core/events/domain-event.js';
import * as fixtures from '../../fixtures/eventsub-payloads.js';

const RECEIVED_AT = 1_754_000_000_000;

function context(subscriptionType: string) {
  return { messageId: 'msg-abc', receivedAt: RECEIVED_AT, subscriptionType };
}

function expectEvent(result: ReturnType<typeof mapNotification>): DomainEvent {
  if (result.kind !== 'event') {
    throw new Error(`événement attendu, obtenu « ${result.kind} » : ${result.reason}`);
  }
  return result.event;
}

describe('mapNotification', () => {
  describe('channel.subscribe', () => {
    it('convertit un Tier 1', () => {
      const event = expectEvent(mapNotification(context('channel.subscribe'), fixtures.channelSubscribe));

      expect(event).toMatchObject({ type: 'sub', tier: 'tier1', userId: '1234', userName: 'Cool_User' });
    });

    it('convertit un Tier 2', () => {
      const event = expectEvent(
        mapNotification(context('channel.subscribe'), fixtures.channelSubscribeTier2),
      );

      expect(event).toMatchObject({ type: 'sub', tier: 'tier2' });
    });

    it('convertit un Tier 3', () => {
      const event = expectEvent(
        mapNotification(context('channel.subscribe'), fixtures.channelSubscribeTier3),
      );

      expect(event).toMatchObject({ type: 'sub', tier: 'tier3' });
    });

    it('écarte un abonnement offert', () => {
      const result = mapNotification(context('channel.subscribe'), fixtures.channelSubscribeGifted);

      expect(result.kind).toBe('ignored');
    });

    it('reprend l\'identifiant de message comme identifiant d\'événement', () => {
      const event = expectEvent(mapNotification(context('channel.subscribe'), fixtures.channelSubscribe));

      expect(event.id).toBe('msg-abc');
    });

    it('signale la provenance EventSub', () => {
      const event = expectEvent(mapNotification(context('channel.subscribe'), fixtures.channelSubscribe));

      expect(event.source).toBe('eventsub');
    });
  });

  describe('channel.subscription.message', () => {
    it('convertit un réabonnement avec son ancienneté', () => {
      const event = expectEvent(
        mapNotification(context('channel.subscription.message'), fixtures.channelSubscriptionMessage),
      );

      expect(event).toMatchObject({ type: 'resub', tier: 'tier1', cumulativeMonths: 15 });
    });
  });

  describe('channel.subscription.gift', () => {
    it('convertit un don avec son total', () => {
      const event = expectEvent(
        mapNotification(context('channel.subscription.gift'), fixtures.channelSubscriptionGift),
      );

      expect(event).toMatchObject({ type: 'gift', tier: 'tier1', total: 2, isAnonymous: false });
    });

    it('accepte un don anonyme sans identité', () => {
      const event = expectEvent(
        mapNotification(context('channel.subscription.gift'), fixtures.channelSubscriptionGiftAnonymous),
      );

      expect(event).toMatchObject({ type: 'gift', tier: 'tier3', total: 5, isAnonymous: true });
    });

    it('attribue un nom d\'affichage de repli à un donateur anonyme', () => {
      const event = expectEvent(
        mapNotification(context('channel.subscription.gift'), fixtures.channelSubscriptionGiftAnonymous),
      );

      expect(event.userName).not.toBe('');
    });
  });

  describe('channel.bits.use', () => {
    it('convertit un cheer en don de bits', () => {
      const event = expectEvent(
        mapNotification(context('channel.bits.use'), fixtures.channelBitsUseCheer),
      );

      expect(event).toMatchObject({ type: 'bits', bits: 1000, userName: 'Cool_User', usage: 'cheer' });
    });

    it('accepte un don de bits anonyme', () => {
      const event = expectEvent(
        mapNotification(context('channel.bits.use'), fixtures.channelBitsUseAnonymous),
      );

      expect(event).toMatchObject({ type: 'bits', bits: 500 });
      expect(event.userName).not.toBe('');
    });

    it.each([
      ['un Power-up', fixtures.channelBitsUsePowerUp, 30, 'power_up'],
      ['un Power-up sans message', fixtures.channelBitsUseCelebration, 50, 'power_up'],
      ['un Power-up personnalisé', fixtures.channelBitsUseCustomPowerUp, 200, 'custom_power_up'],
    ] as const)('convertit %s en don de bits du même montant', (_case, payload, bits, usage) => {
      const result = mapNotification(context('channel.bits.use'), payload);

      expect(expectEvent(result)).toMatchObject({ type: 'bits', bits, usage, userName: 'Cool_User' });
      expect(result.kind === 'event' ? result.warning : 'absent').toBeUndefined();
    });

    it('compte pour ses bits une dépense de type inconnu, et le signale', () => {
      const result = mapNotification(context('channel.bits.use'), {
        ...(fixtures.channelBitsUseCheer as object),
        bits: 75,
        type: 'combo',
      });

      expect(expectEvent(result)).toMatchObject({ type: 'bits', bits: 75, usage: 'unknown' });
      expect(result.kind === 'event' ? result.warning : '').toContain('combo');
    });

    it('compte de même une dépense sans type', () => {
      const { type: _type, ...untyped } = fixtures.channelBitsUseCheer as Record<string, unknown>;

      expect(expectEvent(mapNotification(context('channel.bits.use'), untyped))).toMatchObject({
        bits: 1000,
        usage: 'unknown',
      });
    });

    it('ne gère plus channel.cheer, que channel.bits.use remplace : le garder compterait chaque cheer deux fois', () => {
      expect(mapNotification(context('channel.cheer'), fixtures.channelBitsUseCheer).kind).toBe(
        'ignored',
      );
    });
  });

  describe('souscriptions retirées du barème', () => {
    it.each(['channel.raid', 'channel.follow'])('ignore une notification %s', (type) => {
      const result = mapNotification(context(type), { viewers: 9001, user_id: '1234' });

      expect(result.kind).toBe('ignored');
    });
  });

  describe('channel.chat.notification', () => {
    it('distingue un abonnement Prime d\'un Tier 1', () => {
      const event = expectEvent(
        mapNotification(context('channel.chat.notification'), fixtures.chatNotificationSubPrime),
      );

      expect(event).toMatchObject({ type: 'sub', tier: 'prime' });
    });

    it('convertit un Tier 1 non Prime', () => {
      const event = expectEvent(
        mapNotification(context('channel.chat.notification'), fixtures.chatNotificationSubTier1),
      );

      expect(event).toMatchObject({ type: 'sub', tier: 'tier1' });
    });

    it('convertit un réabonnement avec son palier et son ancienneté', () => {
      const event = expectEvent(
        mapNotification(context('channel.chat.notification'), fixtures.chatNotificationResub),
      );

      expect(event).toMatchObject({ type: 'resub', tier: 'tier2', cumulativeMonths: 24 });
    });

    it('convertit un don groupé avec son total', () => {
      const event = expectEvent(
        mapNotification(context('channel.chat.notification'), fixtures.chatNotificationCommunitySubGift),
      );

      expect(event).toMatchObject({ type: 'gift', tier: 'tier1', total: 10 });
    });

    it('écarte un don individuel rattaché à un don groupé', () => {
      const result = mapNotification(
        context('channel.chat.notification'),
        fixtures.chatNotificationSubGiftInCommunity,
      );

      expect(result.kind).toBe('ignored');
    });

    it('convertit un don individuel isolé', () => {
      const event = expectEvent(
        mapNotification(context('channel.chat.notification'), fixtures.chatNotificationSubGiftStandalone),
      );

      expect(event).toMatchObject({ type: 'gift', tier: 'tier3', total: 1 });
    });

    it('signale la provenance chat pour la déduplication croisée', () => {
      const event = expectEvent(
        mapNotification(context('channel.chat.notification'), fixtures.chatNotificationSubTier1),
      );

      expect(event.source).toBe('chat-notification');
    });

    it('écarte un type de notification sans intérêt pour le compteur', () => {
      const result = mapNotification(
        context('channel.chat.notification'),
        fixtures.chatNotificationAnnouncement,
      );

      expect(result.kind).toBe('ignored');
    });
  });

  describe('robustesse', () => {
    it('écarte un type de souscription inconnu', () => {
      const result = mapNotification(context('channel.inconnu'), fixtures.channelSubscribe);

      expect(result.kind).toBe('ignored');
    });

    it('signale une charge utile qui n\'est pas un objet', () => {
      expect(mapNotification(context('channel.subscribe'), 'pas un objet').kind).toBe('invalid');
      expect(mapNotification(context('channel.subscribe'), null).kind).toBe('invalid');
    });

    it('signale un champ obligatoire manquant', () => {
      const result = mapNotification(context('channel.bits.use'), {
        user_id: '1234',
        user_name: 'Cool_User',
      });

      expect(result.kind).toBe('invalid');
    });

    it('signale un palier d\'abonnement inconnu', () => {
      const result = mapNotification(context('channel.subscribe'), {
        user_id: '1234',
        user_name: 'Cool_User',
        tier: '9000',
        is_gift: false,
      });

      expect(result.kind).toBe('invalid');
    });

    it('ne lève jamais, quelle que soit l\'entrée', () => {
      const hostiles: unknown[] = [undefined, [], 42, { nested: { deep: {} } }, Symbol('x')];

      for (const payload of hostiles) {
        expect(() => mapNotification(context('channel.subscribe'), payload)).not.toThrow();
      }
    });

    it('accompagne chaque rejet d\'un motif exploitable', () => {
      const result = mapNotification(context('channel.subscribe'), null);

      expect(result.reason).not.toBe('');
    });
  });
});

describe('semanticKey', () => {
  it('produit la même clé pour un abonnement décrit par deux sources', () => {
    const viaEventSub = expectEvent(
      mapNotification(context('channel.subscribe'), fixtures.channelSubscribe),
    );
    const viaChat = expectEvent(
      mapNotification(context('channel.chat.notification'), fixtures.chatNotificationSubTier1),
    );

    expect(semanticKey(viaChat)).toBe(semanticKey(viaEventSub));
  });

  it('distingue deux paliers différents pour le même spectateur', () => {
    const tier1 = expectEvent(mapNotification(context('channel.subscribe'), fixtures.channelSubscribe));
    const tier2 = expectEvent(
      mapNotification(context('channel.subscribe'), fixtures.channelSubscribeTier2),
    );

    expect(semanticKey(tier1)).not.toBe(semanticKey(tier2));
  });

  // Les bits n'arrivent que par une source : rien à corréler, et deux Power-ups identiques envoyés
  // coup sur coup par le même spectateur sont deux dépenses.
  it('distingue deux dépenses de bits identiques du même spectateur, portées par deux messages', () => {
    const first = expectEvent(
      mapNotification(
        { messageId: 'msg-1', receivedAt: RECEIVED_AT, subscriptionType: 'channel.bits.use' },
        fixtures.channelBitsUsePowerUp,
      ),
    );
    const second = expectEvent(
      mapNotification(
        { messageId: 'msg-2', receivedAt: RECEIVED_AT, subscriptionType: 'channel.bits.use' },
        fixtures.channelBitsUsePowerUp,
      ),
    );

    expect(semanticKey(first)).not.toBe(semanticKey(second));
  });

  it('distingue deux types d\'événements du même spectateur', () => {
    const sub = expectEvent(mapNotification(context('channel.subscribe'), fixtures.channelSubscribe));
    const cheer = expectEvent(mapNotification(context('channel.bits.use'), fixtures.channelBitsUseCheer));

    expect(semanticKey(sub)).not.toBe(semanticKey(cheer));
  });
});
