import type { RewardsConfig } from '../config/schema.js';
import type {
  BitsUsage,
  DomainEvent,
  GiftTier,
  SubscriptionTier,
} from '../events/domain-event.js';

export interface RewardComputation {
  readonly seconds: number;

  readonly applied: boolean;

  readonly reason: string;
}

function refused(reason: string): RewardComputation {
  return { seconds: 0, applied: false, reason };
}

function granted(seconds: number, reason: string): RewardComputation {
  return { seconds, applied: true, reason };
}

function capped(seconds: number, maximum: number, reason: string): RewardComputation {
  if (seconds <= maximum) {
    return granted(seconds, reason);
  }
  return granted(maximum, `${reason} (plafonné à ${String(maximum)} s)`);
}

function tierSeconds(
  table: { readonly tier1: number; readonly tier2: number; readonly tier3: number; readonly prime: number },
  tier: SubscriptionTier,
): number {
  switch (tier) {
    case 'tier1':
      return table.tier1;
    case 'tier2':
      return table.tier2;
    case 'tier3':
      return table.tier3;
    case 'prime':
      return table.prime;
  }
}

function giftTierSeconds(
  table: { readonly tier1: number; readonly tier2: number; readonly tier3: number },
  tier: GiftTier,
): number {
  switch (tier) {
    case 'tier1':
      return table.tier1;
    case 'tier2':
      return table.tier2;
    case 'tier3':
      return table.tier3;
  }
}

const BITS_USAGE_MENTIONS: Readonly<Record<BitsUsage, string>> = {
  cheer: '',
  power_up: ' en Power-up',
  custom_power_up: ' en Power-up personnalisé',
  unknown: ' d’origine inconnue',
};

const MILLISECONDS_PER_SECOND = 1_000;

// Chaque bit compte : le taux s'applique au bit près, et le crédit garde ses décimales jusqu'à la
// milliseconde, qui est la précision du compteur.
function computeBitsReward(
  bits: number,
  usage: BitsUsage,
  rate: RewardsConfig['bits'],
): RewardComputation {
  if (bits <= 0) {
    return refused('nombre de bits invalide');
  }

  const spent = `${String(bits)} bits${BITS_USAGE_MENTIONS[usage]}`;
  const seconds =
    Math.round(((bits * rate.seconds) / rate.unit) * MILLISECONDS_PER_SECOND) /
    MILLISECONDS_PER_SECOND;

  return seconds > 0 ? granted(seconds, spent) : refused(`${spent}, sans crédit à ce taux`);
}

const HAPPY_HOUR_MENTION = 'Happy Hour';

function mentioned(reward: RewardComputation, mention: string): RewardComputation {
  return reward.applied ? { ...reward, reason: `${reward.reason}${mention}` } : reward;
}

// Le Happy Hour n'est qu'un choix de barème, seuils d'entrée compris. La commande de chat n'en a
// pas : un modérateur qui tape 300 veut créditer 300.
export function computeReward(event: DomainEvent, rewards: RewardsConfig): RewardComputation {
  const table = rewards.happyHour ? rewards.happyHourRewards : rewards;
  const mention = rewards.happyHour ? `, ${HAPPY_HOUR_MENTION}` : '';

  switch (event.type) {
    case 'sub':
      return granted(tierSeconds(table.sub, event.tier), `abonnement ${event.tier}${mention}`);

    case 'resub':
      return granted(
        tierSeconds(table.resub, event.tier),
        `réabonnement ${event.tier}, ${String(event.cumulativeMonths)} mois${mention}`,
      );

    case 'gift': {
      if (event.total <= 0) {
        return refused("nombre d'abonnements offerts invalide");
      }

      const unitSeconds = giftTierSeconds(table.gift, event.tier);
      return granted(
        unitSeconds * event.total,
        `${String(event.total)} abonnement(s) offert(s) ${event.tier}${mention}`,
      );
    }

    case 'bits':
      return mentioned(computeBitsReward(event.bits, event.usage ?? 'cheer', table.bits), mention);

    case 'command': {
      if (!Number.isFinite(event.seconds) || event.seconds <= 0) {
        return refused(`durée invalide pour !${event.command}`);
      }

      return capped(
        Math.trunc(event.seconds),
        rewards.chatCommand.maxSeconds,
        `commande !${event.command}`,
      );
    }
  }
}
