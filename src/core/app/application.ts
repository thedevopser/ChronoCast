/**
 * Composition root de ChronoCast.
 *
 * C'est le seul fichier qui connaît tout le monde. Partout ailleurs, chaque module
 * ne connaît que ses dépendances déclarées, ce qui les rend testables un à un ;
 * ici, on paie cette liberté en assemblant explicitement la chaîne complète.
 *
 * Le pipeline qu'il câble est la raison d'être de tout le reste :
 *
 * ```
 * EventSubClient.onNotification
 *   → déduplication sur message_id      (Twitch retransmet)
 *   → mapNotification                   (vocabulaire métier)
 *   → déduplication sur semanticKey     (deux flux décrivent le même fait)
 *   → CounterService.applyEvent         (barème, persistance, bus)
 *   → EventHistoryService               (journal)
 *   → WsHub                             (diffusion à l'overlay)
 * ```
 *
 * Les deux déduplications ne font pas double emploi. La première écarte la
 * **retransmission** du même message par Twitch ; la seconde écarte le même
 * **fait** annoncé par deux flux différents — `channel.subscribe` et
 * `channel.chat.notification` décrivent le même abonnement, et sans elle un
 * Prime serait crédité deux fois.
 *
 * L'ordre de démarrage est lui aussi choisi : compteur, hub, serveur HTTP, puis
 * Twitch en dernier et sans bloquer. Une panne côté Twitch ne doit empêcher ni
 * l'overlay de s'afficher, ni le panneau de s'ouvrir — c'est précisément dans ce
 * cas-là que le streamer a besoin de les consulter.
 *
 * Tout ce qui dépend de la plateforme arrive par les ports. Ce fichier n'importe
 * donc pas `electron`, et l'application entière démarre dans un Node nu — c'est
 * ce qui rend les tests d'intégration possibles en conteneur Linux alors que la
 * cible est Windows.
 */

import { mkdir } from 'node:fs/promises';

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
import { createOAuthCallbackRouter } from '../server/oauth-callback.js';
import {
  createOAuthCallbackServer,
  type ArmableServer,
} from '../server/oauth-callback-server.js';
import { createRouter, type Router } from '../server/router.js';
import { createApiRoutes, type TwitchApiPort } from '../server/routes/api.js';
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
import { requiredScopes } from '../twitch/subscription-plan.js';
import { createTokenStore, type TokenStore } from '../twitch/token-store.js';
import type { AppEvents, TwitchStatusPayload } from './app-events.js';
import { createEventBus, type EventBus } from './event-bus.js';
import type { BrowserOpener, Clock, PathProvider, SecretStore } from './ports.js';

/**
 * Port fixe du serveur de rappel OAuth.
 *
 * Twitch exige une correspondance **exacte** entre l'URL de redirection déclarée
 * dans la console développeur et celle envoyée à l'autorisation. Le port HTTP
 * applicatif étant configurable — et susceptible de basculer sur un repli — il ne
 * peut pas servir : d'où ce port dédié, fixe, ouvert le temps du flux seulement.
 * Le serveur qui l'écoute arrive en Phase 5.
 */
export const OAUTH_REDIRECT_PORT = 37_771;
export const OAUTH_REDIRECT_URI = `http://127.0.0.1:${String(OAUTH_REDIRECT_PORT)}/callback`;

/** Clé du secret client dans le magasin chiffré. */
const CLIENT_SECRET_KEY = 'twitch.clientSecret';

const CONFIG_FILE = 'config.json';
const COUNTER_FILE = 'counter.json';

/** Chemin du WebSocket. Doit rester stable : il finit collé dans OBS. */
const WS_PATH = '/ws';

export interface Application {
  /** Démarre l'application et renvoie le port HTTP réellement retenu. */
  start(): Promise<number>;

  /** Arrête proprement : fermeture des sockets, du serveur, puis vidange des journaux. */
  stop(): Promise<void>;

  getPort(): number | null;

  /**
   * Point d'entrée du pipeline d'événements.
   *
   * Exposé parce que deux appelants légitimes en ont besoin : le client EventSub,
   * qui y branche ses notifications, et les tests d'intégration, qui vérifient la
   * chaîne complète sans réseau.
   */
  ingestNotification(context: NotificationContext, payload: unknown): Promise<void>;

  /** Bus applicatif, exposé pour la coquille Electron et pour l'observation. */
  readonly bus: EventBus<AppEvents>;

  readonly config: ConfigService;
  readonly counter: CounterService;
  readonly history: EventHistoryService;

  /** Jeton anti-CSRF de la session en cours. */
  getCsrfToken(): string;

