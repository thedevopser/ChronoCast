import { request as httpRequest, type IncomingMessage } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';

import {
  createApplication,
  OAUTH_REDIRECT_URI,
  type Application,
} from '../../src/core/app/application.js';
import type { SecretStore } from '../../src/core/app/ports.js';
import { CONFIG_SCHEMA_VERSION } from '../../src/core/config/schema.js';
import { createSystemClock } from '../../src/core/app/system-clock.js';
import type { Ticker } from '../../src/core/counter/counter-service.js';
import type { Router } from '../../src/core/server/router.js';
import type {
  EventSubSocket,
  EventSubSocketFactory,
} from '../../src/core/twitch/eventsub-client.js';
import { CSRF_HEADER } from '../../src/core/server/security/csrf.js';
import { makeRequest } from '../helpers/http-request.js';
import {
  channelBitsUseCheer,
  channelBitsUseCustomPowerUp,
  channelBitsUsePowerUp,
  channelSubscribe,
  channelSubscribeGifted,
  channelSubscriptionGift,
  channelSubscriptionMessage,
  chatMessageBroadcasterPause,
  chatMessageBroadcasterResume,
  chatMessageModeratorAddTime,
  chatMessageModeratorNotANumber,
  chatMessageModeratorPause,
  chatMessageModeratorTooMuch,
  chatMessageSmallTalk,
  chatMessageViewerAddTime,
  chatNotificationSubPrime,
} from '../fixtures/eventsub-payloads.js';

function createManualTicker(): Ticker & { tick(): void } {
  let handler: (() => void) | null = null;
  return {
    start(_intervalMs: number, onTick: () => void): void {
      handler = onTick;
    },
    stop(): void {
      handler = null;
    },
    tick(): void {
      handler?.();
    },
  };
}

function createMemorySecretStore(seed: ReadonlyMap<string, string>): SecretStore {
  const entries = new Map<string, string>(seed);
  return {
    isEncryptionAvailable: () => false,
    read: (key) => Promise.resolve(entries.get(key) ?? null),
    write: (key, value) => {
      entries.set(key, value);
      return Promise.resolve();
    },
    delete: (key) => {
      entries.delete(key);
      return Promise.resolve();
    },
  };
}

function rawRequestStatus(host: string, path: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      { host: '127.0.0.1', port, path, method: 'GET', headers: { Host: host } },
      (response: IncomingMessage) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      },
    );
    request.once('error', reject);
    request.end();
  });
}

