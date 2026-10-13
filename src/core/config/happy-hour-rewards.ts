import { HAPPY_HOUR_DEFAULT_FACTOR, type ChronoCastConfig, type RewardsConfig } from './schema.js';

type SecondsTable = Readonly<Record<string, number>>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function writtenHappyHourRewards(raw: unknown): Record<string, unknown> {
  const rewards = isPlainObject(raw) ? raw['rewards'] : undefined;
  const written = isPlainObject(rewards) ? rewards['happyHourRewards'] : undefined;

  return isPlainObject(written) ? written : {};
}

function scaled<T extends SecondsTable>(table: T): T {
  return Object.fromEntries(
    Object.entries(table).map(([tier, seconds]) => [tier, seconds * HAPPY_HOUR_DEFAULT_FACTOR]),
  ) as T;
}

// Seules les secondes doublent : le nombre de bits du taux se recopie tel quel.
function scaledBits(bits: RewardsConfig['bits']): RewardsConfig['bits'] {
  return { unit: bits.unit, seconds: bits.seconds * HAPPY_HOUR_DEFAULT_FACTOR };
}

/**
 * Pose le barème Happy Hour d'une configuration écrite avant qu'il existe.
 *
 * Les défauts du schéma ignorent le barème du streamer : sans cette dérivation, quelqu'un qui a
 * réglé 300 s par abonnement verrait son Happy Hour passer de 600 s à 360 s en mettant à jour.
 * Seuls les barèmes absents du fichier lu sont dérivés ; ce qui a été écrit n'est jamais retouché.
 */
export function withDerivedHappyHourRewards(raw: unknown, config: ChronoCastConfig): ChronoCastConfig {
  const written = writtenHappyHourRewards(raw);
  const { rewards } = config;
  const current = rewards.happyHourRewards;

  return {
    ...config,
    rewards: {
      ...rewards,
      happyHourRewards: {
        sub: Object.hasOwn(written, 'sub') ? current.sub : scaled(rewards.sub),
        resub: Object.hasOwn(written, 'resub') ? current.resub : scaled(rewards.resub),
        gift: Object.hasOwn(written, 'gift') ? current.gift : scaled(rewards.gift),
        bits: Object.hasOwn(written, 'bits') ? current.bits : scaledBits(rewards.bits),
      },
    },
  };
}
