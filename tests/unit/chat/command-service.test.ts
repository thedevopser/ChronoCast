import { describe, expect, it } from 'vitest';

import { evaluateChatMessage } from '../../../src/core/chat/command-service.js';
import { configSchema, type ChronoCastConfig } from '../../../src/core/config/schema.js';

const CONTEXT = { messageId: 'msg-1', receivedAt: 1_754_000_000_000 } as const;

const SELF_USER_ID = '1337';

function configWith(patch: unknown = {}): ChronoCastConfig {
  return configSchema.parse({
    twitch: { enableChatCommands: true },
    ...(patch as Record<string, unknown>),
  });
}

function payload(options: {
  text: string;
  badges?: unknown;
  userId?: string;
  userName?: string;
}): unknown {
  return {
    broadcaster_user_id: '1337',
    chatter_user_id: options.userId ?? '999',
    chatter_user_name: options.userName ?? 'ModoUtile',
    badges: options.badges ?? [{ set_id: 'moderator', id: '1', info: '' }],
    message: { text: options.text },
  };
}

function evaluate(payloadValue: unknown, config: ChronoCastConfig = configWith()) {
  return evaluateChatMessage(CONTEXT, payloadValue, config);
}

describe('evaluateChatMessage', () => {
  describe('cas nominal', () => {
    it('produit un événement portant les secondes tapées', () => {
      const outcome = evaluate(payload({ text: '!addtime 300' }));

      expect(outcome.kind).toBe('event');
      if (outcome.kind !== 'event') {
        return;
      }
      expect(outcome.event).toStrictEqual({
        id: 'msg-1',
        type: 'command',
        command: 'addtime',
        seconds: 300,
        occurredAt: CONTEXT.receivedAt,
        userId: '999',
        userName: 'ModoUtile',
        source: 'chat-command',
      });
    });

    it('accepte le diffuseur', () => {
      const outcome = evaluate(
        payload({ text: '!addtime 60', badges: [{ set_id: 'broadcaster', id: '1', info: '' }] }),
      );

      expect(outcome.kind).toBe('event');
    });

    it('accepte le diffuseur depuis le compte même qui lit le chat', () => {
      const outcome = evaluate(
        payload({
          text: '!addtime 60',
          userId: SELF_USER_ID,
          badges: [{ set_id: 'broadcaster', id: '1', info: '' }],
        }),
      );

      expect(outcome.kind).toBe('event');
    });

    it('suit le nom de commande configuré', () => {
      const config = configWith({ rewards: { chatCommand: { name: 'temps' } } });

      expect(evaluate(payload({ text: '!temps 60' }), config).kind).toBe('event');
      expect(evaluate(payload({ text: '!addtime 60' }), config).kind).toBe('ignored');
    });

    it('reprend le message_id comme identifiant', () => {
      const outcome = evaluate(payload({ text: '!addtime 60' }));

      expect(outcome.kind === 'event' && outcome.event.id).toBe('msg-1');
    });
  });

  describe('refus', () => {
    it('se tait quand les commandes sont désactivées', () => {
      const config = configSchema.parse({ twitch: { enableChatCommands: false } });

      expect(evaluate(payload({ text: '!addtime 300' }), config).kind).toBe('ignored');
    });

    it('ignore un message ordinaire', () => {
      expect(evaluate(payload({ text: 'salut la compagnie' })).kind).toBe('ignored');
      expect(evaluate(payload({ text: 'addtime 300' })).kind).toBe('ignored');
    });

    it('ignore une commande inconnue', () => {
      expect(evaluate(payload({ text: '!addmort 300' })).kind).toBe('ignored');
    });

    it('refuse un spectateur ordinaire', () => {
      expect(evaluate(payload({ text: '!addtime 300', badges: [] })).kind).toBe('ignored');
      expect(
        evaluate(payload({ text: '!addtime 300', badges: [{ set_id: 'vip', id: '1', info: '' }] }))
          .kind,
      ).toBe('ignored');
    });

    it('refuse une commande sans valeur', () => {
      expect(evaluate(payload({ text: '!addtime' })).kind).toBe('ignored');
    });

    it('refuse une valeur qui n’est pas un entier', () => {
      for (const argument of ['abc', '30s', '5m', '2.5', '1e3', '0x10', '+', '３００']) {
        expect(evaluate(payload({ text: `!addtime ${argument}` })).kind, argument).toBe('ignored');
      }
    });

    it('refuse zéro et les valeurs négatives', () => {
      expect(evaluate(payload({ text: '!addtime 0' })).kind).toBe('ignored');
      expect(evaluate(payload({ text: '!addtime -60' })).kind).toBe('ignored');
    });

    it('refuse au-delà du plafond plutôt que d’écrêter', () => {
      const config = configWith({ rewards: { chatCommand: { maxSeconds: 600 } } });

      expect(evaluate(payload({ text: '!addtime 601' }), config).kind).toBe('ignored');
      expect(evaluate(payload({ text: '!addtime 600' }), config).kind).toBe('event');
    });

    it('énonce toujours une raison', () => {
      const outcome = evaluate(payload({ text: '!addtime 300', badges: [] }));

      expect(outcome.kind === 'ignored' && outcome.reason.length).toBeGreaterThan(0);
    });
  });

  describe('charge utile hostile', () => {
    it('ne lève jamais', () => {
      for (const hostile of [null, undefined, 42, 'texte', [], {}, { message: 'texte' }]) {
        expect(() => evaluate(hostile)).not.toThrow();
        expect(evaluate(hostile).kind).toBe('ignored');
      }
    });

    it('borne le pseudo, choisi par un tiers non fiable', () => {
      const outcome = evaluate(payload({ text: '!addtime 60', userName: 'x'.repeat(500) }));

      expect(outcome.kind === 'event' && outcome.event.userName.length).toBeLessThanOrEqual(100);
    });

    it('se rabat sur l’identifiant quand le pseudo manque', () => {
      const outcome = evaluate({
        chatter_user_id: '999',
        badges: [{ set_id: 'moderator', id: '1', info: '' }],
        message: { text: '!addtime 60' },
      });

      expect(outcome.kind === 'event' && outcome.event.userName).toBe('999');
    });

    it('refuse un message sans auteur identifiable', () => {
      const outcome = evaluate({
        badges: [{ set_id: 'moderator', id: '1', info: '' }],
        message: { text: '!addtime 60' },
      });

      expect(outcome.kind).toBe('ignored');
    });
  });
});
