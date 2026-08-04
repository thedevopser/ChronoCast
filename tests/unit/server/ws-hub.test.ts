import { beforeEach, describe, expect, it } from 'vitest';

import type { AppEvents } from '../../../src/core/app/app-events.js';
import { createEventBus, type EventBus } from '../../../src/core/app/event-bus.js';
import { DEFAULT_CONFIG } from '../../../src/core/config/defaults.js';
import type { ChronoCastConfig } from '../../../src/core/config/schema.js';
import { createInitialState, type CounterState } from '../../../src/core/counter/counter-state.js';
import { createLogger, type LogSink } from '../../../src/core/logging/logger.js';
import { PROTOCOL_VERSION } from '../../../src/core/server/protocol.js';
import { createWsHub, type HubTimers, type WsHub } from '../../../src/core/server/ws-hub.js';
import { createSocketDouble, type SocketDouble } from '../../helpers/hub-socket.js';

/**
 * Le hub est le lien entre l'application et l'overlay affiché en direct. Trois
 * situations dictent sa conception, et aucune n'est théorique.
 *
 *   - **OBS n'est pas rechargé.** Une Browser Source reste ouverte des heures. Le
 *     hub doit donc supporter des connexions très longues, et surtout détecter
 *     celles qui sont mortes sans l'avoir dit : d'où le ping/pong et la
 *     terminaison des sockets muettes. Un socket fantôme fait diffuser dans le
 *     vide, et le streamer voit un compteur figé sans comprendre pourquoi.
 *   - **Le décompte ne se diffuse pas à chaque top.** L'overlay interpole
 *     localement ; le serveur ne lui envoie l'état qu'une fois par seconde. Les
 *     mutations, elles, partent immédiatement : c'est le gift sub qui doit
 *     apparaître tout de suite, pas la seconde qui s'écoule.
 *   - **Le canal est en lecture seule.** Il diffuse, il ne commande pas. Un
 *     message inattendu est une anomalie, traitée comme telle.
 */

const SILENT_SINK: LogSink = { name: 'silencieux', write: () => undefined };

/** Minuteurs contrôlés : aucune attente réelle, aucun test qui traîne. */
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
    /** Déclenche tous les minuteurs actifs, comme le ferait le temps qui passe. */
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
  let monotonic: number;
  let client: SocketDouble;

  /** Ne garde que les messages d'un type donné, pour des assertions lisibles. */
  function messagesOfType(socket: SocketDouble, type: string): Record<string, unknown>[] {
    return socket.sent.filter((message) => message['type'] === type);
  }

  beforeEach(() => {
    bus = createEventBus<AppEvents>();
    timers = createTimersDouble();
    config = DEFAULT_CONFIG;
    counter = createInitialState({ initialMs: 43_200_000, now: 1_000 });
    monotonic = 0;

    hub = createWsHub({
      bus,
      getConfig: () => config,
      getSnapshot: () => ({ counter, twitch: { status: 'ready' } }),
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

    it('annonce le port du WebSocket quand il diffère de celui du HTTP', () => {
      // Mode `separate`. La page a déjà dû joindre ce port pour lire ce
      // message — le marqueur du gabarit s'en est chargé — mais l'annoncer
      // rend le contrat auto-descriptif et permet de vérifier la cohérence.
      const separate = createWsHub({
        bus,
        getConfig: () => config,
        getSnapshot: () => ({ counter, twitch: { status: 'ready' } }),
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
      // L'overlay applique ses variables CSS avant même le premier décompte :
      // sans cela, il s'afficherait une fraction de seconde avec le style par défaut.
      hub.accept(client.socket, {});

      expect(client.sent[0]?.['overlay']).toEqual(DEFAULT_CONFIG.overlay);
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
      // Le compteur bat quatre fois par seconde par défaut ; l'overlay n'a besoin
      // que d'un point de synchronisation par seconde.
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
      // Le client fautif est écarté : le garder ferait échouer chaque diffusion.
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
      // L'overlay ne demande que le compteur : lui pousser chaque ligne de
      // journal réveillerait OBS pour rien.
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

    it('répond à un ping', () => {
      client.receive(JSON.stringify({ type: 'ping' }));

      expect(messagesOfType(client, 'pong')).toHaveLength(1);
    });

    it('ne pousse pas l’état des mises à jour à l’overlay', () => {
      // L'overlay ne demande que le compteur. Une mise à jour disponible n'a
      // rien à faire sur la scène OBS : elle s'affiche dans le panneau, pas
      // devant les spectateurs.
      client.receive(JSON.stringify({ type: 'subscribe', channels: ['counter'] }));

      bus.emit('update:status', {
        phase: 'ready',
        currentVersion: '0.5.0',
        availableVersion: '0.5.1',
        notesUrl: null,
        message: null,
        checkedAt: null,
      });

      expect(messagesOfType(client, 'update')).toHaveLength(0);
    });
  });

  describe('mises à jour', () => {
    beforeEach(() => {
      hub.accept(client.socket, {});
    });

    it('diffuse chaque changement d’état de la mise à jour', () => {
      bus.emit('update:status', {
        phase: 'ready',
        currentVersion: '0.5.0',
        availableVersion: '0.5.1',
        notesUrl: 'https://github.com/thedevopser/ChronoCast/releases/tag/v0.5.1',
        message: null,
        checkedAt: 1_700_000_000_000,
      });

      const [message] = messagesOfType(client, 'update');

      expect(message).toMatchObject({
        type: 'update',
        status: { phase: 'ready', availableVersion: '0.5.1' },
      });
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
      // Une Browser Source fermée brutalement laisse un socket ouvert côté
      // serveur : sans cette détection, le hub diffuserait dans le vide.
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