  /**
   * Consomme le `state` OAuth engendré par le dernier appel à `connect`.
   *
   * Usage unique : le rendre une seconde fois permettrait de rejouer un rappel.
   * Le serveur de la Phase 5 le comparera à celui que Twitch lui renvoie.
   */
  /**
   * Vérifie le `state` renvoyé par Twitch, en temps constant.
   *
   * Ne consomme la demande en cours qu'en cas de correspondance : un `state`
   * erroné ne doit pas pouvoir clore un flux légitime, sans quoi n'importe
   * quelle page distante ferait échouer la connexion du streamer en provoquant
   * une navigation vers la boucle locale.
   */
  verifyOAuthState(state: string): boolean;
}

export interface ApplicationOptions {
  readonly paths: PathProvider;
  readonly secrets: SecretStore;
  readonly clock: Clock;
  readonly browser: BrowserOpener;
  readonly ticker: Ticker;
  readonly appVersion: string;

  /** Minuteurs du hub WebSocket. Injectés pour que les tests n'attendent rien. */
  readonly hubTimers: HubTimers;

  /** Minuteurs du client EventSub. */
  readonly eventSubTimers: Timers;

  /** Fabrique de sockets EventSub. Remplacée par un double dans les tests. */
  readonly createSocket: EventSubSocketFactory;

  /** Implémentation de `fetch`. Remplacée dans les tests : aucun accès réseau. */
  readonly fetch: typeof fetch;

  /** Temporisation entre deux tentatives Helix. Injectée pour ne rien attendre en test. */
  readonly sleep: (ms: number) => Promise<void>;

  /**
   * Minuteurs du serveur de rappel OAuth. À défaut, ceux d'EventSub.
   *
   * Facultatif parce que ce serveur n'existe que pendant le flux
   * d'autorisation : aucun test qui ne le déclenche pas n'a à s'en soucier.
   */
  readonly oauthTimers?: Timers;

  /**
   * Fabrique du serveur de rappel OAuth.
   *
   * Remplacée par un double dans les tests : le port 37771 est fixe et imposé
   * par Twitch, l'ouvrir réellement ferait échouer deux suites exécutées en
   * parallèle sur la même machine.
   */
  readonly createOAuthServer?: (router: Router) => ArmableServer;
}