function collect(socket: WebSocket) {
  const received: Record<string, unknown>[] = [];

  socket.on('message', (data: Buffer) => {
    received.push(JSON.parse(data.toString('utf8')) as Record<string, unknown>);
  });

  return {
    received,
    ofType(type: string): Record<string, unknown>[] {
      return received.filter((message) => message['type'] === type);
    },
    async waitFor(predicate: () => boolean, description: string): Promise<void> {
      const deadline = Date.now() + 2_000;
      while (!predicate()) {
        if (Date.now() > deadline) {
          throw new Error(`condition jamais atteinte : ${description}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    },
  };
}

describe('application complète', () => {
  let dataDirectory: string;
  let application: Application;
  let ticker: ReturnType<typeof createManualTicker>;
  let port: number;
  let sequence = 0;
  const sockets: WebSocket[] = [];
  let oauthEvents: string[] = [];
  let oauthRouter: Router | null = null;
  let appFetch: typeof fetch = () => Promise.reject(new Error('aucun accès réseau dans ces tests'));
  let seededSecrets: ReadonlyMap<string, string> = new Map();
  let socketFactory: EventSubSocketFactory | null = null;
  let openedSocketUrls: string[] = [];

  // Décale l'horloge murale de l'application sans toucher à l'horloge monotone du décompte.
  let clockOffsetMs = 0;

  const systemClock = createSystemClock();

  function build(): Application {
    ticker = createManualTicker();

    return createApplication({
      paths: {
        dataDirectory,
        logsDirectory: join(dataDirectory, 'logs'),
        historyDirectory: join(dataDirectory, 'history'),
        webRootDirectory: join(dataDirectory, 'public'),
        resolveDataFile: (...segments) => join(dataDirectory, ...segments),
      },
      secrets: createMemorySecretStore(seededSecrets),
      clock: {
        now: () => systemClock.now() + clockOffsetMs,
        monotonicMs: () => systemClock.monotonicMs(),
      },
      browser: { open: () => Promise.resolve() },
      ticker,
      appVersion: '0.1.0',
      hubTimers: {
        setInterval: () => 0,
        clearInterval: () => undefined,
      },
      eventSubTimers: {
        setTimeout: () => 0,
        clearTimeout: () => undefined,
      },
      createOAuthServer: (router) => {
        oauthEvents.push('créé');
        oauthRouter = router;
        return {
          start: () => {
            oauthEvents.push('démarré');
            return Promise.resolve(37_771);
          },
          stop: () => {
            oauthEvents.push('arrêté');
            return Promise.resolve();
          },
        };
      },
      createSocket: (url) => {
        if (socketFactory === null) {
          throw new Error('aucune socket EventSub ne doit être ouverte dans ces tests');
        }
        openedSocketUrls.push(url);
        return socketFactory(url);
      },
      fetch: (input, init) => appFetch(input, init),
      sleep: () => Promise.resolve(),
    });
  }

  function notify(subscriptionType: string, payload: unknown, messageId?: string): Promise<void> {
    sequence += 1;
    return application.ingestNotification(
      {
        messageId: messageId ?? `msg-${String(sequence)}`,
        receivedAt: Date.now(),
        subscriptionType,
      },
      payload,
    );
  }

  function api(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`http://127.0.0.1:${String(port)}${path}`, init);
  }

  function mutate(path: string, body?: string): Promise<Response> {
    return api(path, {
      method: 'POST',
      headers: { [CSRF_HEADER]: application.getCsrfToken() },
      ...(body === undefined ? {} : { body }),
    });
  }

  beforeEach(async () => {
    dataDirectory = await mkdtemp(join(tmpdir(), 'chronocast-app-'));
    seededSecrets = new Map();
    socketFactory = null;
    openedSocketUrls = [];
    oauthEvents = [];
    appFetch = () => Promise.reject(new Error('aucun accès réseau dans ces tests'));
    oauthRouter = null;
    clockOffsetMs = 0;
    application = build();
    port = await application.start();
  });

  afterEach(async () => {
    for (const socket of sockets.splice(0)) {
      socket.removeAllListeners();
      if (socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
    }
    await application.stop();
    await rm(dataDirectory, { recursive: true, force: true });
  });

  function connectOverlay(): WebSocket {
    const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/ws`);
    sockets.push(socket);
    return socket;
  }

  async function readPersistedCounter(): Promise<{ remainingMs: number; status: string }> {
    const raw = await readFile(join(dataDirectory, 'counter.json'), 'utf8');
    return JSON.parse(raw) as { remainingMs: number; status: string };
  }

  describe('démarrage', () => {
    it('écoute et sert son état', async () => {
      const response = await api('/api/state');

      expect(response.status).toBe(200);
      const state = (await response.json()) as Record<string, unknown>;
      expect(state['port']).toBe(port);
      expect(state['appVersion']).toBe('0.1.0');
    });

    it('démarre le compteur sur la valeur par défaut', async () => {
      const state = (await (await api('/api/state')).json()) as {
        counter: { remainingMs: number };
      };

      expect(state.counter.remainingMs).toBe(43_200_000);
    });

    it('démarre sans Twitch configuré, sans échouer', async () => {
      const twitch = (await (await api('/api/twitch/status')).json()) as Record<string, unknown>;

      expect(twitch['connected']).toBe(false);
    });

    it('écrit sa configuration sur le disque', async () => {
      const raw = await readFile(join(dataDirectory, 'config.json'), 'utf8');

      expect(JSON.parse(raw)).toMatchObject({ schemaVersion: CONFIG_SCHEMA_VERSION });
    });
  });

  describe('pipeline d’événements', () => {
    it('crédite le compteur, persiste, journalise et diffuse', async () => {
      const overlay = collect(connectOverlay());
      await overlay.waitFor(() => overlay.ofType('state').length > 0, 'instantané initial');

      await notify('channel.subscribe', channelSubscribe);

      const state = (await (await api('/api/state')).json()) as {
        counter: { remainingMs: number };
      };
      expect(state.counter.remainingMs).toBe(43_200_000 + 180_000);

      expect((await readPersistedCounter()).remainingMs).toBe(43_380_000);

      const history = (await (await api('/api/history')).json()) as {
        entries: { type: string; rewardSeconds: number; applied: boolean }[];
      };
      expect(history.entries[0]).toMatchObject({
        type: 'sub',
        rewardSeconds: 180,
        applied: true,
      });

      await overlay.waitFor(() => overlay.ofType('counter').length > 0, 'diffusion du compteur');
      expect(overlay.ofType('event')).toHaveLength(1);
    });

    it('crédite un abonnement au barème Happy Hour une fois celui-ci activé', async () => {
      const response = await api('/api/config', {
        method: 'PATCH',
        headers: { [CSRF_HEADER]: application.getCsrfToken() },
        body: JSON.stringify({ config: { rewards: { happyHour: true } } }),
      });
      expect(response.status).toBe(200);

      await notify('channel.subscribe', channelSubscribe);

      const state = (await (await api('/api/state')).json()) as {
        counter: { remainingMs: number };
      };
      expect(state.counter.remainingMs).toBe(43_200_000 + 360_000);

      const history = (await (await api('/api/history')).json()) as {
        entries: { rewardSeconds: number; reason: string }[];
      };
      expect(history.entries[0]?.rewardSeconds).toBe(360);
      expect(history.entries[0]?.reason).toContain('Happy Hour');
    });

    describe('configuration écrite avant le barème Happy Hour', () => {
      beforeEach(async () => {
        await application.stop();

        await writeFile(
          join(dataDirectory, 'config.json'),
          JSON.stringify({
            schemaVersion: 5,
            rewards: {
              happyHour: true,
              sub: { prime: 100, tier1: 300, tier2: 600, tier3: 900 },
              resub: { prime: 100, tier1: 400, tier2: 600, tier3: 900 },
              gift: { tier1: 500, tier2: 600, tier3: 900 },
              bits: { mode: 'linear', linear: { unit: 50, secondsPerUnit: 30, minBits: 100 } },
            },
          }),
          'utf8',
        );

        application = build();
        port = await application.start();
      });

      async function lastRewardSeconds(): Promise<number | undefined> {
        const history = (await (await api('/api/history')).json()) as {
          entries: { rewardSeconds: number }[];
        };
        return history.entries[0]?.rewardSeconds;
      }

      it('crédite chaque type d’abonnement le double du barème réglé, comme avant la mise à jour', async () => {
        await notify('channel.subscribe', channelSubscribe);
        expect(await lastRewardSeconds()).toBe(600);

        await notify('channel.subscription.message', channelSubscriptionMessage);
        expect(await lastRewardSeconds()).toBe(800);

        await notify('channel.subscription.gift', channelSubscriptionGift);
        expect(await lastRewardSeconds()).toBe(2_000);
      });

      it('crédite un don de bits le double du barème réglé, seuil d’entrée inchangé', async () => {
        await notify('channel.bits.use', channelBitsUseCheer);
        expect(await lastRewardSeconds()).toBe(1_200);

        await notify('channel.bits.use', { ...(channelBitsUseCheer as object), bits: 99 });
        expect(await lastRewardSeconds()).toBe(0);
      });

      it('dérive le barème des bits d’une configuration qui ne porte que celui des abonnements', async () => {
        await application.stop();
        await writeFile(
          join(dataDirectory, 'config.json'),
          JSON.stringify({
            schemaVersion: 6,
            rewards: {
              happyHour: true,
              bits: { mode: 'linear', linear: { unit: 100, secondsPerUnit: 45, minBits: 1 } },
              happyHourRewards: { sub: { tier1: 777 } },
            },
          }),
          'utf8',
        );
        application = build();
        port = await application.start();

        await notify('channel.bits.use', channelBitsUseCheer);
        expect(await lastRewardSeconds()).toBe(900);

        await notify('channel.subscribe', channelSubscribe);
        expect(await lastRewardSeconds()).toBe(777);

        const raw = await readFile(join(dataDirectory, 'config.json'), 'utf8');
        expect(JSON.parse(raw)).toMatchObject({
          schemaVersion: CONFIG_SCHEMA_VERSION,
          rewards: { happyHourRewards: { bits: { linear: { secondsPerUnit: 90 } } } },
        });
      });

      it('écrit le barème dérivé sur le disque, sous la version courante du schéma', async () => {
        const raw = await readFile(join(dataDirectory, 'config.json'), 'utf8');

        expect(JSON.parse(raw)).toMatchObject({
          schemaVersion: CONFIG_SCHEMA_VERSION,
          rewards: {
            happyHourRewards: {
              sub: { prime: 200, tier1: 600, tier2: 1_200, tier3: 1_800 },
              resub: { prime: 200, tier1: 800, tier2: 1_200, tier3: 1_800 },
              gift: { tier1: 1_000, tier2: 1_200, tier3: 1_800 },
              bits: { mode: 'linear', linear: { unit: 50, secondsPerUnit: 60, minBits: 100 } },
            },
          },
        });
      });

      it('ne dérive qu’une fois : régler ensuite le barème normal ne touche plus au barème Happy Hour', async () => {
        const response = await api('/api/config', {
          method: 'PATCH',
          headers: { [CSRF_HEADER]: application.getCsrfToken() },
          body: JSON.stringify({ config: { rewards: { sub: { tier1: 1_000 } } } }),
        });
        expect(response.status).toBe(200);

        await application.stop();
        application = build();
        port = await application.start();

        await notify('channel.subscribe', channelSubscribe);
        expect(await lastRewardSeconds()).toBe(600);
      });

      it('laisse régler le barème Happy Hour sans toucher au barème normal', async () => {
        const response = await api('/api/config', {
          method: 'PATCH',
          headers: { [CSRF_HEADER]: application.getCsrfToken() },
          body: JSON.stringify({ config: { rewards: { happyHourRewards: { sub: { tier1: 42 } } } } }),
        });
        expect(response.status).toBe(200);

        await notify('channel.subscribe', channelSubscribe);
        expect(await lastRewardSeconds()).toBe(42);

        const { config } = (await (await api('/api/config')).json()) as {
          config: { rewards: { sub: { tier1: number } } };
        };
        expect(config.rewards.sub.tier1).toBe(300);
      });
    });

    describe('Power-ups', () => {
      async function lastEntry(): Promise<{ type: string; rewardSeconds: number; reason: string } | undefined> {
        const history = (await (await api('/api/history')).json()) as {
          entries: { type: string; rewardSeconds: number; reason: string }[];
        };
        return history.entries[0];
      }

      async function goalCount(): Promise<number> {
        return ((await (await api('/api/goals')).json()) as { goal: { subs: number } }).goal.subs;
      }

      it('crédite un Power-up comme un cheer du même montant et le distingue dans l’historique', async () => {
        const powerUp = { ...(channelBitsUsePowerUp as object), bits: 1000 };

        await notify('channel.bits.use', channelBitsUseCheer);
        const cheer = await lastEntry();
        await notify('channel.bits.use', powerUp);
        const spent = await lastEntry();

        expect(spent?.type).toBe('bits');
        expect(spent?.rewardSeconds).toBe(cheer?.rewardSeconds);
        expect(spent?.rewardSeconds).toBe(600);
        expect(spent?.reason).toContain('Power-up');
        expect(cheer?.reason).not.toContain('Power-up');
      });

      it('fait avancer la barre d’objectif', async () => {
        await notify('channel.bits.use', { ...(channelBitsUseCustomPowerUp as object), bits: 1500 });

        expect(await goalCount()).toBe(3);
      });

      it('compte deux Power-ups identiques envoyés coup sur coup par le même spectateur', async () => {
        await notify('channel.bits.use', { ...(channelBitsUsePowerUp as object), bits: 500 });
        await notify('channel.bits.use', { ...(channelBitsUsePowerUp as object), bits: 500 });

        expect(await goalCount()).toBe(2);
      });

      it('ne compte qu’une fois un même envoi rejoué par Twitch', async () => {
        const powerUp = { ...(channelBitsUsePowerUp as object), bits: 500 };

        await notify('channel.bits.use', powerUp, 'msg-rejoué');
        await notify('channel.bits.use', powerUp, 'msg-rejoué');

        expect(await goalCount()).toBe(1);
      });

      it('compte pour ses bits une dépense de type inconnu et le journalise', async () => {
        await notify('channel.bits.use', { ...(channelBitsUseCheer as object), type: 'combo' });

        expect((await lastEntry())?.rewardSeconds).toBe(600);

        const { records } = (await (await api('/api/logs?limit=200')).json()) as {
          records: { message: string }[];
        };
        expect(records.map((record) => record.message)).toContain(
          'dépense de bits de type inconnu, comptée pour ses bits',
        );
      });
    });

    it('ignore le rejeu du même message_id', async () => {
      await notify('channel.subscribe', channelSubscribe, 'msg-identique');
      await notify('channel.subscribe', channelSubscribe, 'msg-identique');

      const state = (await (await api('/api/state')).json()) as {
        counter: { remainingMs: number };
      };

      expect(state.counter.remainingMs).toBe(43_200_000 + 180_000);
    });

    it('ne crédite un don d’abonnements qu’une seule fois', async () => {
      await notify('channel.subscription.gift', channelSubscriptionGift);
      const afterGift = (await (await api('/api/state')).json()) as {
        counter: { remainingMs: number };
      };

      await notify('channel.subscribe', channelSubscribeGifted);
      const afterRecipient = (await (await api('/api/state')).json()) as {
        counter: { remainingMs: number };
      };

      expect(afterRecipient.counter.remainingMs).toBe(afterGift.counter.remainingMs);
    });

    it('ne crédite pas deux fois un Prime vu par deux flux', async () => {
      await notify('channel.chat.notification', chatNotificationSubPrime);
      const afterPrime = (await (await api('/api/state')).json()) as {
        counter: { remainingMs: number };
      };

      await notify('channel.subscribe', channelSubscribe);
      const afterSubscribe = (await (await api('/api/state')).json()) as {
        counter: { remainingMs: number };
      };

      expect(afterSubscribe.counter.remainingMs).toBe(afterPrime.counter.remainingMs);
    });

    it('crédite les bits selon le barème', async () => {
      await notify('channel.bits.use', channelBitsUseCheer);

      const history = (await (await api('/api/history')).json()) as {
        entries: { type: string; applied: boolean }[];
      };

      expect(history.entries[0]).toMatchObject({ type: 'bits', applied: true });
    });

    it('reste debout sur une charge utile non conforme', async () => {
      await notify('channel.subscribe', { n_importe: 'quoi' });

      expect((await api('/api/state')).status).toBe(200);
    });
  });

  describe('objectifs', () => {
    async function readPersistedGoals(): Promise<{ subs: number; reached: { target: number }[] }> {
      const raw = await readFile(join(dataDirectory, 'goals.json'), 'utf8');
      return JSON.parse(raw) as { subs: number; reached: { target: number }[] };
    }

    async function setLadder(): Promise<void> {
      const response = await api('/api/config', {
        method: 'PATCH',
        headers: { [CSRF_HEADER]: application.getCsrfToken() },
        body: JSON.stringify({
          config: {
            goals: {
              tiers: [
                { target: 1, label: 'Je me rase la tête' },
                { target: 2, label: 'Karaoké' },
                { target: 10, label: 'Marathon 24 h' },
              ],
            },
          },
        }),
      });
      expect(response.status).toBe(200);
    }

    it('compte un abonnement et le persiste hors de l’état du compteur', async () => {
      await notify('channel.subscribe', channelSubscribe);

      expect((await readPersistedGoals()).subs).toBe(1);
      expect((await readPersistedCounter())).not.toHaveProperty('subs');
    });

    it('compte un don groupé pour ce qu’il porte et franchit tous les paliers traversés', async () => {
      await setLadder();

      await notify('channel.subscription.gift', channelSubscriptionGift);

      const persisted = await readPersistedGoals();
      expect(persisted.subs).toBe(2);
      expect(persisted.reached.map((entry) => entry.target)).toEqual([1, 2]);
    });

    it('sert la progression et l’échelle triée', async () => {
      await setLadder();
      await notify('channel.subscribe', channelSubscribe);

      const payload = (await (await api('/api/goals')).json()) as {
        goal: { subs: number; position: { label: string; from: number; to: number } };
        tiers: { target: number }[];
      };

      expect(payload.goal.subs).toBe(1);
      expect(payload.goal.position).toMatchObject({ label: 'Karaoké', from: 1, to: 2 });
      expect(payload.tiers.map((tier) => tier.target)).toEqual([1, 2, 10]);
    });

    it('diffuse la progression sur le canal des objectifs', async () => {
      await setLadder();
      const page = collect(connectOverlay());
      await page.waitFor(() => page.ofType('goal').length > 0, 'instantané des objectifs');

      await notify('channel.subscribe', channelSubscribe);

      await page.waitFor(() => page.ofType('goal').length > 1, 'diffusion des objectifs');
      const message = page.ofType('goal').at(-1) as unknown as {
        subs: number;
        crossed: { label: string }[];
      };
      expect(message.subs).toBe(1);
      expect(message.crossed.map((tier) => tier.label)).toEqual(['Je me rase la tête']);
    });

    async function patchConfig(config: unknown): Promise<void> {
      const response = await api('/api/config', {
        method: 'PATCH',
        headers: { [CSRF_HEADER]: application.getCsrfToken() },
        body: JSON.stringify({ config }),
      });
      expect(response.status).toBe(200);
    }

    async function goalCount(): Promise<number> {
      return ((await (await api('/api/goals')).json()) as { goal: { subs: number } }).goal.subs;
    }

    it('avance sur un cheer que le barème de temps refuse : les deux barèmes sont indépendants', async () => {
      await patchConfig({
        rewards: { bits: { mode: 'linear', linear: { unit: 100, secondsPerUnit: 60, minBits: 5_000 } } },
        goals: { bitsPerSub: 500 },
      });

      await notify('channel.bits.use', channelBitsUseCheer);

      const history = (await (await api('/api/history')).json()) as {
        entries: { type: string; applied: boolean }[];
      };
      expect(history.entries[0]).toMatchObject({ type: 'bits', applied: false });
      expect(await goalCount()).toBe(2);
    });

    it('n’avance pas sur un événement invalide, que le barème de temps refusait déjà', async () => {
      await notify('channel.bits.use', { ...(channelBitsUseCheer as object), bits: -500 });
      await notify('channel.subscription.gift', { ...(channelSubscriptionGift as object), total: 0 });

      expect(await goalCount()).toBe(0);
    });

    it('pèse chaque soutien selon le barème de points', async () => {
      await patchConfig({
        goals: { bitsPerSub: 1, points: { sub: { tier1: 250 }, gift: { tier1: 100 } } },
      });

      await notify('channel.subscribe', channelSubscribe);
      await notify('channel.bits.use', channelBitsUseCheer);
      await notify('channel.subscription.gift', channelSubscriptionGift);

      expect(await goalCount()).toBe(250 + 1_000 + 200);
    });

    it('annonce l’un après l’autre les paliers qu’un lot pondéré traverse', async () => {
      await setLadder();
      await patchConfig({ goals: { points: { gift: { tier1: 5 } } } });

      await notify('channel.subscription.gift', channelSubscriptionGift);

      const persisted = await readPersistedGoals();
      expect(persisted.subs).toBe(10);
      expect(persisted.reached.map((entry) => entry.target)).toEqual([1, 2, 10]);
    });

    it('relit sans perte la progression écrite par une version sans barème de points', async () => {
      await application.stop();
      await writeFile(
        join(dataDirectory, 'goals.json'),
        JSON.stringify({
          subs: 37,
          reached: [{ target: 5, reachedAt: 1_754_000_000_000 }],
          updatedAt: 1_754_000_000_000,
          schemaVersion: 1,
        }),
        'utf8',
      );
      application = build();
      port = await application.start();

      const payload = (await (await api('/api/goals')).json()) as {
        goal: { subs: number; reached: { target: number }[] };
      };
      expect(payload.goal.subs).toBe(37);
      expect(payload.goal.reached.map((entry) => entry.target)).toEqual([5]);

      await notify('channel.subscribe', channelSubscribe);
      expect(await goalCount()).toBe(38);
    });

    it('accepte l’écriture d’un compte en points, mille fois plus grand qu’un compte d’abonnements', async () => {
      const response = await mutate('/api/goals/subs', JSON.stringify({ subs: 2_500_000 }));

      expect(response.status).toBe(200);
      expect(await goalCount()).toBe(2_500_000);
    });

    it('n’avance pas sur une commande de chat, qui est une saisie humaine', async () => {
      await api('/api/config', {
        method: 'PATCH',
        headers: { [CSRF_HEADER]: application.getCsrfToken() },
        body: JSON.stringify({ config: { twitch: { enableChatCommands: true } } }),
      });

      await notify('channel.chat.message', chatMessageModeratorAddTime);

      const payload = (await (await api('/api/goals')).json()) as { goal: { subs: number } };
      expect(payload.goal.subs).toBe(0);
    });

    it('remet la progression à zéro sans toucher au compteur', async () => {
      await notify('channel.subscription.gift', channelSubscriptionGift);
      const before = (await (await api('/api/state')).json()) as {
        counter: { remainingMs: number };
      };

      const response = await mutate('/api/goals/reset');
      expect(response.status).toBe(200);

      expect((await readPersistedGoals()).subs).toBe(0);
      const after = (await (await api('/api/state')).json()) as {
        counter: { remainingMs: number };
      };
      expect(after.counter.remainingMs).toBe(before.counter.remainingMs);
    });

    it('écrit un compte déjà acquis et le persiste', async () => {
      await setLadder();

      const response = await mutate('/api/goals/subs', JSON.stringify({ subs: 8 }));
      expect(response.status).toBe(200);

      expect((await readPersistedGoals()).subs).toBe(8);
      // Aucun franchissement fabriqué pour les paliers 1 et 2 que la valeur dépasse.
      expect((await readPersistedGoals()).reached).toEqual([]);
    });

    it('laisse le palier suivant s’annoncer depuis le compte écrit', async () => {
      await setLadder();
      await mutate('/api/goals/subs', JSON.stringify({ subs: 9 }));

      const page = collect(connectOverlay());
      await page.waitFor(() => page.ofType('goal').length > 0, 'instantané des objectifs');

      await notify('channel.subscribe', channelSubscribe);

      await page.waitFor(() => page.ofType('goal').length > 1, 'diffusion des objectifs');
      const message = page.ofType('goal').at(-1) as unknown as {
        subs: number;
        crossed: { label: string }[];
      };
      expect(message.subs).toBe(10);
      expect(message.crossed.map((tier) => tier.label)).toEqual(['Marathon 24 h']);
    });

    it('refuse l’écriture du compte sans jeton CSRF', async () => {
      const response = await api('/api/goals/subs', {
        method: 'POST',
        body: JSON.stringify({ subs: 8 }),
      });

      expect(response.status).toBe(403);
    });

    it('refuse la remise à zéro sans jeton CSRF', async () => {
      const response = await api('/api/goals/reset', { method: 'POST' });

      expect(response.status).toBe(403);
    });

    it('retrouve la progression après un redémarrage', async () => {
      await notify('channel.subscription.gift', channelSubscriptionGift);
      await application.stop();

      application = build();
      port = await application.start();

      const payload = (await (await api('/api/goals')).json()) as { goal: { subs: number } };
      expect(payload.goal.subs).toBe(2);
    });

    // Ce que la page /goal reçoit réellement sur le fil. Le service de la page elle-même est tenu
    // par pages.test.ts : la racine statique du harnais est un répertoire temporaire vide.
    describe('ce que reçoit la page /goal', () => {
      it('annonce l’apparence de la page dès l’accueil, sans l’échelle ni le comptage', async () => {
        await setLadder();

        const client = collect(connectOverlay());
        await client.waitFor(() => client.ofType('hello').length > 0, 'accueil');

        const hello = client.ofType('hello')[0] as { goalOverlay?: { fontSize: number } };
        expect(hello.goalOverlay).toMatchObject({ fontSize: 28 });
        expect(JSON.stringify(hello)).not.toContain('Je me rase la tête');
      });

      it('reçoit la progression dès l’accueil, sans attendre le prochain abonnement', async () => {
        await setLadder();
        await notify('channel.subscribe', channelSubscribe);

        const client = collect(connectOverlay());
        await client.waitFor(() => client.ofType('goal').length > 0, 'progression à l’accueil');

        expect(client.ofType('goal')[0]).toMatchObject({
          subs: 1,
          label: 'Karaoké',
          from: 1,
          to: 2,
          crossed: [],
        });
      });

      it('joue une annonce d’essai sans rien écrire, jusque dans les Browser Sources ouvertes', async () => {
        await setLadder();

        const client = collect(connectOverlay());
        await client.waitFor(() => client.ofType('goal').length > 0, 'progression à l’accueil');

        const response = await mutate('/api/goals/preview');
        expect(response.status).toBe(200);

        await client.waitFor(() => client.ofType('goal').length > 1, 'annonce d’essai diffusée');

        const message = client.ofType('goal').at(-1) as {
          subs: number;
          crossed: { label: string }[];
        };
        expect(message.crossed.map((tier) => tier.label)).toEqual(['Je me rase la tête']);

        // L'aperçu ne laisse rien derrière lui : ni compte avancé, ni palier consigné sur disque.
        expect(message.subs).toBe(0);
        expect((await readPersistedGoals()).subs).toBe(0);
        expect((await readPersistedGoals()).reached).toEqual([]);
      });

      it('refuse l’annonce d’essai sans jeton CSRF', async () => {
        await setLadder();

        const response = await api('/api/goals/preview', { method: 'POST' });

        expect(response.status).toBe(403);
      });

      it('refuse l’annonce d’essai tant qu’aucun palier n’est défini', async () => {
        const response = await mutate('/api/goals/preview');

        expect(response.status).toBe(409);
      });

      it('nomme chaque palier traversé par un don groupé, pour que chacun soit annoncé', async () => {
        await setLadder();

        const client = collect(connectOverlay());
        await client.waitFor(() => client.ofType('goal').length > 0, 'progression à l’accueil');

        await notify('channel.subscription.gift', channelSubscriptionGift);
        await client.waitFor(() => client.ofType('goal').length > 1, 'franchissement diffusé');

        const message = client.ofType('goal').at(-1) as {
          crossed: { target: number; label: string }[];
        };
        expect(message.crossed.map((tier) => tier.label)).toEqual([
          'Je me rase la tête',
          'Karaoké',
        ]);
      });
    });
  });

  describe('commandes de chat', () => {
    async function enableChatCommands(patch: unknown = {}): Promise<void> {
      const response = await api('/api/config', {
        method: 'PATCH',
        headers: { [CSRF_HEADER]: application.getCsrfToken() },
        body: JSON.stringify({
          config: { twitch: { enableChatCommands: true }, ...(patch as object) },
        }),
      });
      expect(response.status).toBe(200);
    }

    async function remainingMs(): Promise<number> {
      const state = (await (await api('/api/state')).json()) as {
        counter: { remainingMs: number };
      };
      return state.counter.remainingMs;
    }

    async function historyEntries(): Promise<Record<string, unknown>[]> {
      const history = (await (await api('/api/history')).json()) as {
        entries: Record<string, unknown>[];
      };
      return history.entries;
    }

    it('crédite le temps tapé par un modérateur, et l’annonce', async () => {
      await enableChatCommands();
      const overlay = collect(connectOverlay());
      await overlay.waitFor(() => overlay.ofType('state').length > 0, 'instantané initial');

      await notify('channel.chat.message', chatMessageModeratorAddTime);

      expect(await remainingMs()).toBe(43_200_000 + 300_000);
      expect((await historyEntries())[0]).toMatchObject({
        type: 'command',
        detail: 'addtime',
        source: 'chat-command',
        rewardSeconds: 300,
        applied: true,
      });

      await overlay.waitFor(() => overlay.ofType('event').length > 0, 'annonce de la commande');
      expect(overlay.ofType('event')[0]).toMatchObject({ label: 'Temps ajouté' });
    });

    it('ne fait rien pour un spectateur ordinaire', async () => {
      await enableChatCommands();

      await notify('channel.chat.message', chatMessageViewerAddTime);

      expect(await remainingMs()).toBe(43_200_000);
      expect(await historyEntries()).toHaveLength(0);
    });

    it('explique dans le journal pourquoi une commande est refusée', async () => {
      await enableChatCommands();

      await notify('channel.chat.message', chatMessageViewerAddTime);

      const logs = await (await api('/api/logs')).text();
      expect(logs).toContain('ni diffuseur ni modérateur');
    });

    it('n’écrit rien pour un message ordinaire', async () => {
      await enableChatCommands();

      await notify('channel.chat.message', chatMessageSmallTalk);

      expect(await historyEntries()).toHaveLength(0);
    });

    it('refuse au-delà du plafond, et une valeur qui n’est pas un nombre', async () => {
      await enableChatCommands({ rewards: { chatCommand: { maxSeconds: 600 } } });

      await notify('channel.chat.message', chatMessageModeratorTooMuch);
      await notify('channel.chat.message', chatMessageModeratorNotANumber);

      expect(await remainingMs()).toBe(43_200_000);
      expect(await historyEntries()).toHaveLength(0);
    });

    it('reste inerte tant que les commandes ne sont pas activées', async () => {
      await notify('channel.chat.message', chatMessageModeratorAddTime);

      expect(await remainingMs()).toBe(43_200_000);
      expect(await historyEntries()).toHaveLength(0);
    });

    it('ignore le rejeu du même message par Twitch', async () => {
      await enableChatCommands();

      await notify('channel.chat.message', chatMessageModeratorAddTime, 'msg-rejoue');
      await notify('channel.chat.message', chatMessageModeratorAddTime, 'msg-rejoue');

      expect(await remainingMs()).toBe(43_200_000 + 300_000);
    });

    it('crédite deux fois deux commandes identiques', async () => {
      await enableChatCommands();

      await notify('channel.chat.message', chatMessageModeratorAddTime, 'msg-a');
      await notify('channel.chat.message', chatMessageModeratorAddTime, 'msg-b');

      expect(await remainingMs()).toBe(43_200_000 + 600_000);
    });

    it('reste debout sur une charge utile de chat non conforme', async () => {
      await enableChatCommands();

      await notify('channel.chat.message', { n_importe: 'quoi' });

      expect((await api('/api/state')).status).toBe(200);
    });

    it('met le compteur en pause à la demande du diffuseur, sans rien inscrire à l’historique', async () => {
      await enableChatCommands();
      await mutate('/api/counter/resume');

      await notify('channel.chat.message', chatMessageBroadcasterPause);

      expect((await readPersistedCounter()).status).toBe('paused');
      expect(await historyEntries()).toHaveLength(0);
    });

    it('fige réellement le décompte', async () => {
      await enableChatCommands();
      await mutate('/api/counter/resume');

      await notify('channel.chat.message', chatMessageBroadcasterPause);
      const frozen = await remainingMs();
      ticker.tick();
      ticker.tick();

      expect(await remainingMs()).toBe(frozen);
    });

    it('relance le compteur à la demande du diffuseur', async () => {
      await enableChatCommands();
      await mutate('/api/counter/resume');
      await notify('channel.chat.message', chatMessageBroadcasterPause, 'msg-pause');

      await notify('channel.chat.message', chatMessageBroadcasterResume, 'msg-reprise');

      expect((await readPersistedCounter()).status).toBe('running');
      expect(await historyEntries()).toHaveLength(0);
    });

    it('refuse la pause à un modérateur', async () => {
      await enableChatCommands();
      await mutate('/api/counter/resume');

      await notify('channel.chat.message', chatMessageModeratorPause);

      expect((await readPersistedCounter()).status).toBe('running');
      expect(await historyEntries()).toHaveLength(0);
    });

    it('reste inerte sur une seconde pause', async () => {
      await enableChatCommands();
      await mutate('/api/counter/resume');

      await notify('channel.chat.message', chatMessageBroadcasterPause, 'msg-pause-1');
      await notify('channel.chat.message', chatMessageBroadcasterPause, 'msg-pause-2');

      expect((await readPersistedCounter()).status).toBe('paused');
      expect((await api('/api/state')).status).toBe(200);
    });
  });

  describe('plage ponctuelle du Happy Hour', () => {
    const MINUTE = 60_000;

    function schedule(method: 'PUT' | 'DELETE', body?: unknown): Promise<Response> {
      return api('/api/happy-hour/schedule', {
        method,
        headers: { [CSRF_HEADER]: application.getCsrfToken() },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    }

    function windowFromNow(): { startAt: number; endAt: number } {
      const now = Date.now();
      return { startAt: now + 10 * MINUTE, endAt: now + 70 * MINUTE };
    }

    async function happyHour(): Promise<boolean> {
      const { config } = (await (await api('/api/config')).json()) as {
        config: { rewards: { happyHour: boolean } };
      };
      return config.rewards.happyHour;
    }

    async function currentSchedule(): Promise<unknown> {
      return ((await (await api('/api/happy-hour/schedule')).json()) as { schedule: unknown })
        .schedule;
    }

    async function tickUntil(expected: boolean): Promise<void> {
      const deadline = Date.now() + 2_000;
      for (;;) {
        ticker.tick();
        if ((await happyHour()) === expected) {
          return;
        }
        if (Date.now() > deadline) {
          throw new Error(`Happy Hour jamais passé à ${String(expected)}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }

    async function readScheduleFile(): Promise<unknown> {
      return JSON.parse(await readFile(join(dataDirectory, 'happy-hour-schedule.json'), 'utf8'));
    }

    it('allume le Happy Hour au début, crédite son barème, puis l’éteint à la fin', async () => {
      const window = windowFromNow();
      expect((await schedule('PUT', window)).status).toBe(200);

      ticker.tick();
      expect(await happyHour()).toBe(false);

      clockOffsetMs = 11 * MINUTE;
      await tickUntil(true);

      await notify('channel.subscribe', channelSubscribe);
      const history = (await (await api('/api/history')).json()) as {
        entries: { rewardSeconds: number }[];
      };
      expect(history.entries[0]?.rewardSeconds).toBe(360);

      clockOffsetMs = 71 * MINUTE;
      await tickUntil(false);
      expect(await currentSchedule()).toBeNull();
    });

    it('annonce la plage aux panneaux ouverts, à la connexion puis à chaque changement', async () => {
      const window = windowFromNow();
      await schedule('PUT', window);

      const panel = collect(connectOverlay());
      await panel.waitFor(() => panel.ofType('hello').length > 0, 'accueil');
      expect(panel.ofType('hello')[0]?.['happyHourSchedule']).toStrictEqual(window);

      await schedule('DELETE');
      await panel.waitFor(
        () => panel.ofType('config').some((message) => message['happyHourSchedule'] === null),
        'annulation diffusée',
      );
    });

    it('refuse une plage invalide sans rien enregistrer', async () => {
      const now = Date.now();
      const response = await schedule('PUT', { startAt: now + 2 * MINUTE, endAt: now + MINUTE });

      expect(response.status).toBe(400);
      expect(await currentSchedule()).toBeNull();
    });

    it('respecte une extinction à la main pendant la plage', async () => {
      await schedule('PUT', windowFromNow());
      clockOffsetMs = 11 * MINUTE;
      await tickUntil(true);

      await api('/api/config', {
        method: 'PATCH',
        headers: { [CSRF_HEADER]: application.getCsrfToken() },
        body: JSON.stringify({ config: { rewards: { happyHour: false } } }),
      });
      ticker.tick();
      ticker.tick();
      expect(await happyHour()).toBe(false);

      clockOffsetMs = 71 * MINUTE;
      const deadline = Date.now() + 2_000;
      while ((await currentSchedule()) !== null) {
        ticker.tick();
        if (Date.now() > deadline) {
          throw new Error('plage jamais effacée');
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(await happyHour()).toBe(false);
    });

    it('active le Happy Hour quand l’application est relancée entre le début et la fin', async () => {
      const window = windowFromNow();
      await schedule('PUT', window);
      await application.stop();

      clockOffsetMs = 30 * MINUTE;
      application = build();
      port = await application.start();

      expect(await happyHour()).toBe(true);
      expect(await currentSchedule()).toStrictEqual(window);
      expect(await readScheduleFile()).toStrictEqual({ window, started: true });
    });

    it('efface la plage sans rien activer quand l’application est relancée après la fin', async () => {
      await schedule('PUT', windowFromNow());
      await application.stop();

      clockOffsetMs = 120 * MINUTE;
      application = build();
      port = await application.start();

      expect(await happyHour()).toBe(false);
      expect(await currentSchedule()).toBeNull();
      expect(await readScheduleFile()).toBeNull();
    });

    it('journalise la bascule programmée comme une bascule manuelle, avec son origine', async () => {
      await schedule('PUT', windowFromNow());
      clockOffsetMs = 11 * MINUTE;
      await tickUntil(true);

      await api('/api/config', {
        method: 'PATCH',
        headers: { [CSRF_HEADER]: application.getCsrfToken() },
        body: JSON.stringify({ config: { rewards: { happyHour: false } } }),
      });

      const { records } = (await (await api('/api/logs?limit=200')).json()) as {
        records: { message: string; context?: { active?: boolean; origin?: string } }[];
      };
      const toggles = records
        .filter((record) => record.message === 'Happy Hour basculé')
        .map((record) => record.context);

      expect(toggles).toContainEqual({ active: true, origin: 'plage programmée' });
      expect(toggles).toContainEqual({ active: false, origin: 'manuel' });
    });

    it('refuse de poser ou d’annuler une plage sans jeton CSRF', async () => {
      const put = await api('/api/happy-hour/schedule', {
        method: 'PUT',
        body: JSON.stringify(windowFromNow()),
      });
      const cancel = await api('/api/happy-hour/schedule', { method: 'DELETE' });

      expect(put.status).toBe(403);
      expect(cancel.status).toBe(403);
      expect(await currentSchedule()).toBeNull();
    });
  });

  describe('reprise après arrêt', () => {
    it('restaure le temps restant à l’identique', async () => {
      await notify('channel.subscribe', channelSubscribe);
      const before = (await readPersistedCounter()).remainingMs;

      await application.stop();

      application = build();
      port = await application.start();

      const state = (await (await api('/api/state')).json()) as {
        counter: { remainingMs: number };
      };
      expect(state.counter.remainingMs).toBe(before);
    });

    it('ne décompte pas le temps passé hors ligne', async () => {
      await mutate('/api/counter/resume');
      const before = (await readPersistedCounter()).remainingMs;

      await application.stop();
      await new Promise((resolve) => setTimeout(resolve, 50));

      application = build();
      port = await application.start();

      const state = (await (await api('/api/state')).json()) as {
        counter: { remainingMs: number };
      };
      expect(state.counter.remainingMs).toBe(before);
    });

    it('conserve l’historique entre deux démarrages', async () => {
      await notify('channel.subscribe', channelSubscribe);

      await application.stop();
      application = build();
      port = await application.start();

      const history = (await (await api('/api/history')).json()) as { entries: unknown[] };
      expect(history.entries).toHaveLength(1);
    });
  });

  describe('réglages de souscription changés en cours de route', () => {
    function silentSocket(url: string): EventSubSocket {
      return {
        url,
        onOpen: () => undefined,
        onMessage: () => undefined,
        onClose: () => undefined,
        onError: () => undefined,
        close: () => undefined,
      };
    }

    function patchConfig(config: unknown): Promise<Response> {
      return api('/api/config', {
        method: 'PATCH',
        headers: { [CSRF_HEADER]: application.getCsrfToken() },
        body: JSON.stringify({ config }),
      });
    }

    beforeEach(async () => {
      await application.stop();

      await writeFile(
        join(dataDirectory, 'config.json'),
        JSON.stringify({
          schemaVersion: CONFIG_SCHEMA_VERSION,
          twitch: { broadcasterUserId: '1337', clientId: 'client-de-test' },
        }),
        'utf8',
      );

      seededSecrets = new Map([
        [
          'twitch-credentials',
          JSON.stringify({
            clientSecret: 'secret-de-test',
            accessToken: 'jeton-de-test',
            refreshToken: 'rafraichissement-de-test',
            expiresAt: Date.now() + 3_600_000,
            scopes: ['user:read:chat', 'user:bot', 'channel:read:subscriptions', 'bits:read'],
          }),
        ],
      ]);

      socketFactory = silentSocket;
      openedSocketUrls = [];

      application = build();
      port = await application.start();

      expect(openedSocketUrls).toHaveLength(1);
    });

    it('relance la chaîne Twitch quand on active les commandes de chat', async () => {
      await patchConfig({ twitch: { enableChatCommands: true } });

      await vi.waitFor(() => {
        expect(openedSocketUrls).toHaveLength(2);
      });
    });

    it('ne relance pas la chaîne quand le jeton n’a pas les portées, et le signale', async () => {
      await application.stop();

      seededSecrets = new Map([
        [
          'twitch-credentials',
          JSON.stringify({
            clientSecret: 'secret-de-test',
            accessToken: 'jeton-de-test',
            refreshToken: 'rafraichissement-de-test',
            expiresAt: Date.now() + 3_600_000,
            scopes: ['channel:read:subscriptions', 'bits:read'],
          }),
        ],
      ]);

      openedSocketUrls = [];
      application = build();
      port = await application.start();

      await patchConfig({ twitch: { enableChatCommands: true } });

      await vi.waitFor(async () => {
        const state = (await (await api('/api/state')).json()) as {
          twitch: { missingScopes?: readonly string[] };
        };
        expect(state.twitch.missingScopes).toContain('user:read:chat');
      });

      expect(openedSocketUrls).toHaveLength(1);
    });

    it('ne relance pas la chaîne Twitch quand on change une couleur d’overlay', async () => {
      await patchConfig({ overlay: { color: '#123456' } });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(openedSocketUrls).toHaveLength(1);
    });
  });

  describe('actions manuelles', () => {
    it('met en pause puis reprend', async () => {
      await mutate('/api/counter/resume');
      await mutate('/api/counter/pause');

      expect((await readPersistedCounter()).status).toBe('paused');
    });

    it('ajoute du temps et l’écrit immédiatement', async () => {
      await mutate('/api/counter/add', JSON.stringify({ seconds: 600, reason: 'test' }));

      expect((await readPersistedCounter()).remainingMs).toBe(43_200_000 + 600_000);
    });

    it('injecte un événement de test dans le pipeline complet', async () => {
      const overlay = collect(connectOverlay());
      await overlay.waitFor(() => overlay.ofType('state').length > 0, 'instantané initial');

      await mutate('/api/overlay/test', JSON.stringify({ type: 'sub' }));

      await overlay.waitFor(() => overlay.ofType('event').length > 0, 'événement diffusé');
      const history = (await (await api('/api/history')).json()) as {
        entries: { source: string }[];
      };
      expect(history.entries[0]?.source).toBe('manual');
    });

    it('diffuse le décompte à l’overlay', async () => {
      const overlay = collect(connectOverlay());
      await overlay.waitFor(() => overlay.ofType('state').length > 0, 'instantané initial');

      await mutate('/api/counter/resume');
      ticker.tick();

      await overlay.waitFor(() => overlay.ofType('counter').length > 0, 'diffusion du décompte');
    });
  });

  describe('gardes de sécurité en conditions réelles', () => {
    it('refuse une requête dont le Host n’est pas local', async () => {
      const status = await rawRequestStatus('evil.com', '/api/state', port);

      expect(status).toBe(403);
    });

    it('refuse une mutation sans jeton', async () => {
      const response = await api('/api/counter/reset', { method: 'POST' });

      expect(response.status).toBe(403);
      expect((await readPersistedCounter()).remainingMs).toBe(43_200_000);
    });

    it('sert les en-têtes de sécurité sur une vraie réponse HTTP', async () => {
      const response = await api('/api/state');

      expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('bloque une traversée de chemin', async () => {
      const response = await api('/../config.json');

      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain('schemaVersion');
    });
  });

  describe('secret client Twitch', () => {
    it('s’écrit sans jamais ressortir', async () => {
      await api('/api/config', {
        method: 'PATCH',
        headers: { [CSRF_HEADER]: application.getCsrfToken() },
        body: JSON.stringify({ clientSecret: 'secret-tres-confidentiel' }),
      });

      const config = await (await api('/api/config')).text();
      const exported = await (await api('/api/config/export')).text();
      const onDisk = await readFile(join(dataDirectory, 'config.json'), 'utf8');

      expect(JSON.parse(config)).toMatchObject({ hasClientSecret: true });
      for (const content of [config, exported, onDisk]) {
        expect(content).not.toContain('secret-tres-confidentiel');
      }
    });

    it('n’apparaît pas dans les journaux', async () => {
      await api('/api/config', {
        method: 'PATCH',
        headers: { [CSRF_HEADER]: application.getCsrfToken() },
        body: JSON.stringify({ clientSecret: 'secret-tres-confidentiel' }),
      });

      const logs = await (await api('/api/logs')).text();
      expect(logs).not.toContain('secret-tres-confidentiel');
    });
  });

  describe('flux OAuth', () => {
    async function beginAuthorization(): Promise<string> {
      const response = await mutate('/api/twitch/connect');
      const { authorizationUrl } = (await response.json()) as { authorizationUrl: string };
      const url = new URL(authorizationUrl);

      expect(url.searchParams.get('redirect_uri')).toBe(OAUTH_REDIRECT_URI);

      const state = url.searchParams.get('state');
      expect(state).not.toBeNull();
      return state ?? '';
    }

    it('reconnaît le state qu’il vient d’émettre', async () => {
      const state = await beginAuthorization();

      expect(application.verifyOAuthState(state)).toBe(true);
    });

    it('n’accepte le state qu’une seule fois', async () => {
      const state = await beginAuthorization();

      expect(application.verifyOAuthState(state)).toBe(true);
      expect(application.verifyOAuthState(state)).toBe(false);
    });

    it('refuse un state étranger sans consommer la demande en cours', async () => {
      const state = await beginAuthorization();

      expect(application.verifyOAuthState('b'.repeat(64))).toBe(false);
      expect(application.verifyOAuthState(state)).toBe(true);
    });

    it('refuse tout state quand aucun flux n’est ouvert', () => {
      expect(application.verifyOAuthState('a'.repeat(64))).toBe(false);
    });

    it('annonce l’issue du rappel sur le bus', async () => {
      const state = await beginAuthorization();
      const settled: string[] = [];
      application.bus.on('oauth:settled', (payload) => {
        settled.push(payload.outcome);
      });

      await oauthRouter?.handle(
        makeRequest({ path: '/callback', query: { code: 'abc', state } }),
      );

      expect(settled).toStrictEqual(['failed']);
    });

    it('ouvre le port de rappel pour la durée du flux', async () => {
      expect(oauthEvents).toStrictEqual([]);

      await beginAuthorization();

      expect(oauthEvents).toStrictEqual(['créé', 'démarré']);
    });

    it('referme le port de rappel à l’arrêt de l’application', async () => {
      await beginAuthorization();

      await application.stop();
      expect(oauthEvents).toContain('arrêté');

      application = build();
      port = await application.start();
    });
  });
});
