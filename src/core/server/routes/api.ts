/**
 * API JSON du panneau d'administration.
 *
 * Les routes ne font que déléguer : le métier vit dans les services, chacun
 * testé pour lui-même. Ce qui se joue ici est ailleurs.
 *
 * **La validation.** Tout corps entrant vient d'une page, et une page peut avoir
 * été ouverte par un lien. Zod est la seule porte, et une valeur refusée produit
 * un `400` explicite plutôt qu'un `500` — la différence entre « vous vous êtes
 * trompé » et « le serveur est cassé » se lit dans le code de statut.
 *
 * **Le secret.** Le secret client Twitch s'écrit et ne se lit jamais. Il ne
 * traverse pas la configuration : il est frère de `config` dans le corps du
 * `PATCH`, jamais son enfant. L'exclusion devient ainsi structurelle, au lieu
 * d'être une exception qu'on finirait par oublier lors d'un ajout de champ.
 *
 * **La provenance des pannes.** Une erreur venue de Twitch devient un `502` et
 * non un `500` : le streamer doit savoir de quel côté chercher.
 */

import { z } from 'zod';

import type { TwitchStatusPayload } from '../../app/app-events.js';
import type { ConfigService } from '../../config/config-service.js';
import type { CounterEventOutcome, CounterService } from '../../counter/counter-service.js';
import type { DomainEvent, DomainEventType } from '../../events/domain-event.js';
import type { EventHistoryService } from '../../history/event-history-service.js';
import type { Logger, LogLevel } from '../../logging/logger.js';
import type { RingBufferSink } from '../../logging/sinks/ring-buffer-sink.js';
import {
  errorResponse,
  jsonResponse,
  noContentResponse,
  type HttpRequest,
  type HttpResponse,
} from '../http-types.js';
import type { Route } from '../router.js';

/* -------------------------------------------------------------------------- */
/* Dépendances                                                                 */
/* -------------------------------------------------------------------------- */

/** Vue de la chaîne Twitch réduite à ce que l'API expose. */
export interface TwitchApiPort {
  getStatus(): TwitchStatusPayload;

  /** État de l'authentification. Ne renvoie jamais de jeton ni de secret. */
  describe(): Promise<{
    readonly broadcasterLogin: string;
    readonly clientId: string;
    readonly hasClientSecret: boolean;
    readonly connected: boolean;
    readonly scopes: readonly string[];
    readonly missingScopes: readonly string[];
  }>;

  /** Prépare le flux OAuth et renvoie l'URL à ouvrir. */
  startAuthorization(): Promise<{ readonly authorizationUrl: string }>;

  revoke(): Promise<void>;

  listSubscriptions(): Promise<
    { readonly id: string; readonly type: string; readonly status: string }[]
  >;

  /** Enregistre le secret client dans le magasin chiffré. */
  setClientSecret(secret: string): Promise<void>;
}

export interface ApiContext {
  readonly config: ConfigService;
  readonly counter: CounterService;
  readonly history: EventHistoryService;
  /** Journaux en mémoire : réponse immédiate, sans lecture disque. */
  readonly logs: RingBufferSink;
  readonly twitch: TwitchApiPort;
  /** Port réellement retenu, qui peut différer de celui demandé. */
  readonly getPort: () => number;
  readonly appVersion: string;
  /** Injecte un événement fabriqué dans le pipeline, pour l'aperçu d'overlay. */
  readonly applyManualEvent: (event: DomainEvent) => Promise<CounterEventOutcome>;
  readonly logger: Logger;
}

/* -------------------------------------------------------------------------- */
/* Bornes                                                                      */
/* -------------------------------------------------------------------------- */

/** Une entrée d'historique par page d'affichage, au plus. */
const HISTORY_LIMIT = { min: 1, max: 500, fallback: 50 } as const;
const LOG_LIMIT = { min: 1, max: 1_000, fallback: 200 } as const;

/**
 * Plafond d'un motif d'ajustement manuel.
 *
 * Le motif finit dans l'historique et sur le WebSocket : le borner évite qu'une
 * page locale ne remplisse le disque une requête à la fois.
 */
