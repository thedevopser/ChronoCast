import { z } from 'zod';

export const CONFIG_SCHEMA_VERSION = 7;

export const GOAL_LABEL_MAX_LENGTH = 40;

const hexColor = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, {
    message: 'couleur hexadécimale attendue, par exemple #FFCC00',
  });

const seconds = z.number().int().nonnegative();

const positiveSeconds = z.number().int().positive();

const millisecondsAboveZero = z.number().int().positive();

// Partagés par l'overlay du compteur et par la page Objectifs : les deux pages posent les mêmes
// effets de texte, et deux déclarations dériveraient l'une de l'autre au premier réglage ajouté.
const shadowSchema = z
  .object({
    enabled: z.boolean().default(true),
    color: hexColor.default('#000000CC'),
    blur: z.number().nonnegative().default(12),
    offsetX: z.number().default(0),
    offsetY: z.number().default(4),
  })
  .strip();

const outlineSchema = z
  .object({
    enabled: z.boolean().default(false),
    color: hexColor.default('#000000'),
    width: z.number().nonnegative().default(2),
  })
  .strip();

const glowSchema = z
  .object({
    enabled: z.boolean().default(false),
    color: hexColor.default('#9146FF'),
    radius: z.number().nonnegative().default(20),
  })
  .strip();

const counterSchema = z
  .object({
    initialSeconds: positiveSeconds.default(43_200),

    minRemainingSeconds: seconds.default(0),

    tickIntervalMs: millisecondsAboveZero.default(250),

    persistIntervalMs: millisecondsAboveZero.default(5_000),

    resumeOnStartup: z.boolean().default(true),
  })
  .strip();

const DEFAULT_TIER_SECONDS = { tier1: 180, tier2: 240, tier3: 300, prime: 180 } as const;

// Le Happy Hour valait le double du barème avant d'avoir le sien : ses défauts gardent ce rapport.
export const HAPPY_HOUR_DEFAULT_FACTOR = 2;

function tieredReward(factor: number) {
  return z
    .object({
      tier1: seconds.default(DEFAULT_TIER_SECONDS.tier1 * factor),
      tier2: seconds.default(DEFAULT_TIER_SECONDS.tier2 * factor),
      tier3: seconds.default(DEFAULT_TIER_SECONDS.tier3 * factor),
      prime: seconds.default(DEFAULT_TIER_SECONDS.prime * factor),
    })
    .strip();
}

function giftReward(factor: number) {
  return z
    .object({
      tier1: seconds.default(DEFAULT_TIER_SECONDS.tier1 * factor),
      tier2: seconds.default(DEFAULT_TIER_SECONDS.tier2 * factor),
      tier3: seconds.default(DEFAULT_TIER_SECONDS.tier3 * factor),
    })
    .strip();
}

const tieredRewardSchema = tieredReward(1);
const giftRewardSchema = giftReward(1);

const bitsTierSchema = z
  .object({
    minBits: z.number().int().positive(),
    seconds,
  })
  .strip();

const DEFAULT_SECONDS_PER_UNIT = 60;

const DEFAULT_BITS_TIERS = [
  { minBits: 100, seconds: 60 },
  { minBits: 500, seconds: 360 },
  { minBits: 1_000, seconds: 900 },
] as const;

function bitsReward(factor: number) {
  return z
    .object({
      mode: z.enum(['linear', 'tiers']).default('linear'),

      linear: z
        .object({
          unit: z.number().int().positive().default(100),
          secondsPerUnit: seconds.default(DEFAULT_SECONDS_PER_UNIT * factor),
          minBits: z.number().int().positive().default(1),
        })
        .strip()
        .default({}),

      tiers: z
        .array(bitsTierSchema)
        .default(
          DEFAULT_BITS_TIERS.map((tier) => ({ minBits: tier.minBits, seconds: tier.seconds * factor })),
        ),
    })
    .strip()
    .refine((value) => value.mode !== 'tiers' || value.tiers.length > 0, {
      message: 'le mode « tiers » exige au moins un palier',
      path: ['tiers'],
    });
}

const bitsRewardSchema = bitsReward(1);

const happyHourRewardsSchema = z
  .object({
    sub: tieredReward(HAPPY_HOUR_DEFAULT_FACTOR).default({}),
    resub: tieredReward(HAPPY_HOUR_DEFAULT_FACTOR).default({}),
    gift: giftReward(HAPPY_HOUR_DEFAULT_FACTOR).default({}),
    bits: bitsReward(HAPPY_HOUR_DEFAULT_FACTOR).default({}),
  })
  .strip();

const chatCommandSchema = z
  .object({
    name: z
      .string()
      .regex(/^[a-zA-Z0-9]{1,20}$/, {
        message: 'nom alphanumérique de 1 à 20 caractères attendu, par exemple addtime',
      })
      .default('addtime'),

    maxSeconds: positiveSeconds.default(3_600),

    overlayText: z.string().max(40).default('Temps ajouté'),
  })
  .strip();

