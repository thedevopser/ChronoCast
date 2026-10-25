import { z } from 'zod';

export const CONFIG_SCHEMA_VERSION = 11;

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
const shadowSchema = z.object({
  enabled: z.boolean().default(true),
  color: hexColor.default('#000000CC'),
  blur: z.number().nonnegative().default(12),
  offsetX: z.number().default(0),
  offsetY: z.number().default(4),
});

const outlineSchema = z.object({
  enabled: z.boolean().default(false),
  color: hexColor.default('#000000'),
  width: z.number().nonnegative().default(2),
});

const glowSchema = z.object({
  enabled: z.boolean().default(false),
  color: hexColor.default('#9146FF'),
  radius: z.number().nonnegative().default(20),
});

const counterSchema = z.object({
  initialSeconds: positiveSeconds.default(43_200),

  minRemainingSeconds: seconds.default(0),

  resumeOnStartup: z.boolean().default(true),
});

const DEFAULT_TIER_SECONDS = { tier1: 180, tier2: 240, tier3: 300, prime: 180 } as const;

// Le Happy Hour valait le double du barème avant d'avoir le sien : ses défauts gardent ce rapport.
export const HAPPY_HOUR_DEFAULT_FACTOR = 2;

function tieredReward(factor: number) {
  return z.object({
    tier1: seconds.default(DEFAULT_TIER_SECONDS.tier1 * factor),
    tier2: seconds.default(DEFAULT_TIER_SECONDS.tier2 * factor),
    tier3: seconds.default(DEFAULT_TIER_SECONDS.tier3 * factor),
    prime: seconds.default(DEFAULT_TIER_SECONDS.prime * factor),
  });
}

function giftReward(factor: number) {
  return z.object({
    tier1: seconds.default(DEFAULT_TIER_SECONDS.tier1 * factor),
    tier2: seconds.default(DEFAULT_TIER_SECONDS.tier2 * factor),
    tier3: seconds.default(DEFAULT_TIER_SECONDS.tier3 * factor),
  });
}

const tieredRewardSchema = tieredReward(1);
const giftRewardSchema = giftReward(1);

const DEFAULT_BITS_UNIT = 100;

const DEFAULT_BITS_SECONDS = 60;

// Un taux, « `unit` bits = `seconds` secondes », appliqué au bit près : au défaut, un bit crédite
// 0,6 seconde. Deux entiers plutôt qu'un décimal par bit, pour qu'on n'ait rien à convertir.
function bitsReward(factor: number) {
  return z.object({
    unit: z.number().int().positive().default(DEFAULT_BITS_UNIT),
    seconds: seconds.default(DEFAULT_BITS_SECONDS * factor),
  });
}

const bitsRewardSchema = bitsReward(1);

const happyHourRewardsSchema = z.object({
  sub: tieredReward(HAPPY_HOUR_DEFAULT_FACTOR).prefault({}),
  resub: tieredReward(HAPPY_HOUR_DEFAULT_FACTOR).prefault({}),
  gift: giftReward(HAPPY_HOUR_DEFAULT_FACTOR).prefault({}),
  bits: bitsReward(HAPPY_HOUR_DEFAULT_FACTOR).prefault({}),
});

const chatCommandSchema = z.object({
  name: z
    .string()
    .regex(/^[a-zA-Z0-9]{1,20}$/, {
      message: 'nom alphanumérique de 1 à 20 caractères attendu, par exemple addtime',
    })
    .default('addtime'),

  maxSeconds: positiveSeconds.default(3_600),

  overlayText: z.string().max(40).default('Temps ajouté'),
});

const rewardsSchema = z.object({
  // Actif, abonnements, réabonnements, subs offerts et bits se lisent dans `happyHourRewards`.
  // La saisie d'un modérateur n'est jamais concernée.
  happyHour: z.boolean().default(false),
  happyHourRewards: happyHourRewardsSchema.prefault({}),

  chatCommand: chatCommandSchema.prefault({}),
  sub: tieredRewardSchema.prefault({}),
  resub: tieredRewardSchema.prefault({}),
  gift: giftRewardSchema.prefault({}),
  bits: bitsRewardSchema.prefault({}),
});

