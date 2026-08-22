import { beforeEach, describe, expect, it } from 'vitest';

import type { AppEvents } from '../../../src/core/app/app-events.js';
import { createEventBus, type EventBus } from '../../../src/core/app/event-bus.js';
import { DEFAULT_CONFIG } from '../../../src/core/config/defaults.js';
import { configSchema, type ChronoCastConfig } from '../../../src/core/config/schema.js';
import { createInitialState, type CounterState } from '../../../src/core/counter/counter-state.js';
import { positionAt } from '../../../src/core/goals/goal-ladder.js';
import type { GoalSnapshot } from '../../../src/core/goals/goal-service.js';
import { createLogger, type LogSink } from '../../../src/core/logging/logger.js';
import { PROTOCOL_VERSION } from '../../../src/core/server/protocol.js';
import { createWsHub, type HubTimers, type WsHub } from '../../../src/core/server/ws-hub.js';
import { createSocketDouble, type SocketDouble } from '../../helpers/hub-socket.js';

const SILENT_SINK: LogSink = { name: 'silencieux', write: () => undefined };

const LADDER = [
  { target: 5, label: 'Je me rase la tête' },
  { target: 10, label: 'Karaoké' },
] as const;

function createTimersDouble() {
  const intervals = new Map<number, { handler: () => void; ms: number }>();
  let nextId = 1;

  const timers: HubTimers = {
    setInterval(handler: () => void, ms: number): number {
      const id = nextId;
      nextId += 1;
      intervals.set(id, { handler, ms });
      return id;
    },
    clearInterval(id: number): void {
      intervals.delete(id);
    },
  };

  return {
    timers,
    fire(): void {
      for (const entry of [...intervals.values()]) {
        entry.handler();
      }
    },
    count(): number {
      return intervals.size;
    },
  };
}