const MAX_REASON_LENGTH = 200;

/** Plafond d'un pseudo. Le même s'applique aux pseudos venus de Twitch. */
const MAX_USER_NAME_LENGTH = 64;

/** Une journée en secondes borne largement tout ajustement manuel raisonnable. */
const MAX_ADJUSTMENT_SECONDS = 86_400;

/** Trente jours : au-delà, ce n'est plus un subathon. */
const MAX_INITIAL_SECONDS = 2_592_000;

/* -------------------------------------------------------------------------- */
/* Schémas                                                                     */
/* -------------------------------------------------------------------------- */

const secondsSchema = z.number().int().positive().max(MAX_ADJUSTMENT_SECONDS);

const adjustmentSchema = z
  .object({
    seconds: secondsSchema,
    reason: z.string().max(MAX_REASON_LENGTH).optional(),
  })
  .strip();

const initialSchema = z
  .object({ seconds: z.number().int().positive().max(MAX_INITIAL_SECONDS) })
  .strip();

const configPatchSchema = z
  .object({
    /** Fragment de configuration. Validé ensuite par le service, seul juge de sa forme. */
    config: z.record(z.string(), z.unknown()).optional(),
    /**
     * Secret client Twitch, en **écriture seule**.
     *
     * Frère de `config` et non son enfant : ainsi il ne peut pas se retrouver
     * écrit dans le fichier de configuration par inadvertance.
     */
    clientSecret: z.string().min(1).max(200).optional(),
  })
  .strip();

const importSchema = z.object({ content: z.string().min(1).max(1_048_576) }).strip();

const overlayTestSchema = z
  .object({
    type: z.enum(['sub', 'resub', 'gift', 'bits', 'raid', 'follow']),
    userName: z.string().min(1).optional(),
  })
  .strip();

const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warning', 'error'];

/* -------------------------------------------------------------------------- */
/* Utilitaires                                                                 */
/* -------------------------------------------------------------------------- */

/** Analyse un corps JSON. `null` signale un corps illisible, pas un corps vide. */
function parseJsonBody(request: HttpRequest): unknown {
  if (request.body === '') {
    // Un corps vide est légitime pour les mutations sans paramètre : il vaut
    // l'objet vide, que les schémas complètent ou refusent selon le cas.
    return {};
  }
  try {
    return JSON.parse(request.body);
  } catch {
    return null;
  }
}

function badRequest(message: string): HttpResponse {
  return errorResponse(400, 'invalid_request', message);
}

/** Ramène un entier de la chaîne de requête dans ses bornes, sans jamais refuser. */
function boundedInteger(
  raw: string | null,
  bounds: { readonly min: number; readonly max: number; readonly fallback: number },
): number {
  const parsed = Number(raw);
  if (raw === null || !Number.isFinite(parsed)) {
    return bounds.fallback;
  }
  return Math.min(bounds.max, Math.max(bounds.min, Math.trunc(parsed)));
}

/**
 * Fabrique un événement de démonstration.
 *
 * Les valeurs sont représentatives plutôt que minimales : un test d'overlay
 * n'a d'intérêt que s'il ressemble à ce que le streamer verra en direct.
 */
function buildTestEvent(type: DomainEventType, userName: string, now: number): DomainEvent {
  const base = {
    id: `test-${String(now)}`,
    occurredAt: now,
    userId: 'test',
    userName: userName.slice(0, MAX_USER_NAME_LENGTH),
    // Marqué manuel : sans cela, un test serait indiscernable d'un vrai
    // abonnement dans l'historique.
    source: 'manual',
  } as const;

  switch (type) {
    case 'sub':
      return { ...base, type: 'sub', tier: 'tier1' };
    case 'resub':
      return { ...base, type: 'resub', tier: 'tier1', cumulativeMonths: 12 };
    case 'gift':
      return { ...base, type: 'gift', tier: 'tier1', total: 5, isAnonymous: false };
    case 'bits':
      return { ...base, type: 'bits', bits: 500 };
    case 'raid':
      return { ...base, type: 'raid', viewers: 42 };
    case 'follow':
      return { ...base, type: 'follow' };
  }
}

