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
import { sha256Hex } from '../../src/core/update/digest.js';
import { makeRequest } from '../helpers/http-request.js';
import {
  channelCheer,
  channelSubscribe,
  channelSubscribeGifted,
  channelSubscriptionGift,
  chatNotificationSubPrime,
} from '../fixtures/eventsub-payloads.js';

/**
 * Ce fichier est ce qui valide la Phase 4.
 *
 * Il ne teste aucun module en particulier : il démarre l'**application entière**
 * — configuration, journaux, compteur, historique, serveur HTTP, hub WebSocket,
 * pipeline de déduplication — lui injecte des notifications EventSub réelles, et
 * observe ce que le streamer verrait.
 *
 * Rien n'y touche le réseau. La socket EventSub et `fetch` sont des doubles, les
 * données vont dans un répertoire temporaire, et la seule vraie connexion est un
 * WebSocket vers `127.0.0.1` — celui-là même qu'OBS ouvrira.
 *
 * Les scénarios sont ceux dont dépend la crédibilité du produit : l'événement qui
 * crédite, la retransmission qui ne recrédite pas, le don annoncé deux fois qui
 * ne compte qu'une, le Prime vu par deux flux, et surtout le redémarrage — parce
 * qu'un compteur qui repart de zéro après un crash n'a aucune valeur.
 */

/** Cadenceur manuel : les tests décident quand le temps passe. */
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

/** Magasin de secrets en mémoire : aucun chiffrement à éprouver ici. */
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

/**
 * Requête HTTP brute, en maîtrisant l'en-tête `Host`.
 *
 * `fetch` refuse de le fixer : c'est un en-tête protégé, que la couche cliente
 * écrase. Or c'est exactement celui que la garde anti-rebinding examine, et un
 * attaquant, lui, n'utilise pas `fetch`.
 */
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