export function createApplication(options: ApplicationOptions): Application {
  const {
    paths,
    secrets,
    clock,
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

  /* ---------------------------------------------------------------------- */
  /* Journalisation                                                          */
  /* ---------------------------------------------------------------------- */

  const ringBuffer: RingBufferSink = createRingBufferSink(500);

  /**
   * Logger de démarrage : la console seule.
   *
   * Il existe parce que le magasin de journaux a lui aussi besoin de journaliser
   * ses incidents. Lui confier le logger applicatif créerait une boucle — écrire
   * un log échoue, ce qui écrit un log, qui échoue.
   */
  const bootstrapLogger = createLogger({
    level: 'info',
    sinks: [createConsoleSink()],
    redactor,
  });

  const logStore = createJsonlStore<LogRecord>({
    directory: paths.logsDirectory,
    baseName: 'chronocast',
    // Les enregistrements sortent du logger lui-même : les revalider à la
    // relecture n'apporterait rien qu'un risque de rejeter nos propres lignes.
    parse: (raw) => raw as LogRecord,
    logger: bootstrapLogger,
    retentionDays: 14,
  });

  const jsonlSink: JsonlSink = createJsonlSink({
    store: logStore,
    onError: (error) => {
      // Neutralisé : perdre une ligne de journal ne doit jamais interrompre le
      // subathon. L'incident reste visible sur la console.
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
      // Un abonné défaillant ne doit pas priver les autres de l'événement.
      scoped.error('abonné du bus en échec', { type, cause: error });
    },
  });

  /* ---------------------------------------------------------------------- */
  /* Persistance et configuration                                            */
  /* ---------------------------------------------------------------------- */

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
      // `null` signifie « installation neuve » : c'est le service compteur, et
      // non le magasin, qui sait quelle valeur initiale appliquer.
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

  /* ---------------------------------------------------------------------- */
  /* Chaîne Twitch                                                           */
  /* ---------------------------------------------------------------------- */

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
  let pendingOAuthState: string | null = null;

  /**
   * Vérifie le `state` renvoyé par Twitch.
   *
   * `verifyCsrfToken` plutôt qu'une comparaison directe : la valeur a la même
   * forme qu'un jeton CSRF — trente-deux octets en hexadécimal, engendrés par
   * la même fabrique — et la comparaison y est à temps constant.
   *
   * La consommation n'a lieu **qu'en cas de correspondance**. Usage unique, donc
   * pas de rejeu d'un rappel déjà honoré ; mais un `state` erroné ne clôt rien,
   * sans quoi n'importe quelle page distante provoquant une navigation vers la
   * boucle locale ferait échouer la connexion du streamer, en boucle.
   */
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

  /* ---------------------------------------------------------------------- */
  /* Déduplication et pipeline                                               */
  /* ---------------------------------------------------------------------- */

  let messageDedup: DedupCache | null = null;
  let semanticDedup: DedupCache | null = null;

  /** Applique un événement métier : barème, persistance, puis journal. */
  async function applyDomainEvent(event: DomainEvent): Promise<CounterEventOutcome> {
    const outcome = await counterService.applyEvent(event);
    // L'historique vient après le crédit : il ne doit ni le retarder ni
    // l'empêcher, et son service neutralise déjà ses propres échecs.
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

    // Premier filtre : la retransmission du même message par Twitch.
    if (!messageDedup.admit(context.messageId, now)) {
      pipeline.debug('notification déjà traitée', { messageId: context.messageId });
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
      // Fonctionnement nominal : un événement sans intérêt pour le compteur.
      pipeline.debug('notification ignorée', { reason: mapped.reason });
      return;
    }

    if (mapped.kind === 'invalid') {
      // Décalage avec le protocole : cela, en revanche, mérite d'être vu.
      pipeline.warning('notification non conforme', {
        reason: mapped.reason,
        subscriptionType: context.subscriptionType,
      });
      return;
    }

    // Second filtre : le même fait annoncé par deux flux différents. C'est lui
    // qui empêche un Prime d'être crédité par `channel.subscribe` **et** par
    // `channel.chat.notification`.
    if (!semanticDedup.admit(semanticKey(mapped.event), now)) {
      pipeline.debug('événement déjà crédité par une autre source', { eventId: mapped.event.id });
      return;
    }

    await applyDomainEvent(mapped.event);
  }

  /* ---------------------------------------------------------------------- */
  /* Serveurs                                                                */
  /* ---------------------------------------------------------------------- */

  // Le serveur HTTP n'est construit qu'au démarrage : ses réglages — port,
  // repli, plafond de corps — viennent de la configuration, qui n'est pas encore
  // lue. Les composants qui ont besoin du port passent donc par cette référence.
  let httpServer: HttpServer | null = null;
  const currentPort = (): number => httpServer?.getPort() ?? 0;

  const hub: WsHub = createWsHub({
    bus,
    getConfig: () => configService.get(),
    getSnapshot: () => ({ counter: counterService.getState(), twitch: twitchStatus }),
    clock,
    timers: hubTimers,
    getPort: currentPort,
    appVersion,
    logger,
  });

  async function stopTwitch(): Promise<void> {
    if (eventSub !== null) {
      await eventSub.stop();
      eventSub = null;
    }
  }

  /**
   * Rouvre la connexion EventSub avec l'identité et le jeton courants.
   *
   * Déclaré ici et non dans `oauth-completion.ts` parce que `startTwitch` est
   * une fermeture du composition root : elle lit la configuration, le magasin
   * de jetons et la fabrique de sockets, qui n'existent qu'à ce niveau.
   */
  async function restartTwitch(): Promise<void> {
    await stopTwitch();
    await startTwitch();
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

  /**
   * Serveur éphémère du rappel OAuth.
   *
   * Il porte lui-même la vérification du `state` : le gestionnaire ne voit
   * jamais la valeur attendue, il ne reçoit qu'un verdict. Il ne peut donc ni
   * la journaliser, ni la renvoyer dans une page.
   */
  const oauthCallbackServer = createOAuthCallbackServer({
    router: createOAuthCallbackRouter({
      verifyState: (state) => verifyOAuthState(state),
      complete: (code) => completeOAuth(code),
      getAppPort: () => httpServer?.getPort() ?? null,
      // Le rappel est arrivé : ce port n'a plus rien à écouter.
      onSettled: () => {
        void oauthCallbackServer.disarm().catch((error: unknown) => {
          logger.error('fermeture du port de rappel impossible', { cause: error });
        });
      },
      logger,
    }),
    createServer:
      options.createOAuthServer ??
      ((router) =>
        createHttpServer({
          router,
          host: '127.0.0.1',
          port: OAUTH_REDIRECT_PORT,
          // Aucun repli : Twitch exige une correspondance exacte de la redirect
          // URI. Écouter sur 37772 rendrait le rappel introuvable, ce qui serait
          // bien plus déroutant qu'une erreur franche.
          portFallbackAttempts: 0,
          maxBodyBytes: 4_096,
          logger,
        })),
    timers: options.oauthTimers ?? options.eventSubTimers,
    logger,
  });

  const twitchApi: TwitchApiPort = {
    getStatus: () => twitchStatus,

    async describe() {
      const twitch = configService.get().twitch;
      const credentials = await tokenStore.load();
      const clientSecret = await secrets.read(CLIENT_SECRET_KEY);
      const granted = credentials?.scopes ?? [];

      return {
        broadcasterLogin: twitch.broadcasterLogin,
        clientId: twitch.clientId,
        // Un booléen, jamais la valeur : le secret s'écrit et ne se lit pas.
        hasClientSecret: clientSecret !== null,
        connected: credentials !== null,
        scopes: granted,
        missingScopes: oauth.findMissingScopes(granted),
      };
    },

    async startAuthorization() {
      const twitch = configService.get().twitch;

      // Le port n'est ouvert qu'à partir d'ici, et pour cinq minutes au plus.
      // L'armer au démarrage laisserait un port à l'écoute pendant tout le
      // subathon pour une opération qui dure une poignée de secondes.
      await oauthCallbackServer.arm();

      // Le `state` est engendré ici et vérifié par le serveur de rappel de la
      // Phase 5 : sans lui, un tiers pourrait faire aboutir son propre flux
      // d'autorisation dans la session du streamer.
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
      // Déclaré au rédacteur **avant** d'être écrit : à partir de cet instant, il
      // ne peut plus apparaître dans un journal, quel que soit le chemin emprunté.
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
      getPort: currentPort,
      appVersion,
      applyManualEvent: (event) => applyDomainEvent(event),
      logger,
    }),
    pageHandler: createPageHandler({ staticHandler, getCsrfToken: () => csrfToken }),
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

  /* ---------------------------------------------------------------------- */
  /* Cycle de vie                                                            */
  /* ---------------------------------------------------------------------- */

  async function startTwitch(): Promise<void> {
    const twitch = configService.get().twitch;
    const credentials = await tokenStore.load();

    if (credentials === null || twitch.broadcasterUserId === '') {
      // Installation neuve : l'assistant de la Phase 5 conduira l'utilisateur.
      // Le compteur, lui, fonctionne déjà — il décompte, simplement rien ne le
      // fait monter.
      scoped.info('Twitch non configuré : le compteur fonctionne sans événements');
      return;
    }

    // L'identité du compte connecté peut différer de celle de la chaîne : c'est
    // le cas d'un modérateur ou d'un bot. La validation fait foi ; à défaut, on
    // retombe sur la chaîne elle-même.
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
        // Le pipeline est asynchrone, le rappel ne l'est pas : l'échec est
        // neutralisé ici, sinon un rejet non traité abattrait le processus — et
        // donc le subathon — sur un seul événement mal formé.
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
      // Les magasins savent créer leur répertoire, mais un échec de création est
      // bien plus lisible au démarrage qu'à la première écriture, six heures plus tard.
      await mkdir(paths.dataDirectory, { recursive: true });
      await mkdir(paths.logsDirectory, { recursive: true });
      await mkdir(paths.historyDirectory, { recursive: true });

      const config = await configService.load();

      // Réécrite immédiatement, même inchangée. Trois effets, tous voulus : le
      // répertoire de données décrit l'application dès le premier lancement,
      // une migration de schéma est matérialisée sur le disque au lieu de rester
      // latente, et un répertoire non inscriptible se signale au démarrage
      // plutôt qu'au premier réglage modifié, six heures plus tard.
      await configService.update({});

      logger.setLevel(config.logging.level);
      if (config.logging.console) {
        logger.addSink(createConsoleSink());
      }

      // Les journaux sont poussés au panneau d'administration en direct : c'est
      // le seul moyen pour l'utilisateur de voir une reconnexion Twitch se
      // produire sans aller ouvrir un fichier.
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

      // Fenêtre plus courte : deux flux décrivant le même fait arrivent à
      // quelques secondes d'intervalle, pas à quelques minutes.
      semanticDedup = createDedupCache({
        maxEntries: config.history.dedupCacheSize,
        ttlMs: config.history.crossSourceWindowMs,
      });

      configService.onChange(() => {
        logger.setLevel(configService.get().logging.level);
        hub.publishConfig();
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

      // Twitch en dernier, et sans faire échouer le démarrage : c'est justement
      // quand Twitch ne répond pas que le streamer doit pouvoir ouvrir son panneau.
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
      // Un port de rappel laissé ouvert après extinction est une surface
      // offerte pour rien : plus personne n'attend de rappel.
      await oauthCallbackServer.disarm();
      await stopTwitch();
      await wsAdapter.close();
      hub.stop();
      await httpServer?.stop();
      httpServer = null;
      await counterService.stop();

      // La vidange vient en dernier : tout ce qui précède journalise, et ces
      // lignes-là sont précisément celles qu'on relira après un arrêt anormal.
      await jsonlSink.flush();
    },
  };
}

export type { NotificationContext };
