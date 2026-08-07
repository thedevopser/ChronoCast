import { z } from 'zod';

export const CONFIG_SCHEMA_VERSION = 1;

const hexColor = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, {
    message: 'couleur hexadécimale attendue, par exemple #FFCC00',
  });

const seconds = z.number().int().nonnegative();

const positiveSeconds = z.number().int().positive();

const millisecondsAboveZero = z.number().int().positive();

const counterSchema = z
  .object({
    initialSeconds: positiveSeconds.default(43_200),

    minRemainingSeconds: seconds.default(0),

    maxRemainingSeconds: positiveSeconds.default(86_400),

    tickIntervalMs: millisecondsAboveZero.default(250),

    persistIntervalMs: millisecondsAboveZero.default(5_000),

    resumeOnStartup: z.boolean().default(true),
  })
  .strip()
  .refine((value) => value.maxRemainingSeconds > value.minRemainingSeconds, {
    message: 'maxRemainingSeconds doit être strictement supérieur à minRemainingSeconds',
    path: ['maxRemainingSeconds'],
  });

const tieredRewardSchema = z
  .object({
    tier1: seconds.default(180),
    tier2: seconds.default(240),
    tier3: seconds.default(300),
    prime: seconds.default(180),
  })
  .strip();

const giftRewardSchema = z
  .object({
    tier1: seconds.default(180),
    tier2: seconds.default(240),
    tier3: seconds.default(300),

    maxPerEvent: positiveSeconds.default(3_600),
  })
  .strip();

const bitsTierSchema = z
  .object({
    minBits: z.number().int().positive(),
    seconds,
  })
  .strip();

const bitsRewardSchema = z
  .object({
    mode: z.enum(['linear', 'tiers']).default('linear'),

    linear: z
      .object({
        unit: z.number().int().positive().default(100),
        secondsPerUnit: seconds.default(60),
        minBits: z.number().int().positive().default(1),
      })
      .strip()
      .default({}),

    tiers: z
      .array(bitsTierSchema)
      .default([
        { minBits: 100, seconds: 60 },
        { minBits: 500, seconds: 360 },
        { minBits: 1_000, seconds: 900 },
      ]),

    maxPerEvent: positiveSeconds.default(3_600),
  })
  .strip()
  .refine((value) => value.mode !== 'tiers' || value.tiers.length > 0, {
    message: 'le mode « tiers » exige au moins un palier',
    path: ['tiers'],
  });

const raidRewardSchema = z
  .object({
    enabled: z.boolean().default(false),
    secondsPerViewer: seconds.default(2),
    minViewers: z.number().int().positive().default(5),
    maxSeconds: positiveSeconds.default(600),
  })
  .strip();

const followRewardSchema = z
  .object({
    enabled: z.boolean().default(false),
    seconds: seconds.default(10),
    maxPerHour: z.number().int().positive().default(60),
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
    chatCommand: chatCommandSchema.default({}),
    sub: tieredRewardSchema.default({}),
    resub: tieredRewardSchema.default({}),
    gift: giftRewardSchema.default({}),
    bits: bitsRewardSchema.default({}),
    raid: raidRewardSchema.default({}),
    follow: followRewardSchema.default({}),
  })
  .strip();

const twitchSchema = z
  .object({
    clientId: z.string().default(''),

    broadcasterUserId: z.string().default(''),
    broadcasterLogin: z.string().default(''),

    enableChatNotifications: z.boolean().default(true),

    enableRaid: z.boolean().default(false),
    enableFollow: z.boolean().default(false),

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

    shadow: z
      .object({
        enabled: z.boolean().default(true),
        color: hexColor.default('#000000CC'),
        blur: z.number().nonnegative().default(12),
        offsetX: z.number().default(0),
        offsetY: z.number().default(4),
      })
      .strip()
      .default({}),

    outline: z
      .object({
        enabled: z.boolean().default(false),
        color: hexColor.default('#000000'),
        width: z.number().nonnegative().default(2),
      })
      .strip()
      .default({}),

    glow: z
      .object({
        enabled: z.boolean().default(false),
        color: hexColor.default('#9146FF'),
        radius: z.number().nonnegative().default(20),
      })
      .strip()
      .default({}),

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
export type TwitchConfig = ChronoCastConfig['twitch'];
export type ServerConfig = ChronoCastConfig['server'];
export type OverlayConfig = ChronoCastConfig['overlay'];
export type LoggingConfig = ChronoCastConfig['logging'];
export type HistoryConfig = ChronoCastConfig['history'];
export type SetupConfig = ChronoCastConfig['setup'];
