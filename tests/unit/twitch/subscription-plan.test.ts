import { describe, expect, it } from 'vitest';

import { configSchema, type TwitchConfig } from '../../../src/core/config/schema.js';
import { DEFAULT_CONFIG } from '../../../src/core/config/defaults.js';
import {
  SUBSCRIPTION_PLAN,
  requiredScopes,
  requiresRestart,
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

    expect(types.toSorted()).toEqual([
      'channel.chat.message',
      'channel.chat.notification',
      'channel.cheer',
      'channel.subscribe',
      'channel.subscription.gift',
      'channel.subscription.message',
    ]);
  });

  it('ne souscrit à rien qui ne soit pas un don', () => {
    const types = SUBSCRIPTION_PLAN.map((definition) => definition.type);

    expect(types).not.toContain('channel.raid');
    expect(types).not.toContain('channel.follow');
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

    it('marque les notifications de chat comme facultatives', () => {
      const resolved = resolveSubscriptions(DEFAULT_CONFIG.twitch, CONTEXT).find(
        (item) => item.type === 'channel.chat.notification',
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

  it('ne demande plus la lecture des suiveurs', () => {
    const scopes = requiredScopes(
      twitchConfig({ enableChatNotifications: true, enableChatCommands: true }),
    );

    expect(scopes).not.toContain('moderator:read:followers');
  });

  it('ne renvoie jamais deux fois la même portée', () => {
    const scopes = requiredScopes(
      twitchConfig({ enableChatNotifications: true, enableChatCommands: true }),
    );

    expect(new Set(scopes).size).toBe(scopes.length);
  });
});

describe('requiresRestart', () => {
  it('ne demande rien quand la configuration est identique', () => {
    const config = twitchConfig({ broadcasterUserId: '1337' });

    expect(requiresRestart(config, config)).toBe(false);
  });

  it('demande un redémarrage quand une souscription est activée', () => {
    const previous = twitchConfig({ broadcasterUserId: '1337', enableChatCommands: false });
    const next = twitchConfig({ broadcasterUserId: '1337', enableChatCommands: true });

    expect(requiresRestart(previous, next)).toBe(true);
  });

  it('demande un redémarrage quand une souscription est désactivée', () => {
    const previous = twitchConfig({ broadcasterUserId: '1337', enableChatNotifications: true });
    const next = twitchConfig({ broadcasterUserId: '1337', enableChatNotifications: false });

    expect(requiresRestart(previous, next)).toBe(true);
  });

  it('demande un redémarrage quand le diffuseur change', () => {
    const previous = twitchConfig({ broadcasterUserId: '1337' });
    const next = twitchConfig({ broadcasterUserId: '42' });

    expect(requiresRestart(previous, next)).toBe(true);
  });

  it('demande un redémarrage quand l’URL EventSub change', () => {
    const previous = twitchConfig({ broadcasterUserId: '1337' });
    const next = twitchConfig({ broadcasterUserId: '1337', eventsubUrl: 'wss://127.0.0.1:8080/ws' });

    expect(requiresRestart(previous, next)).toBe(true);
  });

  it('ne demande rien pour un réglage sans effet sur les souscriptions', () => {
    const previous = twitchConfig({ broadcasterUserId: '1337', broadcasterLogin: 'ancien' });
    const next = twitchConfig({ broadcasterUserId: '1337', broadcasterLogin: 'nouveau' });

    expect(requiresRestart(previous, next)).toBe(false);
  });
});