/** Collecte les messages d'un client WebSocket réel. */
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
  /** Trace du serveur de rappel OAuth, remplacé par un double. */
  let oauthEvents: string[] = [];
  /** Routeur du rappel, capturé au passage : il est piloté directement. */
  let oauthRouter: Router | null = null;
  /**
   * `fetch` de la mise à jour, remplacé par les seuls tests qui en ont besoin.
   *
   * Partout ailleurs il refuse : aucun test ne doit toucher au réseau, et un
   * appel non prévu doit se voir plutôt que de partir vers GitHub.
   */
  let updateFetch: typeof fetch = () => Promise.reject(new Error('aucun accès réseau dans ces tests'));
  /** Chemins passés au port d'installation. Vide signifie « rien n'a été lancé ». */
  let installerLaunches: string[] = [];

  /** Construit une application sur le répertoire de données courant. */
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
      secrets: createMemorySecretStore(),
      clock: createSystemClock(),
      browser: { open: () => Promise.resolve() },
      ticker,
      // Une version réellement bien formée, et non un `0.1.0-test` : la
      // sélection de mise à jour refuse par construction tout ce qui n'est pas
      // un `X.Y.Z` strict — ne pas comprendre sa propre version et mettre à
      // jour quand même reviendrait à accepter n'importe quel artefact.
      appVersion: '0.1.0',
      hubTimers: {
        // Aucun battement réel : la vivacité est testée dans `ws-hub.test.ts`.
        setInterval: () => 0,
        clearInterval: () => undefined,
      },
      eventSubTimers: {
        setTimeout: () => 0,
        clearTimeout: () => undefined,
      },
      // Le port 37771 est fixe et imposé par Twitch : l'ouvrir réellement
      // ferait échouer deux tests exécutés en parallèle sur la même machine.
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
      fetch: (input, init) => updateFetch(input, init),
      sleep: () => Promise.resolve(),
      updateInstaller: {
        run: (path) => {
          installerLaunches.push(path);
          return Promise.resolve();
        },
      },
    });
  }

  /** Injecte une notification EventSub comme le ferait le client. */
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

  /** Requête mutante, jeton compris. */
  function mutate(path: string, body?: string): Promise<Response> {
    return api(path, {
      method: 'POST',
      headers: { [CSRF_HEADER]: application.getCsrfToken() },
      ...(body === undefined ? {} : { body }),
    });
  }

  beforeEach(async () => {
    dataDirectory = await mkdtemp(join(tmpdir(), 'chronocast-app-'));
    oauthEvents = [];
    installerLaunches = [];
    updateFetch = () => Promise.reject(new Error('aucun accès réseau dans ces tests'));
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
  });

  function connectOverlay(): WebSocket {
    const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/ws`);
    sockets.push(socket);
    return socket;
  }

  /** Lit l'état persisté sur le disque, tel qu'il serait relu au redémarrage. */
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
      // Cas d'une installation neuve : rien ne crédite le compteur, mais tout le
      // reste fonctionne. C'est ce qui permet à l'assistant de s'ouvrir.
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

      // 1 — le compteur a monté.
      const state = (await (await api('/api/state')).json()) as {
        counter: { remainingMs: number };
      };
      expect(state.counter.remainingMs).toBe(43_200_000 + 180_000);

      // 2 — l'état est écrit tout de suite : une mutation ne peut pas attendre
      // la prochaine sauvegarde périodique, sinon un crash l'effacerait.
      expect((await readPersistedCounter()).remainingMs).toBe(43_380_000);

      // 3 — l'historique en garde la trace et l'explication.
      const history = (await (await api('/api/history')).json()) as {
        entries: { type: string; rewardSeconds: number; applied: boolean }[];
      };
      expect(history.entries[0]).toMatchObject({
        type: 'sub',
        rewardSeconds: 180,
        applied: true,
      });

      // 4 — l'overlay l'a reçu.
      await overlay.waitFor(() => overlay.ofType('counter').length > 0, 'diffusion du compteur');
      expect(overlay.ofType('event')).toHaveLength(1);
    });

    it('ignore le rejeu du même message_id', async () => {
      await notify('channel.subscribe', channelSubscribe, 'msg-identique');
      await notify('channel.subscribe', channelSubscribe, 'msg-identique');

      const state = (await (await api('/api/state')).json()) as {
        counter: { remainingMs: number };
      };

      // Twitch retransmet : sans cette garde, chaque retransmission serait un
      // abonnement de plus.
      expect(state.counter.remainingMs).toBe(43_200_000 + 180_000);
    });

    it('ne crédite un don d’abonnements qu’une seule fois', async () => {
      // Twitch annonce le don deux fois : `channel.subscription.gift` au
      // donateur, puis un `channel.subscribe` avec `is_gift: true` par
      // bénéficiaire. Les compter tous deux doublerait la récompense.
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
      // `channel.subscribe` et `channel.chat.notification` décrivent le même
      // abonnement. La clé sémantique assimile Prime et Tier 1 précisément pour
      // attraper ce doublon-là.
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

      // Aucun crédit, mais surtout : le serveur répond encore.
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
      // Mode gel : un crash nocturne ne doit rien coûter au streamer. C'est la
      // décision d'architecture la plus visible pour l'utilisateur final.
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
      // `fetch` interdit de fixer l'en-tête `Host` : c'est un en-tête protégé,
      // que la couche cliente écrase silencieusement. Il faut donc passer par
      // `node:http` — ce que fait précisément un attaquant, et ce que fait un
      // navigateur victime de rebinding DNS.
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

      // Une fois déclaré au rédacteur, le secret est masqué partout — y compris
      // s'il se retrouve au milieu d'un message d'erreur.
      const logs = await (await api('/api/logs')).text();
      expect(logs).not.toContain('secret-tres-confidentiel');
    });
  });

  describe('flux OAuth', () => {
    /** Déclenche un flux et rend le `state` que Twitch devra renvoyer. */
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
      // Un `state` rejouable autoriserait le rejeu d'un rappel déjà consommé.
      const state = await beginAuthorization();

      expect(application.verifyOAuthState(state)).toBe(true);
      expect(application.verifyOAuthState(state)).toBe(false);
    });

    it('refuse un state étranger sans consommer la demande en cours', async () => {
      // N'importe quelle page distante peut provoquer une navigation vers la
      // boucle locale. Si un `state` erroné consommait la demande, le premier
      // venu ferait échouer la connexion du streamer, à distance et en boucle.
      const state = await beginAuthorization();

      expect(application.verifyOAuthState('b'.repeat(64))).toBe(false);
      expect(application.verifyOAuthState(state)).toBe(true);
    });

    it('refuse tout state quand aucun flux n’est ouvert', () => {
      expect(application.verifyOAuthState('a'.repeat(64))).toBe(false);
    });

    it('annonce l’issue du rappel sur le bus', async () => {
      // C'est par là que la coquille Electron ramène sa fenêtre au premier
      // plan. Sans cet événement, l'utilisateur termine sa configuration dans
      // le navigateur pendant que la fenêtre reste à l'étape précédente — et
      // c'est exactement ce qui se passait avant cette correction.
      const state = await beginAuthorization();
      const settled: string[] = [];
      application.bus.on('oauth:settled', (payload) => {
        settled.push(payload.outcome);
      });

      // L'échange échouera : ces tests n'ont aucun accès réseau. C'est bien la
      // situation à couvrir — un échec doit ramener la fenêtre autant qu'une
      // réussite, sans quoi l'utilisateur reste devant un assistant muet.
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
      // Un port laissé ouvert après extinction est une surface offerte pour
      // rien : plus personne n'attend de rappel.
      await beginAuthorization();

      await application.stop();
      expect(oauthEvents).toContain('arrêté');

      // Reconstruite pour que le démontage global, qui arrête l'application,
      // travaille sur une instance vivante.
      application = build();
      port = await application.start();
    });
  });
  describe('mise à jour automatique', () => {
    const INSTALLER = 'ChronoCast-Setup-9.9.9.exe';
    const BYTES = new TextEncoder().encode('MZ ceci est un installeur');

    /**
     * `fetch` scénarisé sur les trois appels du service.
     *
     * `digest` est passé en paramètre pour que le scénario de l'empreinte
     * discordante ne diffère du scénario nominal que par cette seule valeur —
     * c'est exactement la différence qu'on veut voir.
     */
    function serveRelease(digest: string): typeof fetch {
      const base = 'https://github.com/thedevopser/ChronoCast/releases/download/v9.9.9';

      return ((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

        if (url.startsWith('https://api.github.com/')) {
          return Promise.resolve(
            Response.json({
              tag_name: 'v9.9.9',
              html_url: 'https://github.com/thedevopser/ChronoCast/releases/tag/v9.9.9',
              draft: false,
              prerelease: false,
              assets: [
                {
                  name: INSTALLER,
                  size: 100_663_296,
                  browser_download_url: `${base}/${INSTALLER}`,
                },
                {
                  name: `${INSTALLER}.sha256`,
                  size: 91,
                  browser_download_url: `${base}/${INSTALLER}.sha256`,
                },
              ],
            }),
          );
        }

        if (url.endsWith('.sha256')) {
          return Promise.resolve(new Response(`${digest}  ${INSTALLER}\n`));
        }

        return Promise.resolve(new Response(BYTES));
      });
    }

    it('télécharge, vérifie et propose la version publiée', async () => {
      updateFetch = serveRelease(sha256Hex(BYTES));

      const status = (await (await mutate('/api/update/check')).json()) as { phase: string };

      expect(status.phase).toBe('ready');
      expect((await (await api('/api/update')).json())).toMatchObject({
        phase: 'ready',
        availableVersion: '9.9.9',
      });
    });

    it('écrit l’installeur vérifié dans le répertoire de données', async () => {
      updateFetch = serveRelease(sha256Hex(BYTES));

      await mutate('/api/update/check');

      const written = await readFile(join(dataDirectory, 'updates', INSTALLER));
      expect(new Uint8Array(written)).toStrictEqual(BYTES);
    });

    it('lance l’installeur vérifié à la demande', async () => {
      updateFetch = serveRelease(sha256Hex(BYTES));
      await mutate('/api/update/check');

      const response = await mutate('/api/update/install');

      expect(response.status).toBe(204);
      expect(installerLaunches).toStrictEqual([join(dataDirectory, 'updates', INSTALLER)]);
    });

    it('ne lance rien et n’écrit rien quand l’empreinte ne correspond pas', async () => {
      // Le scénario central du lot. L'installeur n'est pas signé et le fichier
      // téléchargé ne portera aucune *Mark of the Web* : Windows le lancerait
      // sans la moindre invite. Cette vérification est le seul contrôle qui
      // existe sur ce chemin.
      updateFetch = serveRelease('ab'.repeat(32));

      await mutate('/api/update/check');

      expect((await (await api('/api/update')).json())).toMatchObject({ phase: 'error' });
      await expect(readFile(join(dataDirectory, 'updates', INSTALLER))).rejects.toThrow();

      expect((await mutate('/api/update/install')).status).toBe(409);
      expect(installerLaunches).toStrictEqual([]);
    });

    it('n’émet aucune requête quand le réglage est décoché', async () => {
      updateFetch = () => {
        throw new Error('aucune requête ne doit partir quand le réglage est décoché');
      };

      await api('/api/config', {
        method: 'PATCH',
        headers: { [CSRF_HEADER]: application.getCsrfToken(), 'content-type': 'application/json' },
        body: JSON.stringify({ config: { app: { checkForUpdates: false } } }),
      });

      const status = (await (await mutate('/api/update/check')).json()) as { phase: string };

      expect(status.phase).toBe('disabled');
    });
  });
});
