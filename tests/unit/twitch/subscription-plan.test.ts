import { describe, expect, it } from 'vitest';

import { configSchema, type TwitchConfig } from '../../../src/core/config/schema.js';
import { DEFAULT_CONFIG } from '../../../src/core/config/defaults.js';
import {
  SUBSCRIPTION_PLAN,
  requiredScopes,
  resolveSubscriptions,
} from '../../../src/core/twitch/subscription-plan.js';

/**
 * Le plan de souscriptions est déclaratif à dessein : ajouter un événement Twitch
 * doit se réduire à une entrée dans ce tableau et un cas dans le convertisseur,
 * sans toucher au client WebSocket ni au reste de l'application.
 *
 * Il porte aussi la correspondance entre souscriptions et portées OAuth. C'est
 * elle qui permet de dire à l'utilisateur « il vous manque telle autorisation »
 * plutôt que de le laisser face à un compteur qui ne bouge pas.
 */

const CONTEXT = { broadcasterUserId: '1337', userId: '1337' };

function twitchConfig(patch: unknown): TwitchConfig {
  return configSchema.parse({ twitch: patch }).twitch;
}

describe('SUBSCRIPTION_PLAN', () => {
  it('déclare une version pour chaque souscription', () => {
    // Twitch versionne ses souscriptions : omettre la version ferait échouer la
    // création avec un message peu explicite.
    for (const definition of SUBSCRIPTION_PLAN) {
      expect(definition.version).not.toBe('');
    }
  });

  it('ne déclare pas deux fois le même type', () => {
    const types = SUBSCRIPTION_PLAN.map((definition) => definition.type);

    expect(new Set(types).size).toBe(types.length);
  });

  it('couvre les événements du barème par défaut', () => {
    const types = SUBSCRIPTION_PLAN.map((definition) => definition.type);

    expect(types).toEqual(
      expect.arrayContaining([
        'channel.subscribe',
        'channel.subscription.message',
        'channel.subscription.gift',
        'channel.cheer',
        'channel.chat.notification',
        'channel.raid',
        'channel.follow',
      ]),
    );
  });

  it('utilise la version 2 pour le follow', () => {
    // La version 1 est dépréciée et n'accepte plus de nouvelles souscriptions.
    const follow = SUBSCRIPTION_PLAN.find((definition) => definition.type === 'channel.follow');

    expect(follow?.version).toBe('2');
  });
});

describe('resolveSubscriptions', () => {
  it('retient les souscriptions d\'abonnements et de bits par défaut', () => {
    const types = resolveSubscriptions(DEFAULT_CONFIG.twitch, CONTEXT).map(
      (resolved) => resolved.type,
    );

    expect(types).toEqual(
      expect.arrayContaining([
        'channel.subscribe',
        'channel.subscription.message',
        'channel.subscription.gift',
        'channel.cheer',
      ]),
    );
  });

  it('écarte raid et follow tant qu\'ils sont désactivés', () => {
    const types = resolveSubscriptions(DEFAULT_CONFIG.twitch, CONTEXT).map(
      (resolved) => resolved.type,
    );

    expect(types).not.toContain('channel.raid');
    expect(types).not.toContain('channel.follow');
  });

  it('retient le raid une fois activé', () => {
    const types = resolveSubscriptions(twitchConfig({ enableRaid: true }), CONTEXT).map(
      (resolved) => resolved.type,
    );

    expect(types).toContain('channel.raid');
  });

  it('retient le follow une fois activé', () => {
    const types = resolveSubscriptions(twitchConfig({ enableFollow: true }), CONTEXT).map(
      (resolved) => resolved.type,
    );

    expect(types).toContain('channel.follow');
  });

  it('écarte les notifications de chat lorsqu\'elles sont désactivées', () => {
    const types = resolveSubscriptions(
      twitchConfig({ enableChatNotifications: false }),
      CONTEXT,
    ).map((resolved) => resolved.type);

    expect(types).not.toContain('channel.chat.notification');
  });

  describe('conditions', () => {
    it('cible la chaîne pour un abonnement', () => {
      const resolved = resolveSubscriptions(DEFAULT_CONFIG.twitch, CONTEXT).find(
        (item) => item.type === 'channel.subscribe',
      );

      expect(resolved?.condition).toEqual({ broadcaster_user_id: '1337' });
    });

    it('ajoute l\'utilisateur lecteur pour les notifications de chat', () => {
      // Twitch exige de savoir au nom de quel compte le chat est lu.
      const resolved = resolveSubscriptions(DEFAULT_CONFIG.twitch, CONTEXT).find(
        (item) => item.type === 'channel.chat.notification',
      );

      expect(resolved?.condition).toEqual({ broadcaster_user_id: '1337', user_id: '1337' });
    });

    it('utilise la chaîne de destination pour un raid', () => {
      const resolved = resolveSubscriptions(twitchConfig({ enableRaid: true }), CONTEXT).find(
        (item) => item.type === 'channel.raid',
      );

      expect(resolved?.condition).toEqual({ to_broadcaster_user_id: '1337' });
    });

    it('ajoute le modérateur pour un follow', () => {
      const resolved = resolveSubscriptions(twitchConfig({ enableFollow: true }), CONTEXT).find(
        (item) => item.type === 'channel.follow',
      );

      expect(resolved?.condition).toEqual({
        broadcaster_user_id: '1337',
        moderator_user_id: '1337',
      });
    });
  });

  describe('criticité', () => {
    it('marque les abonnements comme indispensables', () => {
      const resolved = resolveSubscriptions(DEFAULT_CONFIG.twitch, CONTEXT).find(
        (item) => item.type === 'channel.subscribe',
      );

      expect(resolved?.required).toBe(true);
    });

    it('marque le raid comme facultatif', () => {
      // Un raid qui ne se souscrit pas ne doit pas empêcher le subathon de
      // tourner : seuls les abonnements et les bits sont vitaux.
      const resolved = resolveSubscriptions(twitchConfig({ enableRaid: true }), CONTEXT).find(
        (item) => item.type === 'channel.raid',
      );

      expect(resolved?.required).toBe(false);
    });
  });
});

describe('requiredScopes', () => {
  it('demande la lecture des abonnements et des bits par défaut', () => {
    const scopes = requiredScopes(DEFAULT_CONFIG.twitch);

    expect(scopes).toEqual(
      expect.arrayContaining(['channel:read:subscriptions', 'bits:read']),
    );
  });

  it('ajoute les portées de chat pour la détection Prime', () => {
    const scopes = requiredScopes(twitchConfig({ enableChatNotifications: true }));

    expect(scopes).toEqual(expect.arrayContaining(['user:read:chat', 'user:bot']));
  });

  it('retire les portées de chat lorsque la détection est désactivée', () => {
    const scopes = requiredScopes(twitchConfig({ enableChatNotifications: false }));

    expect(scopes).not.toContain('user:read:chat');
  });

  it('ajoute la lecture des suiveurs lorsque le follow est activé', () => {
    const scopes = requiredScopes(twitchConfig({ enableFollow: true }));

    expect(scopes).toContain('moderator:read:followers');
  });

  it('ne demande pas de portée pour le raid', () => {
    // channel.raid ne requiert aucune autorisation particulière.
    const sans = requiredScopes(DEFAULT_CONFIG.twitch);
    const avec = requiredScopes(twitchConfig({ enableRaid: true }));

    expect(avec).toEqual(sans);
  });

  it('ne renvoie jamais deux fois la même portée', () => {
    const scopes = requiredScopes(twitchConfig({ enableFollow: true, enableRaid: true }));

    expect(new Set(scopes).size).toBe(scopes.length);
  });
});
