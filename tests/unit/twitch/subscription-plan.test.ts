import { describe, expect, it } from 'vitest';

import { configSchema, type TwitchConfig } from '../../../src/core/config/schema.js';
import { DEFAULT_CONFIG } from '../../../src/core/config/defaults.js';
import {
  SUBSCRIPTION_PLAN,
  requiredScopes,
  resolveSubscriptions,
} from '../../../src/core/twitch/subscription-plan.js';

const CONTEXT = { broadcasterUserId: '1337', userId: '1337' };

function twitchConfig(patch: unknown): TwitchConfig {
  return configSchema.parse({ twitch: patch }).twitch;
}

describe('SUBSCRIPTION_PLAN', () => {
  it('déclare une version pour chaque souscription', () => {
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
        'channel.chat.message',
      ]),
    );
  });

  it('utilise la version 2 pour le follow', () => {
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

  it('écarte la lecture du chat tant que les commandes sont désactivées', () => {
    const types = resolveSubscriptions(DEFAULT_CONFIG.twitch, CONTEXT).map(
      (resolved) => resolved.type,
    );

    expect(types).not.toContain('channel.chat.message');
  });

  it('retient la lecture du chat une fois les commandes activées', () => {
    const types = resolveSubscriptions(twitchConfig({ enableChatCommands: true }), CONTEXT).map(
      (resolved) => resolved.type,
    );

    expect(types).toContain('channel.chat.message');
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
      const resolved = resolveSubscriptions(DEFAULT_CONFIG.twitch, CONTEXT).find(
        (item) => item.type === 'channel.chat.notification',
      );

      expect(resolved?.condition).toEqual({ broadcaster_user_id: '1337', user_id: '1337' });
    });

    it('ajoute l\'utilisateur lecteur pour les messages de chat', () => {
      const resolved = resolveSubscriptions(twitchConfig({ enableChatCommands: true }), CONTEXT).find(
        (item) => item.type === 'channel.chat.message',
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

    it('marque la lecture du chat comme facultative', () => {
      const resolved = resolveSubscriptions(twitchConfig({ enableChatCommands: true }), CONTEXT).find(
        (item) => item.type === 'channel.chat.message',
      );

      expect(resolved?.required).toBe(false);
    });

    it('marque le raid comme facultatif', () => {
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

  it('ajoute les portées de chat lorsque seules les commandes sont activées', () => {
    const scopes = requiredScopes(
      twitchConfig({ enableChatNotifications: false, enableChatCommands: true }),
    );

    expect(scopes).toEqual(expect.arrayContaining(['user:read:chat', 'user:bot']));
  });

  it('ne demande aucune portée supplémentaire pour les commandes', () => {
    const sans = requiredScopes(DEFAULT_CONFIG.twitch);
    const avec = requiredScopes(twitchConfig({ enableChatCommands: true }));

    expect(new Set(avec)).toEqual(new Set(sans));
  });

  it('ajoute la lecture des suiveurs lorsque le follow est activé', () => {
    const scopes = requiredScopes(twitchConfig({ enableFollow: true }));

    expect(scopes).toContain('moderator:read:followers');
  });

  it('ne demande pas de portée pour le raid', () => {
    const sans = requiredScopes(DEFAULT_CONFIG.twitch);
    const avec = requiredScopes(twitchConfig({ enableRaid: true }));

    expect(avec).toEqual(sans);
  });

  it('ne renvoie jamais deux fois la même portée', () => {
    const scopes = requiredScopes(twitchConfig({ enableFollow: true, enableRaid: true }));

    expect(new Set(scopes).size).toBe(scopes.length);
  });
});