/* -------------------------------------------------------------------------- */
/* Routes                                                                      */
/* -------------------------------------------------------------------------- */

export function createApiRoutes(context: ApiContext): Route[] {
  const { config, counter, history, logs, twitch, getPort, appVersion, applyManualEvent, logger } =
    context;
  const scoped = logger.child('api');

  /**
   * Exécute une opération Twitch en traduisant sa panne en `502`.
   *
   * Une erreur venue de Twitch n'est pas une erreur de ChronoCast : le distinguer
   * évite au streamer de chercher la panne du mauvais côté. Le détail reste dans
   * les journaux, jamais dans la réponse.
   */
  async function throughTwitch<T>(
    operation: () => Promise<T>,
    describe: string,
  ): Promise<T | HttpResponse> {
    try {
      return await operation();
    } catch (error) {
      scoped.error('opération Twitch en échec', { operation: describe, cause: error });
      return errorResponse(502, 'twitch_unavailable', 'Twitch n’a pas répondu. Réessayez.');
    }
  }

  function isResponse(value: unknown): value is HttpResponse {
    return typeof value === 'object' && value !== null && 'status' in value && 'headers' in value;
  }

  return [
    {
      method: 'GET',
      path: '/api/state',
      handler: () =>
        jsonResponse(200, {
          counter: counter.getState(),
          twitch: twitch.getStatus(),
          overlay: config.get().overlay,
          port: getPort(),
          appVersion,
        }),
    },

    {
      method: 'GET',
      path: '/api/config',
      handler: async () => {
        const description = await throughTwitch(() => twitch.describe(), 'describe');
        if (isResponse(description)) {
          return description;
        }

        // La configuration ne contient aucun secret par construction : seul un
        // booléen dit si un secret client est enregistré.
        return jsonResponse(200, {
          config: config.get(),
          hasClientSecret: description.hasClientSecret,
        });
      },
    },

    {
      method: 'PATCH',
      path: '/api/config',
      handler: async (request) => {
        const raw = parseJsonBody(request);
        if (raw === null) {
          return badRequest('Corps de requête illisible.');
        }

        const parsed = configPatchSchema.safeParse(raw);
        if (!parsed.success) {
          return badRequest('Modification refusée : forme inattendue.');
        }

        if (parsed.data.clientSecret !== undefined) {
          const stored = await throughTwitch(
            () => twitch.setClientSecret(parsed.data.clientSecret ?? ''),
            'setClientSecret',
          );
          if (isResponse(stored)) {
            return stored;
          }
        }

        if (parsed.data.config !== undefined) {
          try {
            await config.update(parsed.data.config);
          } catch (error) {
            // Le service de configuration refuse une valeur hors bornes : c'est
            // une erreur de saisie, pas une panne du serveur.
            scoped.warning('modification de configuration refusée', { cause: error });
            return badRequest('Valeur de configuration invalide.');
          }
        }

        return jsonResponse(200, { config: config.get() });
      },
    },

    {
      method: 'GET',
      path: '/api/config/export',
      handler: () => ({
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'content-disposition': 'attachment; filename="chronocast-config.json"',
        },
        body: config.export(),
      }),
    },

    {
      method: 'POST',
      path: '/api/config/import',
      handler: async (request) => {
        const raw = parseJsonBody(request);
        if (raw === null) {
          return badRequest('Corps de requête illisible.');
        }

        const parsed = importSchema.safeParse(raw);
        if (!parsed.success) {
          return badRequest('Fichier de configuration attendu.');
        }

        try {
          await config.import(parsed.data.content);
        } catch (error) {
          scoped.warning('import de configuration refusé', { cause: error });
          return badRequest('Fichier de configuration invalide.');
        }

        return jsonResponse(200, { config: config.get() });
      },
    },

    {
      method: 'POST',
      path: '/api/counter/pause',
      handler: async () => jsonResponse(200, { counter: await counter.pause() }),
    },
    {
      method: 'POST',
      path: '/api/counter/resume',
      handler: async () => jsonResponse(200, { counter: await counter.resume() }),
    },
    {
      method: 'POST',
      path: '/api/counter/reset',
      handler: async () => jsonResponse(200, { counter: await counter.reset() }),
    },

    {
      method: 'POST',
      path: '/api/counter/add',
      handler: async (request) => {
        const parsed = adjustmentSchema.safeParse(parseJsonBody(request));
        if (!parsed.success) {
          return badRequest('Durée invalide.');
        }
        const reason = parsed.data.reason ?? 'ajout manuel';
        return jsonResponse(200, { counter: await counter.addTime(parsed.data.seconds, reason) });
      },
    },

    {
      method: 'POST',
      path: '/api/counter/remove',
      handler: async (request) => {
        const parsed = adjustmentSchema.safeParse(parseJsonBody(request));
        if (!parsed.success) {
          return badRequest('Durée invalide.');
        }
        const reason = parsed.data.reason ?? 'retrait manuel';
        return jsonResponse(200, {
          counter: await counter.removeTime(parsed.data.seconds, reason),
        });
      },
    },

    {
      method: 'POST',
      path: '/api/counter/initial',
      handler: async (request) => {
        const parsed = initialSchema.safeParse(parseJsonBody(request));
        if (!parsed.success) {
          return badRequest('Valeur de départ invalide.');
        }
        return jsonResponse(200, {
          counter: await counter.setInitialSeconds(parsed.data.seconds),
        });
      },
    },

    {
      method: 'GET',
      path: '/api/twitch/status',
      handler: async () => {
        const description = await throughTwitch(() => twitch.describe(), 'describe');
        if (isResponse(description)) {
          return description;
        }

        const status = twitch.getStatus();
        return jsonResponse(200, {
          status: status.status,
          detail: status.detail,
          ...description,
        });
      },
    },

    {
      method: 'POST',
      path: '/api/twitch/connect',
      handler: async () => {
        const started = await throughTwitch(() => twitch.startAuthorization(), 'startAuthorization');
        return isResponse(started) ? started : jsonResponse(200, started);
      },
    },

    {
      method: 'POST',
      path: '/api/twitch/revoke',
      handler: async () => {
        const revoked = await throughTwitch(() => twitch.revoke(), 'revoke');
        return isResponse(revoked) ? revoked : noContentResponse();
      },
    },

    {
      method: 'GET',
      path: '/api/twitch/subscriptions',
      handler: async () => {
        const subscriptions = await throughTwitch(
          () => twitch.listSubscriptions(),
          'listSubscriptions',
        );
        return isResponse(subscriptions)
          ? subscriptions
          : jsonResponse(200, { subscriptions });
      },
    },

    {
      method: 'GET',
      path: '/api/history',
      handler: async (request) => {
        // La limite est ramenée dans ses bornes plutôt que refusée : une valeur
        // aberrante dans une URL ne mérite pas une page d'erreur.
        const limit = boundedInteger(request.query.get('limit'), HISTORY_LIMIT);
        return jsonResponse(200, { entries: await history.list(limit) });
      },
    },

    {
      method: 'GET',
      path: '/api/logs',
      handler: (request) => {
        const limit = boundedInteger(request.query.get('limit'), LOG_LIMIT);
        const requested = request.query.get('level');

        // Filtre par niveau **minimal** : chercher les avertissements sans voir
        // les erreurs n'aurait aucun sens.
        const threshold = LOG_LEVELS.indexOf(requested as LogLevel);
        const records = logs
          .snapshot(limit)
          .filter((record) => threshold < 0 || LOG_LEVELS.indexOf(record.level) >= threshold);

        return jsonResponse(200, { records });
      },
    },

    {
      method: 'POST',
      path: '/api/overlay/test',
      handler: async (request) => {
        const parsed = overlayTestSchema.safeParse(parseJsonBody(request));
        if (!parsed.success) {
          return badRequest('Type d’événement de test inconnu.');
        }

        const event = buildTestEvent(
          parsed.data.type,
          parsed.data.userName ?? 'ChronoCast',
          Date.now(),
        );

        const outcome = await applyManualEvent(event);

        return jsonResponse(200, {
          event,
          rewardSeconds: outcome.reward.seconds,
          counter: outcome.state,
        });
      },
    },
  ];
}
