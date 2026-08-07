import { describe, expect, it } from 'vitest';

import { evaluateChatMessage } from '../../../src/core/chat/command-service.js';
import { configSchema, type ChronoCastConfig } from '../../../src/core/config/schema.js';

/**
 * Le service est le seul module de la chaîne qui décide. Il résout la commande
 * dans la configuration, vérifie l'habilitation, convertit l'argument et
 * applique le plafond.
 *
 * **Le filtrage est précoce, et c'est une décision anti-abus.** Message sans
 * préfixe, commande inconnue, auteur non habilité, valeur hors bornes : tout
 * est écarté ici, avant que quoi que ce soit n'entre dans l'historique ou ne
 * parte sur le WebSocket. Sans cela, un spectateur martelant `!addtime`
 * remplirait l'historique du streamer une ligne à la fois.
 *
 * Aucun de ces refus n'est une erreur : ils se journalisent en `debug` et ne
 * disent rien à personne. `channel.chat.message` livre **chaque** message de la
 * chaîne, et la quasi-totalité n'a rien à voir avec ChronoCast.
 */

const CONTEXT = { messageId: 'msg-1', receivedAt: 1_754_000_000_000 } as const;

/**
 * Identité du compte authentifié qui lit le chat.
 *
 * Dans le cas courant, **c'est celui du streamer lui-même**. Le service ne
 * l'écarte donc pas : voir le cas nominal correspondant.
 */
const SELF_USER_ID = '1337';

function configWith(patch: unknown = {}): ChronoCastConfig {
  return configSchema.parse({
    twitch: { enableChatCommands: true },
    ...(patch as Record<string, unknown>),
  });
}

/** Charge utile `channel.chat.message`, réduite à ce que le service lit. */
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
      // **Le cas courant, et celui qu'une garde mal placée casserait.** Le
      // compte authentifié est celui du streamer : écarter ses propres
      // messages reviendrait à lui refuser sa propre commande, sur sa propre
      // chaîne. ChronoCast n'écrivant jamais dans le chat, il ne peut de toute
      // façon produire aucun message susceptible de le redéclencher.
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
      // C'est la clé de déduplication des retransmissions de Twitch : la
      // reprendre ici est ce qui empêche un même message d'être crédité deux
      // fois lorsque Twitch le rejoue.
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
      // Le refus le plus important du module : sans lui, n'importe qui
      // prolongerait le subathon à volonté.
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
      // « valeur numérique uniquement » : ni décimale, ni notation
      // scientifique, ni hexadécimal, ni suffixe.
      for (const argument of ['abc', '30s', '5m', '2.5', '1e3', '0x10', '+', '３００']) {
        expect(evaluate(payload({ text: `!addtime ${argument}` })).kind, argument).toBe('ignored');
      }
    });

    it('refuse zéro et les valeurs négatives', () => {
      // Le périmètre est l'ajout seul. `applyAdd` ignorerait de toute façon un
      // delta négatif ou nul **sans rien signaler**, ce qui ferait un
      // historique menteur.
      expect(evaluate(payload({ text: '!addtime 0' })).kind).toBe('ignored');
      expect(evaluate(payload({ text: '!addtime -60' })).kind).toBe('ignored');
    });

    it('refuse au-delà du plafond plutôt que d’écrêter', () => {
      // Une valeur hors bornes est une faute de frappe bien plus souvent qu'une
      // intention : créditer une heure à qui en voulait dix obligerait à
      // corriger le compteur à la main, en direct.
      const config = configWith({ rewards: { chatCommand: { maxSeconds: 600 } } });

      expect(evaluate(payload({ text: '!addtime 601' }), config).kind).toBe('ignored');
      expect(evaluate(payload({ text: '!addtime 600' }), config).kind).toBe('event');
    });

    it('énonce toujours une raison', () => {
      // La raison part dans les journaux en `debug` : c'est le seul moyen pour
      // le streamer de comprendre pourquoi sa commande n'a rien fait.
      const outcome = evaluate(payload({ text: '!addtime 300', badges: [] }));

      expect(outcome.kind === 'ignored' && outcome.reason.length).toBeGreaterThan(0);
    });
  });

  describe('charge utile hostile', () => {
    it('ne lève jamais', () => {
      // Une exception ici abattrait le traitement de la notification, et donc
      // le pipeline qui porte tout le subathon.
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
