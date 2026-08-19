import { mkdir } from 'node:fs/promises';

import { evaluateChatMessage } from '../chat/command-service.js';
import { createConfigService, type ConfigService } from '../config/config-service.js';
import { configSchema, type ChronoCastConfig } from '../config/schema.js';
import {
  createCounterService,
  type CounterEventOutcome,
  type CounterService,
  type Ticker,
} from '../counter/counter-service.js';
import type { CounterState } from '../counter/counter-state.js';
import { createDedupCache, type DedupCache } from '../dedup/dedup-cache.js';
import type { DomainEvent } from '../events/domain-event.js';
import {
  createEventHistoryService,
  type EventHistoryService,
} from '../history/event-history-service.js';
import { createLogger, type LogRecord, type LoggerController } from '../logging/logger.js';
import { createRedactor, type Redactor } from '../logging/redaction.js';
import { createConsoleSink } from '../logging/sinks/console-sink.js';
import { createJsonlSink, type JsonlSink } from '../logging/sinks/jsonl-sink.js';
import { createRingBufferSink, type RingBufferSink } from '../logging/sinks/ring-buffer-sink.js';
import { createHttpServer, type HttpServer } from '../server/http-server.js';
import { createLoopbackPair } from '../server/loopback-pair.js';
import { createOAuthCallbackRouter } from '../server/oauth-callback.js';
import {
  createOAuthCallbackServer,
  type ArmableServer,
} from '../server/oauth-callback-server.js';
import { createRouter, type Router } from '../server/router.js';
import { createApiRoutes, type TwitchApiPort } from '../server/routes/api.js';
import { createCustomCssHandler } from '../server/routes/custom-css.js';
import { createPageHandler } from '../server/routes/pages.js';
import { createCsrfToken, verifyCsrfToken } from '../server/security/csrf.js';
import { createStaticHandler } from '../server/static-handler.js';
import { createWsAdapter, type WsAdapter } from '../server/ws-adapter.js';
import { createWsHub, type HubTimers, type WsHub } from '../server/ws-hub.js';
import { createAtomicJsonStore } from '../storage/atomic-json-store.js';
import { createJsonlStore } from '../storage/jsonl-store.js';
import { mapNotification, semanticKey } from '../twitch/event-mapper.js';
import {
  createEventSubClient,
  type EventSubClient,
  type EventSubSocketFactory,
  type NotificationContext,
  type Timers,
} from '../twitch/eventsub-client.js';
import { createHelixClient, type HelixClient } from '../twitch/helix-client.js';
import { createOAuthCompletion } from '../twitch/oauth-completion.js';
import {
  buildAuthorizationUrl,
  createOAuthService,
  type OAuthService,
} from '../twitch/oauth-service.js';
import { requiredScopes, requiresRestart } from '../twitch/subscription-plan.js';
import { createTokenStore, type TokenStore } from '../twitch/token-store.js';
import type { AppEvents, TwitchStatusPayload } from './app-events.js';
import { createEventBus, type EventBus } from './event-bus.js';
import type {
  BrowserOpener,
  Clock,
  PathProvider,
  SecretStore,
  SystemSettingsOpener,
} from './ports.js';

export const OAUTH_REDIRECT_PORT = 37_771;

const OAUTH_REDIRECT_HOST = 'localhost';
export const OAUTH_REDIRECT_URI = `http://${OAUTH_REDIRECT_HOST}:${String(OAUTH_REDIRECT_PORT)}/callback`;

const CLIENT_SECRET_KEY = 'twitch.clientSecret';

const CONFIG_FILE = 'config.json';

const COUNTER_FILE = 'counter.json';

const WS_PATH = '/ws';

export interface Application {
  start(): Promise<number>;

  stop(): Promise<void>;

  getPort(): number | null;

  ingestNotification(context: NotificationContext, payload: unknown): Promise<void>;

  readonly bus: EventBus<AppEvents>;

  readonly config: ConfigService;
  readonly counter: CounterService;
  readonly history: EventHistoryService;

  getCsrfToken(): string;

  verifyOAuthState(state: string): boolean;
}

export interface ApplicationOptions {
  readonly paths: PathProvider;

  readonly secrets: SecretStore;
  readonly clock: Clock;
  readonly browser: BrowserOpener;

  readonly system?: SystemSettingsOpener | undefined;

  readonly ticker: Ticker;
  readonly appVersion: string;

  readonly hubTimers: HubTimers;