const rewardsSchema = z
  .object({
    // Actif, abonnements, réabonnements, subs offerts et bits se lisent dans `happyHourRewards`.
    // La saisie d'un modérateur n'est jamais concernée.
    happyHour: z.boolean().default(false),
    happyHourRewards: happyHourRewardsSchema.default({}),

    chatCommand: chatCommandSchema.default({}),
    sub: tieredRewardSchema.default({}),
    resub: tieredRewardSchema.default({}),
    gift: giftRewardSchema.default({}),
    bits: bitsRewardSchema.default({}),
  })
  .strip();

const goalTierSchema = z
  .object({
    // Seule la borne haute est stockée : la borne basse se dérive du palier précédent, si bien
    // qu'aucun trou ni chevauchement ne peut exister dans la configuration.
    target: z.number().int().positive(),

    label: z.string().max(GOAL_LABEL_MAX_LENGTH),
  })
  .strip();

// L'apparence de la page /goal. Elle n'a pas de cadre, à la différence de l'overlay du compteur :
// la piste de la barre porte déjà fond, arrondi et bordure, et un cadre par-dessus dessinerait une
// seconde boîte autour de la première.
const goalOverlaySchema = z
  .object({
    fontFamily: z.string().min(1).default('Inter, Segoe UI, system-ui, sans-serif'),
    fontSize: z.number().int().positive().default(28),
    fontWeight: z.number().int().min(100).max(900).default(700),
    letterSpacing: z.number().default(0),
    color: hexColor.default('#FFFFFF'),

    textAlign: z.enum(['left', 'center', 'right']).default('center'),

    showCount: z.boolean().default(true),

    bar: z
      .object({
        width: z.number().int().nonnegative().max(3840).default(0),
        height: z.number().nonnegative().max(400).default(48),
        radius: z.number().nonnegative().max(200).default(24),
        fillColor: hexColor.default('#9146FF'),
        trackColor: hexColor.default('#000000'),
        trackOpacity: z.number().min(0).max(1).default(0.5),
        borderWidth: z.number().nonnegative().max(40).default(0),
        borderColor: hexColor.default('#9146FF'),
      })
      .strip()
      .default({}),

    shadow: shadowSchema.default({}),

    outline: outlineSchema.default({}),

    glow: glowSchema.default({}),

    gradient: z
      .object({
        onText: z.boolean().default(false),
        onBar: z.boolean().default(false),
        from: hexColor.default('#FF3D7F'),
        to: hexColor.default('#FF9A3D'),
        angleDeg: z.number().int().min(0).max(360).default(100),
      })
      .strip()
      .default({}),

    announce: z
      .object({
        enabled: z.boolean().default(true),
        durationMs: millisecondsAboveZero.default(5_000),
        color: hexColor.default('#FFCC00'),

        // Vide, seul le libellé du palier s'affiche. Même longueur que le texte de la commande de
        // chat : ce qui tient sur une ligne d'overlay tient sur une ligne de bandeau.
        text: z.string().max(GOAL_LABEL_MAX_LENGTH).default('Palier atteint'),
      })
      .strip()
      .default({}),
  })
  .strip();

const points = z.number().int().nonnegative();

// Mêmes formes que les barèmes de temps, mais en points et à 1 partout : par défaut, la barre
// compte en abonnements, comme avant que ces poids soient réglables.
const tieredPointsSchema = z
  .object({
    tier1: points.default(1),
    tier2: points.default(1),
    tier3: points.default(1),
    prime: points.default(1),
  })
  .strip();

const giftPointsSchema = z
  .object({
    tier1: points.default(1),
    tier2: points.default(1),
    tier3: points.default(1),
  })
  .strip();

const goalPointsSchema = z
  .object({
    sub: tieredPointsSchema.default({}),
    resub: tieredPointsSchema.default({}),
    gift: giftPointsSchema.default({}),
  })
  .strip();

const goalsSchema = z
  .object({
    // Le nombre de bits qui vaut un point. La clé date du temps où la barre ne comptait qu'en
    // abonnements : la renommer imposerait une migration pour une question de vocabulaire.
    bitsPerSub: z.number().int().positive().default(500),

    points: goalPointsSchema.default({}),

    // Ce que le panneau écrit après le compte. Jamais diffusé aux spectateurs : la page /goal
    // affiche « 12 / 50 » sans unité.
    unitLabel: z.string().max(GOAL_LABEL_MAX_LENGTH).default('abo.'),

    // Ni tri ni unicité ici : un refine qui rejette ferait tomber toute la configuration au
    // chargement. L'échelle se normalise à la lecture, et la saisie se valide dans le panneau.
    tiers: z.array(goalTierSchema).default([]),

    overlay: goalOverlaySchema.default({}),
  })
  .strip();

const twitchSchema = z
  .object({
    clientId: z.string().default(''),

    broadcasterUserId: z.string().default(''),
    broadcasterLogin: z.string().default(''),

    enableChatNotifications: z.boolean().default(true),

    enableChatCommands: z.boolean().default(false),

    eventsubUrl: z.string().url().default('wss://eventsub.wss.twitch.tv/ws'),
    helixBaseUrl: z.string().url().default('https://api.twitch.tv/helix'),
    idBaseUrl: z.string().url().default('https://id.twitch.tv'),

    keepaliveTimeoutSeconds: z.number().int().min(10).max(600).default(30),
  })
  .strip();

