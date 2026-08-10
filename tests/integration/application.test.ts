import { request as httpRequest, type IncomingMessage } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import {
  createApplication,
  OAUTH_REDIRECT_URI,
  type Application,
} from '../../src/core/app/application.js';
import type { SecretStore } from '../../src/core/app/ports.js';
import { createSystemClock } from '../../src/core/app/system-clock.js';
import type { Ticker } from '../../src/core/counter/counter-service.js';
import type { Router } from '../../src/core/server/router.js';
import { CSRF_HEADER } from '../../src/core/server/security/csrf.js';
import { makeRequest } from '../helpers/http-request.js';
import {
  channelCheer,
  channelSubscribe,
  channelSubscribeGifted,
  channelSubscriptionGift,
  chatMessageModeratorAddTime,
  chatMessageModeratorNotANumber,
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

function createMemorySecretStore(): SecretStore {
  const entries = new Map<string, string>();
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
  let legacyDataDirectory: string | undefined;

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
      ...(legacyDataDirectory === undefined ? {} : { legacyDataDirectory }),
      secrets: createMemorySecretStore(),
      clock: createSystemClock(),
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
      createSocket: () => {
        throw new Error('aucune socket EventSub ne doit être ouverte dans ces tests');
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
    legacyDataDirectory = undefined;
    oauthEvents = [];
    appFetch = () => Promise.reject(new Error('aucun accès réseau dans ces tests'));
    oauthRouter = null;
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
    if (legacyDataDirectory !== undefined) {
      await rm(legacyDataDirectory, { recursive: true, force: true });
    }
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

      expect(JSON.parse(raw)).toMatchObject({ schemaVersion: 1 });
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
      await notify('channel.cheer', channelCheer);

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

  describe('reprise d’une installation précédente', () => {
    it('retrouve compteur et historique écrits à l’ancien emplacement', async () => {
      await notify('channel.subscribe', channelSubscribe);
      const before = (await readPersistedCounter()).remainingMs;
      await application.stop();

      legacyDataDirectory = dataDirectory;
      dataDirectory = await mkdtemp(join(tmpdir(), 'chronocast-app-store-'));

      application = build();
      port = await application.start();

      const state = (await (await api('/api/state')).json()) as {
        counter: { remainingMs: number };
      };
      expect(state.counter.remainingMs).toBe(before);

      const history = (await (await api('/api/history')).json()) as { entries: unknown[] };
      expect(history.entries).toHaveLength(1);
    });

    it('ne réimpose pas l’ancien compteur à une installation qui a déjà tourné', async () => {
      await notify('channel.subscribe', channelSubscribe);
      const legacyRemaining = (await readPersistedCounter()).remainingMs;
      await application.stop();

      const previous = dataDirectory;
      dataDirectory = await mkdtemp(join(tmpdir(), 'chronocast-app-store-'));
      application = build();
      port = await application.start();
      const ownRemaining = (await readPersistedCounter()).remainingMs;
      await application.stop();

      expect(ownRemaining).not.toBe(legacyRemaining);
      legacyDataDirectory = previous;
      application = build();
      port = await application.start();

      const state = (await (await api('/api/state')).json()) as {
        counter: { remainingMs: number };
      };
      expect(state.counter.remainingMs).toBe(ownRemaining);
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