  readonly eventSubTimers: Timers;

  readonly createSocket: EventSubSocketFactory;

  readonly fetch: typeof fetch;

  readonly sleep: (ms: number) => Promise<void>;

  readonly oauthTimers?: Timers;

  readonly createOAuthServer?: (router: Router) => ArmableServer;
}

export function createApplication(options: ApplicationOptions): Application {
  const {
    paths,
    secrets,
    clock,
    system,
    ticker,
    appVersion,
    hubTimers,
    eventSubTimers,
    createSocket,
    fetch: fetchImpl,
    sleep,
  } = options;

  const redactor: Redactor = createRedactor();
  const csrfToken = createCsrfToken();

  const ringBuffer: RingBufferSink = createRingBufferSink(500);

  const bootstrapLogger = createLogger({
    level: 'info',
    sinks: [createConsoleSink()],
    redactor,
  });

  const logStore = createJsonlStore<LogRecord>({
    directory: paths.logsDirectory,
    baseName: 'chronocast',
    parse: (raw) => raw as LogRecord,
    logger: bootstrapLogger,
    retentionDays: 14,
  });

  const jsonlSink: JsonlSink = createJsonlSink({
    store: logStore,
    onError: (error) => {
      bootstrapLogger.error('écriture du journal impossible', { cause: error });
    },
  });

  const logger: LoggerController = createLogger({
    level: 'info',
    sinks: [ringBuffer, jsonlSink],
    redactor,
  });

  const scoped = logger.child('app');

  const bus = createEventBus<AppEvents>({
    onHandlerError: (error, type) => {
      scoped.error('abonné du bus en échec', { type, cause: error });
    },
  });

  const configService: ConfigService = createConfigService({
    store: createAtomicJsonStore<ChronoCastConfig>({
      filePath: paths.resolveDataFile(CONFIG_FILE),
      parse: (raw) => configSchema.parse(raw),
      createDefault: () => configSchema.parse({}),
      logger: logger.child('config-store'),
    }),
    logger: logger.child('config'),
  });

  const counterService: CounterService = createCounterService({
    store: createAtomicJsonStore<CounterState | null>({
      filePath: paths.resolveDataFile(COUNTER_FILE),
      parse: (raw) => (raw === null ? null : (raw as CounterState)),
      createDefault: () => null,
      logger: logger.child('counter-store'),
    }),
    getConfig: () => configService.get(),
    clock,
    ticker,
    bus,
    logger: logger.child('counter'),
  });

  const history: EventHistoryService = createEventHistoryService({
    directory: paths.historyDirectory,
    logger,
    retentionDays: 90,
  });

  const tokenStore: TokenStore = createTokenStore({
    secretStore: secrets,
    redactor,
    logger: logger.child('tokens'),
  });

  const oauth: OAuthService = createOAuthService({
    tokenStore,
    clock,
    logger: logger.child('oauth'),
    fetch: fetchImpl,
    getSettings: () => {
      const twitch = configService.get().twitch;
      return {
        idBaseUrl: twitch.idBaseUrl,
        clientId: twitch.clientId,
        redirectUri: OAUTH_REDIRECT_URI,
        scopes: requiredScopes(twitch),
      };
    },
  });

  const helix: HelixClient = createHelixClient({
    getSettings: () => {
      const twitch = configService.get().twitch;
      return { helixBaseUrl: twitch.helixBaseUrl, clientId: twitch.clientId };
    },
    getAccessToken: () => oauth.getAccessToken(),
    logger: logger.child('helix'),
    fetch: fetchImpl,
    sleep,
    maxAttempts: 3,
  });

  let eventSub: EventSubClient | null = null;
  let twitchStatus: TwitchStatusPayload = { status: 'disconnected' };
  let twitchMissingScopes: readonly string[] = [];
  let pendingOAuthState: string | null = null;

  function verifyOAuthState(state: string): boolean {
    if (pendingOAuthState === null) {
      return false;
    }
    if (!verifyCsrfToken(pendingOAuthState, state)) {
      return false;
    }
    pendingOAuthState = null;
    return true;
  }

  bus.on('twitch:status', (payload) => {
    twitchStatus = payload;
  });

  let messageDedup: DedupCache | null = null;
  let semanticDedup: DedupCache | null = null;

  async function applyDomainEvent(event: DomainEvent): Promise<CounterEventOutcome> {
    const outcome = await counterService.applyEvent(event);
    await history.record(event, outcome.reward, outcome.state);
    return outcome;
  }

  async function ingestNotification(
    context: NotificationContext,
    payload: unknown,
  ): Promise<void> {
    const pipeline = logger.child('pipeline');
    const now = clock.now();

    if (messageDedup === null || semanticDedup === null) {
      pipeline.warning('notification reçue avant le démarrage : ignorée');
      return;
    }

    if (!messageDedup.admit(context.messageId, now)) {
      pipeline.debug('notification déjà traitée', { messageId: context.messageId });
      return;
    }

    if (context.subscriptionType === 'channel.chat.message') {
      const outcome = evaluateChatMessage(
        { messageId: context.messageId, receivedAt: context.receivedAt },
        payload,
        configService.get(),
      );

      if (outcome.kind === 'ignored') {
        if (outcome.refused) {
          pipeline.info('commande de chat refusée', { reason: outcome.reason });
        } else {
          pipeline.debug('message de chat sans effet', { reason: outcome.reason });
        }
        return;
      }

      // Une action d'état ne crédite rien : ni récompense, ni ligne d'historique.
      if (outcome.kind === 'action') {
        const state =
          outcome.action === 'pause' ? await counterService.pause() : await counterService.resume();

        pipeline.info('compteur piloté depuis le chat', {
          action: outcome.action,
          status: state.status,
        });
        return;
      }

      await applyDomainEvent(outcome.event);
      return;
    }

    const mapped = mapNotification(
      {
        messageId: context.messageId,
        receivedAt: context.receivedAt,
        subscriptionType: context.subscriptionType,
      },
      payload,
    );

    if (mapped.kind === 'ignored') {
      pipeline.debug('notification ignorée', { reason: mapped.reason });
      return;
    }

    if (mapped.kind === 'invalid') {
      pipeline.warning('notification non conforme', {
        reason: mapped.reason,
        subscriptionType: context.subscriptionType,
      });
      return;
    }

    if (!semanticDedup.admit(semanticKey(mapped.event), now)) {
      pipeline.debug('événement déjà crédité par une autre source', { eventId: mapped.event.id });
      return;
    }

    await applyDomainEvent(mapped.event);
  }

  let httpServer: HttpServer | null = null;
  const currentPort = (): number => httpServer?.getPort() ?? 0;

  const currentWsPort = (): number => currentPort();

  const hub: WsHub = createWsHub({
    bus,
    getConfig: () => configService.get(),
    getSnapshot: () => ({ counter: counterService.getState(), twitch: composeTwitchStatus() }),
    clock,
    timers: hubTimers,
    getPort: currentPort,
    getWsPort: currentWsPort,
    appVersion,
    logger,
  });

  async function stopTwitch(): Promise<void> {
    if (eventSub !== null) {
      await eventSub.stop();
      eventSub = null;
    }
  }

  function composeTwitchStatus(): TwitchStatusPayload {
    return { ...twitchStatus, missingScopes: twitchMissingScopes };
  }

  // Une portée est accordée par Twitch au moment de l'autorisation : aucun redémarrage ne peut
  // l'ajouter à un jeton déjà émis, seule une reconnexion le peut.
  async function refreshMissingScopes(): Promise<readonly string[]> {
    const credentials = await tokenStore.load();
    twitchMissingScopes = credentials === null ? [] : oauth.findMissingScopes(credentials.scopes);
    return twitchMissingScopes;
  }

  async function restartTwitch(): Promise<void> {
    await stopTwitch();
    await startTwitch();
  }

  let twitchRestarting = false;
  let twitchRestartPending = false;

  // Lu à travers un accesseur : le drapeau est armé pendant l'await, ce que l'analyse de flux
  // ne peut pas voir depuis la boucle.
  function isTwitchRestartPending(): boolean {
    return twitchRestartPending;
  }

  // onChange est synchrone et restartTwitch ne l'est pas : deux PATCH rapprochés lanceraient
  // deux redémarrages concurrents sur le même client EventSub.
  function scheduleTwitchRestart(): void {
    if (twitchRestarting) {
      twitchRestartPending = true;
      return;
    }

    twitchRestarting = true;

    void (async () => {
      try {
        do {
          twitchRestartPending = false;

          const missing = await refreshMissingScopes();
          if (missing.length > 0) {
            // Relancer avec un jeton dépourvu de la portée recréerait une souscription vouée au
            // même échec, au prix d'une coupure en plein direct.
            scoped.warning('portées Twitch manquantes : reconnexion nécessaire', {
              missingScopes: missing,
            });
            continue;
          }

          scoped.info('réglages de souscription modifiés : redémarrage de la chaîne Twitch');
          await restartTwitch();
        } while (isTwitchRestartPending());
      } catch (error: unknown) {
        scoped.error('redémarrage de la chaîne Twitch impossible', { cause: error });
      } finally {
        twitchRestarting = false;
      }
    })();
  }

  const completeOAuth = createOAuthCompletion({
    exchangeCode: (code, clientSecret) => oauth.exchangeCode(code, clientSecret),
    validate: (accessToken) => oauth.validate(accessToken),
    findMissingScopes: (granted) => oauth.findMissingScopes(granted),
    readClientSecret: () => secrets.read(CLIENT_SECRET_KEY),
    getBroadcaster: () => {
      const twitch = configService.get().twitch;
      return { userId: twitch.broadcasterUserId, login: twitch.broadcasterLogin };
    },
    updateBroadcaster: async (identity) => {
      await configService.update({
        twitch: { broadcasterUserId: identity.userId, broadcasterLogin: identity.login },
      });
    },
    restartTwitch,
    logger,
  });

  const oauthCallbackServer = createOAuthCallbackServer({
    router: createOAuthCallbackRouter({
      verifyState: (state) => verifyOAuthState(state),
      complete: (code) => completeOAuth(code),
      getAppPort: () => httpServer?.getPort() ?? null,
      onSettled: (outcome) => {
        void oauthCallbackServer.disarm().catch((error: unknown) => {
          logger.error('fermeture du port de rappel impossible', { cause: error });
        });

        bus.emit('oauth:settled', { outcome });
      },
      logger,
    }),
    createServer:
      options.createOAuthServer ??
      ((router) =>
        createLoopbackPair({
          createFor: (host) =>
            createHttpServer({
              router,
              host,
              port: OAUTH_REDIRECT_PORT,
              portFallbackAttempts: 0,
              maxBodyBytes: 4_096,
              logger,
            }),
        })),
    timers: options.oauthTimers ?? options.eventSubTimers,
    logger,
  });

  const twitchApi: TwitchApiPort = {
    getStatus: () => composeTwitchStatus(),

    async describe() {
      const twitch = configService.get().twitch;
      const credentials = await tokenStore.load();
      const clientSecret = await secrets.read(CLIENT_SECRET_KEY);
      const granted = credentials?.scopes ?? [];

      return {
        broadcasterLogin: twitch.broadcasterLogin,
        clientId: twitch.clientId,
        hasClientSecret: clientSecret !== null,
        connected: credentials !== null,
        scopes: granted,
        missingScopes: oauth.findMissingScopes(granted),
      };
    },

    async startAuthorization() {
      const twitch = configService.get().twitch;

      await oauthCallbackServer.arm();

      const state = createCsrfToken();
      pendingOAuthState = state;

      return {
        authorizationUrl: buildAuthorizationUrl({
          idBaseUrl: twitch.idBaseUrl,
          clientId: twitch.clientId,
          redirectUri: OAUTH_REDIRECT_URI,
          scopes: requiredScopes(twitch),
          state,
          forceVerify: true,
        }),
      };
    },

    async revoke() {
      await oauth.revoke();
      await secrets.delete(CLIENT_SECRET_KEY);
      await stopTwitch();
    },

    async listSubscriptions() {
      const subscriptions = await helix.listEventSubSubscriptions();
      return subscriptions.map((subscription) => ({
        id: subscription.id,
        type: subscription.type,
        status: subscription.status,
      }));
    },

    async setClientSecret(secret: string) {
      redactor.registerSecret(secret);
      await secrets.write(CLIENT_SECRET_KEY, secret);
    },
  };

  const staticHandler = createStaticHandler({
    rootDirectory: paths.webRootDirectory,
    logger,
  });

  const router = createRouter({
    routes: createApiRoutes({
      config: configService,
      counter: counterService,
      history,
      logs: ringBuffer,
      twitch: twitchApi,
      system,
      getPort: currentPort,
      appVersion,
      applyManualEvent: (event) => applyDomainEvent(event),
      logger,
    }),
    pageHandler: createPageHandler({
      staticHandler,
      getCsrfToken: () => csrfToken,
      getWsPort: currentWsPort,
      isSetupCompleted: () => configService.get().setup.completed,
    }),
    customCssHandler: createCustomCssHandler({
      dataDirectory: paths.dataDirectory,
      isEnabled: () => configService.get().overlay.enableCustomCss,
      logger,
    }),
    staticHandler,
    getCsrfToken: () => csrfToken,
    logger,
  });

  const wsAdapter: WsAdapter = createWsAdapter({
    hub,
    logger,
    path: WS_PATH,
    maxPayloadBytes: 4_096,
  });

  async function startTwitch(): Promise<void> {
    const twitch = configService.get().twitch;
    const credentials = await tokenStore.load();

    if (credentials === null || twitch.broadcasterUserId === '') {
      twitchMissingScopes = [];
      scoped.info('Twitch non configuré : le compteur fonctionne sans événements');
      return;
    }

    // La chaîne démarre malgré tout : les souscriptions dont les portées sont accordées
    // fonctionnent, et priver le streamer du décompte des abonnements serait pire que le défaut.
    twitchMissingScopes = oauth.findMissingScopes(credentials.scopes);
    if (twitchMissingScopes.length > 0) {
      scoped.warning('portées Twitch manquantes : reconnexion nécessaire', {
        missingScopes: twitchMissingScopes,
      });
    }

    const validation = await oauth.validate(credentials.accessToken).catch(() => null);

    eventSub = createEventSubClient({
      getConfig: () => configService.get(),
      helix,
      createSocket,
      timers: eventSubTimers,
      bus,
      logger: logger.child('eventsub'),
      identity: {
        broadcasterUserId: twitch.broadcasterUserId,
        userId: validation?.userId ?? twitch.broadcasterUserId,
      },
      onNotification: (context, payload) => {
        void ingestNotification(context, payload).catch((error: unknown) => {
          scoped.error('événement non traité', { cause: error });
        });
      },
    });

    await eventSub.start();
  }

  return {
    bus,
    config: configService,
    counter: counterService,
    history,

    getCsrfToken: () => csrfToken,
    getPort: currentPort,

    verifyOAuthState,

    ingestNotification,

    async start(): Promise<number> {
      await mkdir(paths.dataDirectory, { recursive: true });
      await mkdir(paths.logsDirectory, { recursive: true });
      await mkdir(paths.historyDirectory, { recursive: true });

      const config = await configService.load();

      await configService.update({});

      logger.setLevel(config.logging.level);
      if (config.logging.console) {
        logger.addSink(createConsoleSink());
      }

      logger.addSink({
        name: 'ws',
        write: (record) => {
          hub.publishLog(record);
        },
      });

      messageDedup = createDedupCache({
        maxEntries: config.history.dedupCacheSize,
        ttlMs: config.history.dedupTtlMs,
      });

      semanticDedup = createDedupCache({
        maxEntries: config.history.dedupCacheSize,
        ttlMs: config.history.crossSourceWindowMs,
      });

      // onChange ne reçoit que la configuration nouvelle : l'ancienne se conserve ici pour
      // pouvoir comparer.
      let previousTwitch = configService.get().twitch;

      configService.onChange(() => {
        logger.setLevel(configService.get().logging.level);
        hub.publishConfig();

        const nextTwitch = configService.get().twitch;
        const restartNeeded = requiresRestart(previousTwitch, nextTwitch);
        previousTwitch = nextTwitch;

        if (restartNeeded) {
          scheduleTwitchRestart();
        }
      });

      await counterService.start();
      hub.start();

      httpServer = createHttpServer({
        router,
        host: config.server.host,
        port: config.server.httpPort,
        portFallbackAttempts: config.server.portFallbackAttempts,
        maxBodyBytes: config.server.maxBodyBytes,
        logger,
        onUpgrade: wsAdapter.handleUpgrade,
      });

      const port = await httpServer.start();

      await startTwitch().catch((error: unknown) => {
        scoped.error('chaîne Twitch non démarrée', { cause: error });
      });

      scoped.info('ChronoCast démarré', {
        port,
        overlay: `http://${config.server.host}:${String(port)}/overlay`,
      });

      return port;
    },

    async stop(): Promise<void> {
      await oauthCallbackServer.disarm();
      await stopTwitch();
      await wsAdapter.close();
      hub.stop();
      await httpServer?.stop();
      httpServer = null;
      await counterService.stop();

      await jsonlSink.flush();
    },
  };
}

export type { NotificationContext };