const serverSchema = z
  .object({
    httpPort: z.number().int().min(1).max(65_535).default(3_777),

    host: z.enum(['127.0.0.1', 'localhost']).default('127.0.0.1'),

    websocket: z
      .object({
        heartbeatIntervalMs: millisecondsAboveZero.default(30_000),

        stateBroadcastIntervalMs: millisecondsAboveZero.default(1_000),

        maxMessageBytes: z.number().int().positive().max(65_536).default(4_096),
      })
      .strip()
      .default({}),

    portFallbackAttempts: z.number().int().min(0).max(50).default(10),

    maxBodyBytes: z.number().int().positive().max(10_485_760).default(262_144),
  })
  .strip();

const overlaySchema = z
  .object({
    fontFamily: z.string().min(1).default('Inter, Segoe UI, system-ui, sans-serif'),
    fontSize: z.number().int().positive().default(96),
    fontWeight: z.number().int().min(100).max(900).default(700),
    letterSpacing: z.number().default(0),
    color: hexColor.default('#FFFFFF'),

    showDays: z.boolean().default(true),
    hideEmptyHours: z.boolean().default(false),

    textAlign: z.enum(['left', 'center', 'right']).default('center'),

    shadow: shadowSchema.default({}),

    outline: outlineSchema.default({}),

    glow: glowSchema.default({}),

    gradient: z
      .object({
        onText: z.boolean().default(false),
        onFrame: z.boolean().default(false),
        from: hexColor.default('#FF3D7F'),
        to: hexColor.default('#FF9A3D'),
        angleDeg: z.number().int().min(0).max(360).default(100),
      })
      .strip()
      .default({}),

    frame: z
      .object({
        enabled: z.boolean().default(false),
        color: hexColor.default('#9146FF'),
        width: z.number().nonnegative().max(40).default(4),
        radius: z.number().nonnegative().max(200).default(18),
        paddingX: z.number().nonnegative().max(400).default(24),
        paddingY: z.number().nonnegative().max(400).default(12),
        fillColor: hexColor.default('#000000'),
        fillOpacity: z.number().min(0).max(1).default(0),
      })
      .strip()
      .default({}),

    animation: z
      .object({
        onAdd: z.enum(['none', 'flash', 'pulse', 'shake']).default('pulse'),
        durationMs: millisecondsAboveZero.default(600),
      })
      .strip()
      .default({}),

    toast: z
      .object({
        enabled: z.boolean().default(true),
        durationMs: millisecondsAboveZero.default(4_000),
        color: hexColor.default('#9146FF'),
        fontSize: z.number().int().positive().default(28),
      })
      .strip()
      .default({}),

    enableCustomCss: z.boolean().default(false),
  })
  .strip();

const loggingSchema = z
  .object({
    level: z.enum(['debug', 'info', 'warning', 'error']).default('info'),
    retentionDays: z.number().int().min(1).max(365).default(14),
    ringBufferSize: z.number().int().min(50).max(10_000).default(500),
    console: z.boolean().default(true),
  })
  .strip();

const historySchema = z
  .object({
    retentionDays: z.number().int().min(1).max(365).default(90),
    dedupCacheSize: z.number().int().min(100).max(100_000).default(5_000),
    dedupTtlMs: millisecondsAboveZero.default(600_000),
    crossSourceWindowMs: millisecondsAboveZero.default(10_000),
  })
  .strip();

const setupSchema = z
  .object({
    completed: z.boolean().default(false),
  })
  .strip();

const appSchema = z
  .object({
    startMinimized: z.boolean().default(false),
  })
  .strip();

export const configSchema = z
  .object({
    schemaVersion: z.number().int().nonnegative().default(CONFIG_SCHEMA_VERSION),
    counter: counterSchema.default({}),
    rewards: rewardsSchema.default({}),
    goals: goalsSchema.default({}),
    twitch: twitchSchema.default({}),
    server: serverSchema.default({}),
    overlay: overlaySchema.default({}),
    logging: loggingSchema.default({}),
    history: historySchema.default({}),
    setup: setupSchema.default({}),
    app: appSchema.default({}),
  })
  .strip();

export type ChronoCastConfig = z.infer<typeof configSchema>;

export type CounterConfig = ChronoCastConfig['counter'];
export type RewardsConfig = ChronoCastConfig['rewards'];
export type GoalsConfig = ChronoCastConfig['goals'];
export type GoalTier = GoalsConfig['tiers'][number];
export type GoalOverlayConfig = GoalsConfig['overlay'];
export type TwitchConfig = ChronoCastConfig['twitch'];
export type ServerConfig = ChronoCastConfig['server'];
export type OverlayConfig = ChronoCastConfig['overlay'];
export type LoggingConfig = ChronoCastConfig['logging'];
export type HistoryConfig = ChronoCastConfig['history'];
export type SetupConfig = ChronoCastConfig['setup'];