describe('createWsHub', () => {
  let bus: EventBus<AppEvents>;
  let hub: WsHub;
  let timers: ReturnType<typeof createTimersDouble>;
  let config: ChronoCastConfig;
  let counter: CounterState;
  let goal: GoalSnapshot;
  let monotonic: number;
  let client: SocketDouble;

  function messagesOfType(socket: SocketDouble, type: string): Record<string, unknown>[] {
    return socket.sent.filter((message) => message['type'] === type);
  }

  beforeEach(() => {
    bus = createEventBus<AppEvents>();
    timers = createTimersDouble();
    config = DEFAULT_CONFIG;
    counter = createInitialState({ initialMs: 43_200_000, now: 1_000 });
    goal = {
      subs: 7,
      reached: [{ target: 5, reachedAt: 1_000 }],
      position: positionAt(7, LADDER),
      tiers: LADDER,
    };
    monotonic = 0;

    hub = createWsHub({
      bus,
      getConfig: () => config,
      getSnapshot: () => ({ counter, twitch: { status: 'ready' }, goal }),
      clock: { now: () => 1_000, monotonicMs: () => monotonic },
      timers: timers.timers,
      getPort: () => 3_777,
      getWsPort: () => 3_777,
      appVersion: '0.1.0',
      logger: createLogger({ level: 'error', sinks: [SILENT_SINK] }),
    });

    hub.start();
    client = createSocketDouble();
  });

  describe('accueil', () => {
    it('envoie hello puis state à la connexion', () => {
      hub.accept(client.socket, {});

      expect(client.sent[0]).toMatchObject({
        type: 'hello',
        protocolVersion: PROTOCOL_VERSION,
        appVersion: '0.1.0',
        port: 3_777,
        wsPort: 3_777,
      });
      expect(client.sent[1]).toMatchObject({ type: 'state' });
    });

    it('envoie la progression des objectifs à la connexion, sans attendre le prochain sub', () => {
      hub.accept(client.socket, {});

      const message = messagesOfType(client, 'goal')[0];

      expect(message).toMatchObject({ type: 'goal', subs: 7, label: 'Karaoké' });
      expect(message?.['crossed']).toEqual([]);
    });

    it('joint les portées manquantes à l’état', () => {
      const incomplet = createWsHub({
        bus,
        getConfig: () => config,
        getSnapshot: () => ({
          counter,
          twitch: { status: 'ready', missingScopes: ['user:read:chat', 'user:bot'] },
          goal,
        }),
        clock: { now: () => 1_000, monotonicMs: () => monotonic },
        timers: timers.timers,
        getPort: () => 3_777,
        getWsPort: () => 3_777,
        appVersion: '0.1.0',
        logger: createLogger({ level: 'error', sinks: [SILENT_SINK] }),
      });
      incomplet.start();

      const other = createSocketDouble();
      incomplet.accept(other.socket, {});

      expect(other.sent[1]).toMatchObject({
        type: 'state',
        twitch: { missingScopes: ['user:read:chat', 'user:bot'] },
      });

      incomplet.stop();
    });

    it('annonce le port du WebSocket quand il diffère de celui du HTTP', () => {
      const separate = createWsHub({
        bus,
        getConfig: () => config,
        getSnapshot: () => ({ counter, twitch: { status: 'ready' }, goal }),
        clock: { now: () => 1_000, monotonicMs: () => monotonic },
        timers: timers.timers,
        getPort: () => 3_777,
        getWsPort: () => 3_778,
        appVersion: '0.1.0',
        logger: createLogger({ level: 'error', sinks: [SILENT_SINK] }),
      });
      separate.start();

      const other = createSocketDouble();
      separate.accept(other.socket, {});

      expect(other.sent[0]).toMatchObject({ type: 'hello', port: 3_777, wsPort: 3_778 });

      separate.stop();
    });

    it("transmet la configuration d'overlay dès l'accueil", () => {
      hub.accept(client.socket, {});

      expect(client.sent[0]?.['overlay']).toEqual(DEFAULT_CONFIG.overlay);
    });

    it("transmet l'apparence de la page Objectifs dès l'accueil", () => {
      hub.accept(client.socket, {});

      expect(client.sent[0]?.['goalOverlay']).toEqual(DEFAULT_CONFIG.goals.overlay);
    });

    it("n'envoie du sous-arbre des objectifs que son apparence", () => {
      config = configSchema.parse({
        goals: { bitsPerSub: 250, tiers: [{ target: 50, label: 'Je me rase la tête' }] },
      });

      hub.accept(client.socket, {});

      const serialized = JSON.stringify(client.sent[0]);
      expect(serialized).not.toContain('bitsPerSub');
      expect(serialized).not.toContain('Je me rase la tête');
    });

    it("annonce l'état du Happy Hour dès l'accueil", () => {
      config = configSchema.parse({ rewards: { happyHour: true } });

      hub.accept(client.socket, {});

      expect(client.sent[0]).toMatchObject({ type: 'hello', happyHour: true });
    });

    it("ne divulgue jamais de secret dans l'accueil", () => {
      hub.accept(client.socket, {});

      const serialized = JSON.stringify(client.sent);
      expect(serialized).not.toContain('clientSecret');
      expect(serialized).not.toContain('accessToken');
    });

    it('compte les clients connectés', () => {
      expect(hub.clientCount()).toBe(0);
      hub.accept(client.socket, {});
      expect(hub.clientCount()).toBe(1);
    });

    it('oublie un client qui se déconnecte', () => {
      hub.accept(client.socket, {});
      client.disconnect();

      expect(hub.clientCount()).toBe(0);
    });

    it.each(['https://evil.com', 'http://evil.com:3777'])('refuse l’origine %s', (origin) => {
      hub.accept(client.socket, { origin });

      expect(client.closed).toBe(true);
      expect(hub.clientCount()).toBe(0);
    });

    it("accepte l'absence d'origine, cas d'OBS", () => {
      hub.accept(client.socket, {});

      expect(client.closed).toBe(false);
      expect(hub.clientCount()).toBe(1);
    });
  });

  describe('diffusion', () => {
    beforeEach(() => {
      hub.accept(client.socket, {});
    });

    it('diffuse immédiatement une mutation du compteur', () => {
      bus.emit('counter:changed', {
        state: counter,
        origin: 'twitch',
        deltaMs: 180_000,
        reason: 'sub tier1',
      });

      expect(messagesOfType(client, 'counter')).toHaveLength(1);
    });

    it('lisse le décompte à une diffusion par seconde', () => {
      for (let index = 0; index < 4; index += 1) {
        monotonic += 250;
        bus.emit('counter:changed', {
          state: counter,
          origin: 'tick',
          deltaMs: -250,
          reason: 'décompte',
        });
      }

      expect(messagesOfType(client, 'counter')).toHaveLength(1);

      monotonic += 1_000;
      bus.emit('counter:changed', {
        state: counter,
        origin: 'tick',
        deltaMs: -250,
        reason: 'décompte',
      });

      expect(messagesOfType(client, 'counter')).toHaveLength(2);
    });

    it("ne laisse pas le lissage retarder une mutation", () => {
      monotonic += 100;
      bus.emit('counter:changed', {
        state: counter,
        origin: 'tick',
        deltaMs: -100,
        reason: 'décompte',
      });

      monotonic += 10;
      bus.emit('counter:changed', {
        state: counter,
        origin: 'twitch',
        deltaMs: 180_000,
        reason: 'sub tier1',
      });

      expect(messagesOfType(client, 'counter')).toHaveLength(2);
    });

    it('diffuse le changement de statut Twitch', () => {
      bus.emit('twitch:status', { status: 'reconnecting', detail: 'session perdue' });

      expect(messagesOfType(client, 'twitch:status')[0]).toMatchObject({
        status: 'reconnecting',
        detail: 'session perdue',
      });
    });

    it('diffuse un événement crédité', () => {
      bus.emit('counter:event-applied', {
        event: {
          id: 'evt-1',
          type: 'sub',
          tier: 'tier1',
          occurredAt: 1_000,
          userId: '42',
          userName: 'Viewer',
          source: 'eventsub',
        },
        reward: { seconds: 180, applied: true, reason: 'sub tier1' },
        state: counter,
      });

      expect(messagesOfType(client, 'event')[0]).toMatchObject({
        rewardSeconds: 180,
        applied: true,
      });
    });

    it('n’attache aucun libellé à un événement de plateforme', () => {
      bus.emit('counter:event-applied', {
        event: {
          id: 'evt-1',
          type: 'sub',
          tier: 'tier1',
          occurredAt: 1_000,
          userId: '42',
          userName: 'Viewer',
          source: 'eventsub',
        },
        reward: { seconds: 180, applied: true, reason: 'sub tier1' },
        state: counter,
      });

      expect(messagesOfType(client, 'event')[0]).not.toHaveProperty('label');
    });

    it('attache le libellé configuré à une commande de chat', () => {
      bus.emit('counter:event-applied', {
        event: {
          id: 'evt-cmd',
          type: 'command',
          command: 'addtime',
          seconds: 300,
          occurredAt: 1_000,
          userId: '42',
          userName: 'ModoUtile',
          source: 'chat-command',
        },
        reward: { seconds: 300, applied: true, reason: 'commande !addtime' },
        state: counter,
      });

      expect(messagesOfType(client, 'event')[0]).toMatchObject({
        rewardSeconds: 300,
        label: 'Temps ajouté',
      });
    });

    it('omet le libellé lorsqu’il a été vidé', () => {
      config = configSchema.parse({ rewards: { chatCommand: { overlayText: '' } } });

      bus.emit('counter:event-applied', {
        event: {
          id: 'evt-cmd',
          type: 'command',
          command: 'addtime',
          seconds: 300,
          occurredAt: 1_000,
          userId: '42',
          userName: 'ModoUtile',
          source: 'chat-command',
        },
        reward: { seconds: 300, applied: true, reason: 'commande !addtime' },
        state: counter,
      });

      expect(messagesOfType(client, 'event')[0]).not.toHaveProperty('label');
    });

    it('diffuse une ligne de journal', () => {
      hub.publishLog({
        timestamp: '2026-08-01T10:00:00.000Z',
        level: 'warning',
        scope: 'twitch',
        message: 'reconnexion',
      });

      expect(messagesOfType(client, 'log')).toHaveLength(1);
    });

    it("diffuse la nouvelle configuration d'overlay", () => {
      hub.publishConfig();

      expect(messagesOfType(client, 'config')[0]?.['overlay']).toEqual(DEFAULT_CONFIG.overlay);
    });

    it("diffuse la nouvelle apparence de la page Objectifs : OBS ne recharge pas une page tout seul", () => {
      config = configSchema.parse({ goals: { overlay: { fontSize: 64 } } });

      hub.publishConfig();

      expect(messagesOfType(client, 'config')[0]?.['goalOverlay']).toMatchObject({ fontSize: 64 });
    });

    it('diffuse la bascule du Happy Hour, qui tient les onglets ouverts d’accord', () => {
      config = configSchema.parse({ rewards: { happyHour: true } });

      hub.publishConfig();

      expect(messagesOfType(client, 'config')[0]?.['happyHour']).toBe(true);
    });

    it('diffuse la progression des objectifs', () => {
      bus.emit('goals:changed', {
        snapshot: goal,
        crossed: [{ target: 5, label: 'Je me rase la tête' }],
      });

      const message = messagesOfType(client, 'goal').at(-1);

      expect(message).toMatchObject({
        type: 'goal',
        subs: 7,
        index: 1,
        total: 2,
        from: 5,
        to: 10,
        label: 'Karaoké',
        complete: false,
      });
      expect(message?.['crossed']).toEqual([{ target: 5, label: 'Je me rase la tête' }]);
    });

    it('sert plusieurs clients', () => {
      const second = createSocketDouble();
      hub.accept(second.socket, {});

      bus.emit('twitch:status', { status: 'ready' });

      expect(messagesOfType(client, 'twitch:status')).toHaveLength(1);
      expect(messagesOfType(second, 'twitch:status')).toHaveLength(1);
    });

    it("continue de diffuser aux autres quand un client échoue à l'écriture", () => {
      const second = createSocketDouble();
      hub.accept(second.socket, {});
      client.breakSending();

      bus.emit('twitch:status', { status: 'ready' });

      expect(messagesOfType(second, 'twitch:status')).toHaveLength(1);
      expect(hub.clientCount()).toBe(1);
    });
  });

  describe('abonnements', () => {
    beforeEach(() => {
      hub.accept(client.socket, {});
    });

    it('reçoit tout par défaut', () => {
      hub.publishLog({
        timestamp: '2026-08-01T10:00:00.000Z',
        level: 'info',
        scope: 'app',
        message: 'ok',
      });

      expect(messagesOfType(client, 'log')).toHaveLength(1);
    });

    it('restreint la diffusion aux canaux demandés', () => {
      client.receive(JSON.stringify({ type: 'subscribe', channels: ['counter'] }));

      hub.publishLog({
        timestamp: '2026-08-01T10:00:00.000Z',
        level: 'info',
        scope: 'app',
        message: 'ok',
      });
      bus.emit('counter:changed', {
        state: counter,
        origin: 'manual',
        deltaMs: 60_000,
        reason: 'ajout',
      });

      expect(messagesOfType(client, 'log')).toHaveLength(0);
      expect(messagesOfType(client, 'counter')).toHaveLength(1);
    });

    it('n’envoie rien sur le canal des objectifs à qui ne s’y abonne pas', () => {
      client.receive(JSON.stringify({ type: 'subscribe', channels: ['counter'] }));
      const before = messagesOfType(client, 'goal').length;

      bus.emit('goals:changed', { snapshot: goal, crossed: [] });

      expect(messagesOfType(client, 'goal')).toHaveLength(before);
    });

    it('répond à un ping', () => {
      client.receive(JSON.stringify({ type: 'ping' }));

      expect(messagesOfType(client, 'pong')).toHaveLength(1);
    });
  });

  describe('messages entrants hostiles', () => {
    beforeEach(() => {
      hub.accept(client.socket, {});
    });

    it('ferme la connexion sur un message qui dépasse le plafond', () => {
      client.receive(JSON.stringify({ type: 'ping', bourrage: 'x'.repeat(10_000) }));

      expect(messagesOfType(client, 'error')).toHaveLength(1);
      expect(client.closed).toBe(true);
      expect(hub.clientCount()).toBe(0);
    });

    it('ferme la connexion sur du JSON invalide', () => {
      client.receive('{ pas du json');

      expect(messagesOfType(client, 'error')).toHaveLength(1);
      expect(client.closed).toBe(true);
    });

    it.each([
      { type: 'inconnu' },
      { type: 'subscribe' },
      { type: 'subscribe', channels: [] },
      { type: 'subscribe', channels: ['canal-inexistant'] },
      { type: 'subscribe', channels: 'counter' },
      [],
      'chaîne',
      null,
    ])('ferme la connexion sur %j', (payload) => {
      client.receive(JSON.stringify(payload));

      expect(messagesOfType(client, 'error')).toHaveLength(1);
      expect(client.closed).toBe(true);
    });

    it("ne réfléchit pas le message reçu dans l'erreur", () => {
      client.receive(JSON.stringify({ type: '<script>alert(1)</script>' }));

      expect(JSON.stringify(messagesOfType(client, 'error'))).not.toContain('script');
    });
  });

  describe('vivacité', () => {
    beforeEach(() => {
      hub.accept(client.socket, {});
    });

    it('envoie un ping à chaque battement', () => {
      timers.fire();
      expect(client.pings).toBe(1);
    });

    it('conserve un client qui répond', () => {
      timers.fire();
      client.pong();
      timers.fire();

      expect(hub.clientCount()).toBe(1);
      expect(client.pings).toBe(2);
    });

    it('termine un client resté muet', () => {
      timers.fire();
      timers.fire();

      expect(client.closed).toBe(true);
      expect(hub.clientCount()).toBe(0);
    });
  });

  describe('arrêt', () => {
    it('ferme les connexions et libère le minuteur', () => {
      hub.accept(client.socket, {});

      hub.stop();

      expect(client.closed).toBe(true);
      expect(hub.clientCount()).toBe(0);
      expect(timers.count()).toBe(0);
    });

    it('cesse de réagir au bus', () => {
      hub.accept(client.socket, {});
      hub.stop();

      const late = createSocketDouble();
      hub.accept(late.socket, {});
      bus.emit('twitch:status', { status: 'ready' });

      expect(messagesOfType(late, 'twitch:status')).toHaveLength(0);
    });

    it('supporte un second arrêt', () => {
      hub.stop();
      expect(() => {
        hub.stop();
      }).not.toThrow();
    });
  });
});
