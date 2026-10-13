/**
 * Ce qu'il faut faire d'un fichier de configuration écrit par une version antérieure, **avant** de
 * le passer par le schéma : celui-ci retire les clés qu'il ne connaît plus, et avec elles ce qui
 * permettait de les convertir.
 *
 * Rien ici ne lève. Une conversion qui échouerait ferait rejeter le fichier, et l'application
 * retomberait sur les valeurs par défaut en effaçant les réglages de l'utilisateur.
 */
export interface MigrationNote {
  readonly message: string;
  readonly context: Readonly<Record<string, string | number>>;
}

export interface PreparedConfig {
  readonly raw: unknown;

  /** Ce qui a été converti et mérite une ligne de journal. */
  readonly notes: readonly MigrationNote[];

  /**
   * Vrai quand le comptage de la barre d'objectif a été écarté du fichier : le compte en cours,
   * tenu ailleurs, n'a alors plus de sens et l'appelant doit le remettre à zéro.
   */
  readonly goalsReset: boolean;
}

type RawRecord = Record<string, unknown>;

const LEGACY_BITS_KEYS = ['mode', 'linear', 'tiers'] as const;

const TIERS_MODE = 'tiers';

function isRecord(value: unknown): value is RawRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function wholeSeconds(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

interface BitsRate {
  readonly unit?: number;
  readonly seconds?: number;
}

function rateOf(unit: number | undefined, seconds: number | undefined): BitsRate {
  return {
    ...(unit === undefined ? {} : { unit }),
    ...(seconds === undefined ? {} : { seconds }),
  };
}

function lowestTier(tiers: unknown): Required<BitsRate> | undefined {
  if (!Array.isArray(tiers)) {
    return undefined;
  }

  let lowest: Required<BitsRate> | undefined;

  for (const tier of tiers as unknown[]) {
    if (!isRecord(tier)) {
      continue;
    }

    const unit = positiveInteger(tier['minBits']);
    const seconds = wholeSeconds(tier['seconds']);
    if (unit === undefined || seconds === undefined) {
      continue;
    }

    if (lowest === undefined || unit < lowest.unit) {
      lowest = { unit, seconds };
    }
  }

  return lowest;
}

interface BitsConversion {
  readonly rate: BitsRate;
  readonly fromTiers: boolean;
}

// Avant le taux unique, les bits se réglaient par un mode : proportionnel — unité, secondes par
// unité, seuil — ou par paliers. Le taux reprend l'unité et ses secondes, ou le palier le plus bas.
function convertLegacyBits(bits: RawRecord): BitsConversion {
  const tier = bits['mode'] === TIERS_MODE ? lowestTier(bits['tiers']) : undefined;
  if (tier !== undefined) {
    return { rate: tier, fromTiers: true };
  }

  const linear = isRecord(bits['linear']) ? bits['linear'] : {};
  return {
    rate: rateOf(positiveInteger(linear['unit']), wholeSeconds(linear['secondsPerUnit'])),
    fromTiers: false,
  };
}

function isLegacyBits(value: unknown): value is RawRecord {
  return isRecord(value) && LEGACY_BITS_KEYS.some((key) => Object.hasOwn(value, key));
}

function convertBitsAt(holder: RawRecord, path: string, notes: MigrationNote[]): RawRecord {
  const bits = holder['bits'];
  if (!isLegacyBits(bits)) {
    return holder;
  }

  const { rate, fromTiers } = convertLegacyBits(bits);
  if (fromTiers) {
    notes.push({
      message: 'paliers de bits convertis en taux unique',
      context: { path, ...rate },
    });
  }

  return { ...holder, bits: rate };
}

function withConvertedBits(rewards: RawRecord, notes: MigrationNote[]): RawRecord {
  const converted = convertBitsAt(rewards, 'rewards.bits', notes);

  const happyHourRewards = converted['happyHourRewards'];
  if (!isRecord(happyHourRewards)) {
    return converted;
  }

  return {
    ...converted,
    happyHourRewards: convertBitsAt(happyHourRewards, 'rewards.happyHourRewards.bits', notes),
  };
}

// À partir de cette version du schéma, la barre d'objectif compte en points pour tout le monde.
// Le comptage d'un fichier antérieur — bits par point, points par soutien, unité, paliers — est
// écarté pour que le schéma repose ses valeurs de départ ; l'apparence de la barre reste.
const GOALS_IN_POINTS_SCHEMA_VERSION = 9;

const GOAL_APPEARANCE_KEY = 'overlay';

function predatesGoalsInPoints(raw: RawRecord): boolean {
  const version = raw['schemaVersion'];
  return typeof version === 'number' && version < GOALS_IN_POINTS_SCHEMA_VERSION;
}

function withoutGoalCounting(raw: RawRecord): RawRecord {
  const { goals, ...rest } = raw;

  return isRecord(goals) && Object.hasOwn(goals, GOAL_APPEARANCE_KEY)
    ? { ...rest, goals: { [GOAL_APPEARANCE_KEY]: goals[GOAL_APPEARANCE_KEY] } }
    : rest;
}

export function prepareRawConfig(raw: unknown): PreparedConfig {
  if (!isRecord(raw)) {
    return { raw, notes: [], goalsReset: false };
  }

  const notes: MigrationNote[] = [];
  let prepared: RawRecord = raw;

  if (isRecord(raw['rewards'])) {
    prepared = { ...prepared, rewards: withConvertedBits(raw['rewards'], notes) };
  }

  const goalsReset = predatesGoalsInPoints(raw);
  if (goalsReset) {
    prepared = withoutGoalCounting(prepared);
    notes.push({
      message: 'comptage de la barre d’objectif remis aux valeurs de départ',
      context: { fromSchemaVersion: Number(raw['schemaVersion']) },
    });
  }

  return { raw: prepared, notes, goalsReset };
}
