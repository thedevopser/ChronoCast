import { describe, expect, it } from 'vitest';

import { mapNotification, semanticKey } from '../../../src/core/twitch/event-mapper.js';
import type { DomainEvent } from '../../../src/core/events/domain-event.js';
import * as fixtures from '../../fixtures/eventsub-payloads.js';

/**
 * Le convertisseur est la frontière entre le protocole Twitch et le métier. Il
 * absorbe toutes les bizarreries du premier pour que le second n'ait à connaître
 * qu'un vocabulaire propre.
 *
 * Deux de ces bizarreries sont des pièges à double comptage, et ce sont elles
 * qui justifient l'essentiel des tests qui suivent :
 *
 *   - un don d'abonnements produit à la fois un `channel.subscription.gift` pour
 *     le donateur et un `channel.subscribe` par bénéficiaire ;
 *   - un don groupé produit un `community_sub_gift` porteur du total, suivi d'un
 *     `sub_gift` par bénéficiaire.
 *
 * Le convertisseur ne lève jamais. Une charge utile inattendue est signalée,
 * jamais propagée en exception : une notification mal formée ne doit pas
 * interrompre la connexion EventSub.
 */

const RECEIVED_AT = 1_754_000_000_000;

function context(subscriptionType: string) {
  return { messageId: 'msg-abc', receivedAt: RECEIVED_AT, subscriptionType };
}

/** Extrait l'événement produit, ou fait échouer le test avec un message utile. */
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
      // Sinon chaque bénéficiaire serait compté en plus du don lui-même.
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

  describe('channel.cheer', () => {
    it('convertit un don de bits', () => {
      const event = expectEvent(mapNotification(context('channel.cheer'), fixtures.channelCheer));

      expect(event).toMatchObject({ type: 'bits', bits: 1000, userName: 'Cool_User' });
    });

    it('accepte un don de bits anonyme', () => {
      const event = expectEvent(mapNotification(context('channel.cheer'), fixtures.channelCheerAnonymous));

      expect(event).toMatchObject({ type: 'bits', bits: 500 });
      expect(event.userName).not.toBe('');
    });
  });

  describe('channel.raid et channel.follow', () => {
    it('convertit un raid en retenant le raideur', () => {
      const event = expectEvent(mapNotification(context('channel.raid'), fixtures.channelRaid));

      expect(event).toMatchObject({ type: 'raid', viewers: 9001, userId: '1234' });
    });

    it('convertit un follow', () => {
      const event = expectEvent(mapNotification(context('channel.follow'), fixtures.channelFollow));

      expect(event).toMatchObject({ type: 'follow', userId: '1234' });
    });
  });

  describe('channel.chat.notification', () => {
    it('distingue un abonnement Prime d\'un Tier 1', () => {
      // Raison d'être de ce flux : c'est le seul endroit du protocole où
      // l'indicateur Prime existe.
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
      // Il a déjà été comptabilisé dans le total du don groupé.
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
      const result = mapNotification(context('channel.cheer'), {
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
    // C'est ce qui permet d'écarter le doublon entre channel.subscribe et
    // channel.chat.notification, qui portent des identifiants de message
    // différents mais décrivent le même abonnement.
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

  it('distingue deux dons de bits de montants différents', () => {
    const petit = expectEvent(mapNotification(context('channel.cheer'), fixtures.channelCheerAnonymous));
    const grand = expectEvent(mapNotification(context('channel.cheer'), fixtures.channelCheer));

    expect(semanticKey(petit)).not.toBe(semanticKey(grand));
  });

  it('distingue deux types d\'événements du même spectateur', () => {
    const sub = expectEvent(mapNotification(context('channel.subscribe'), fixtures.channelSubscribe));
    const follow = expectEvent(mapNotification(context('channel.follow'), fixtures.channelFollow));

    expect(semanticKey(sub)).not.toBe(semanticKey(follow));
  });
});