const goalTierSchema = z.object({
  // Seule la borne haute est stockée : la borne basse se dérive du palier précédent, si bien
  // qu'aucun trou ni chevauchement ne peut exister dans la configuration.
  target: z.number().int().positive(),

  label: z.string().max(GOAL_LABEL_MAX_LENGTH),
});

// L'apparence de la page /goal. Elle n'a pas de cadre, à la différence de l'overlay du compteur :
// la piste de la barre porte déjà fond, arrondi et bordure, et un cadre par-dessus dessinerait une
// seconde boîte autour de la première.
const goalOverlaySchema = z.object({
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
    .prefault({}),

  shadow: shadowSchema.prefault({}),

  outline: outlineSchema.prefault({}),

  glow: glowSchema.prefault({}),

  gradient: z
    .object({
      onText: z.boolean().default(false),
      onBar: z.boolean().default(false),
      from: hexColor.default('#FF3D7F'),
      to: hexColor.default('#FF9A3D'),
      angleDeg: z.number().int().min(0).max(360).default(100),
    })
    .prefault({}),

  announce: z
    .object({
      enabled: z.boolean().default(true),
      durationMs: millisecondsAboveZero.default(5_000),
      color: hexColor.default('#FFCC00'),

      // Vide, seul le libellé du palier s'affiche. Même longueur que le texte de la commande de
      // chat : ce qui tient sur une ligne d'overlay tient sur une ligne de bandeau.
      text: z.string().max(GOAL_LABEL_MAX_LENGTH).default('Palier atteint'),
    })
    .prefault({}),
});

const points = z.number().int().nonnegative();

interface TierWeights {
  readonly tier1: number;
  readonly tier2: number;
  readonly tier3: number;
  readonly prime: number;
}

// En mode points, un bit vaut toujours un point : il n'y a rien à régler de ce côté-là. Les
// abonnements valent au départ leur prix en bits, pour qu'un euro de soutien pèse à peu près pareil
// quelle que soit sa forme.
const DEFAULT_TIER_POINTS: TierWeights = { tier1: 500, tier2: 1_000, tier3: 2_500, prime: 500 };

// En mode subs, la barre compte des abonnements : un par abonnement, quel que soit le tier, tant
// que le streamer n'en décide pas autrement.
const DEFAULT_SUB_WEIGHTS: TierWeights = { tier1: 1, tier2: 1, tier3: 1, prime: 1 };

const DEFAULT_GOAL_UNIT_LABEL = 'points';

// Sans palier, la page /goal reste vide : une installation neuve en porte un, pour que la barre
// se montre et que le modèle se comprenne.
const DEFAULT_GOAL_TIERS = [{ target: 1_000, label: 'Objectif' }] as const;

// Le poids de chaque soutien dans la barre, par type et par tier. Les deux modes ont la même forme
// et chacun sa table : passer de l'un à l'autre ne doit pas faire valoir 500 un abonnement compté
// en abonnements.
function goalWeights(defaults: TierWeights) {
  const tiered = z.object({
    tier1: points.default(defaults.tier1),
    tier2: points.default(defaults.tier2),
    tier3: points.default(defaults.tier3),
    prime: points.default(defaults.prime),
  });

  const gift = z.object({
    tier1: points.default(defaults.tier1),
    tier2: points.default(defaults.tier2),
    tier3: points.default(defaults.tier3),
  });

  return z.object({
    sub: tiered.prefault({}),
    resub: tiered.prefault({}),
    gift: gift.prefault({}),
  });
}

const goalsSchema = z.object({
  // Ce que compte la barre : des points, où un bit vaut un point et un abonnement ce que dit
  // `points`, ou des abonnements seuls, où les bits ne comptent pas et un abonnement vaut ce que
  // dit `subWeights`.
  mode: z.enum(['points', 'subs']).default('points'),

  points: goalWeights(DEFAULT_TIER_POINTS).prefault({}),

  subWeights: goalWeights(DEFAULT_SUB_WEIGHTS).prefault({}),

  // Ce que le panneau écrit après le compte. Jamais diffusé aux spectateurs : la page /goal
  // affiche « 12 / 50 » sans unité.
  unitLabel: z.string().max(GOAL_LABEL_MAX_LENGTH).default(DEFAULT_GOAL_UNIT_LABEL),

  // Ni tri ni unicité ici : un refine qui rejette ferait tomber toute la configuration au
  // chargement. L'échelle se normalise à la lecture, et la saisie se valide dans le panneau.
  tiers: z.array(goalTierSchema).default(DEFAULT_GOAL_TIERS.map((tier) => ({ ...tier }))),

  overlay: goalOverlaySchema.prefault({}),
});

const twitchSchema = z.object({
  clientId: z.string().default(''),

  broadcasterUserId: z.string().default(''),
  broadcasterLogin: z.string().default(''),

  enableChatNotifications: z.boolean().default(true),

  enableChatCommands: z.boolean().default(false),
});

const serverSchema = z.object({
  httpPort: z.number().int().min(1).max(65_535).default(3_777),
});

const overlaySchema = z.object({
  fontFamily: z.string().min(1).default('Inter, Segoe UI, system-ui, sans-serif'),
  fontSize: z.number().int().positive().default(96),
  fontWeight: z.number().int().min(100).max(900).default(700),
  letterSpacing: z.number().default(0),
  color: hexColor.default('#FFFFFF'),

  showDays: z.boolean().default(true),
  hideEmptyHours: z.boolean().default(false),

  textAlign: z.enum(['left', 'center', 'right']).default('center'),

  shadow: shadowSchema.prefault({}),

  outline: outlineSchema.prefault({}),

  glow: glowSchema.prefault({}),

  gradient: z
    .object({
      onText: z.boolean().default(false),
      onFrame: z.boolean().default(false),
      from: hexColor.default('#FF3D7F'),
      to: hexColor.default('#FF9A3D'),
      angleDeg: z.number().int().min(0).max(360).default(100),
    })
    .prefault({}),

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
    .prefault({}),

  animation: z
    .object({
      onAdd: z.enum(['none', 'flash', 'pulse', 'shake']).default('pulse'),
      durationMs: millisecondsAboveZero.default(600),
    })
    .prefault({}),

  toast: z
    .object({
      enabled: z.boolean().default(true),
      durationMs: millisecondsAboveZero.default(4_000),
      color: hexColor.default('#9146FF'),
      fontSize: z.number().int().positive().default(28),
    })
    .prefault({}),

  enableCustomCss: z.boolean().default(false),
});

const setupSchema = z.object({
  completed: z.boolean().default(false),
});

const appSchema = z.object({
  startMinimized: z.boolean().default(false),
});

export const configSchema = z.object({
  schemaVersion: z.number().int().nonnegative().default(CONFIG_SCHEMA_VERSION),
  counter: counterSchema.prefault({}),
  rewards: rewardsSchema.prefault({}),
  goals: goalsSchema.prefault({}),
  twitch: twitchSchema.prefault({}),
  server: serverSchema.prefault({}),
  overlay: overlaySchema.prefault({}),
  setup: setupSchema.prefault({}),
  app: appSchema.prefault({}),
});

export type ChronoCastConfig = z.infer<typeof configSchema>;

export type CounterConfig = ChronoCastConfig['counter'];
export type RewardsConfig = ChronoCastConfig['rewards'];
export type GoalsConfig = ChronoCastConfig['goals'];
export type GoalTier = GoalsConfig['tiers'][number];
export type GoalOverlayConfig = GoalsConfig['overlay'];
export type TwitchConfig = ChronoCastConfig['twitch'];
export type ServerConfig = ChronoCastConfig['server'];
export type OverlayConfig = ChronoCastConfig['overlay'];
export type SetupConfig = ChronoCastConfig['setup'];
