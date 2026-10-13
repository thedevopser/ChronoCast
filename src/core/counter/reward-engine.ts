import type { RewardsConfig } from '../config/schema.js';
import type { DomainEvent, GiftTier, SubscriptionTier } from '../events/domain-event.js';

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

function computeBitsReward(bits: number, config: RewardsConfig['bits']): RewardComputation {
  if (bits <= 0) {
    return refused('nombre de bits invalide');
  }

  if (config.mode === 'tiers') {
    const matching = config.tiers.filter((tier) => bits >= tier.minBits);
    if (matching.length === 0) {
      return refused(`${String(bits)} bits, sous le premier palier`);
    }

    const best = matching.reduce((highest, candidate) =>
      candidate.minBits > highest.minBits ? candidate : highest,
    );

    return granted(best.seconds, `${String(bits)} bits, palier ${String(best.minBits)}`);
  }

  if (bits < config.linear.minBits) {
    return refused(`${String(bits)} bits, sous le seuil de ${String(config.linear.minBits)}`);
  }

  const units = Math.floor(bits / config.linear.unit);
  if (units <= 0) {
    return refused(`${String(bits)} bits, moins d'une unité de ${String(config.linear.unit)}`);
  }

  return granted(
    units * config.linear.secondsPerUnit,
    `${String(bits)} bits, ${String(units)} unité(s)`,
  );
}

const HAPPY_HOUR_MULTIPLIER = 2;

const HAPPY_HOUR_MENTION = 'Happy Hour';

function computeBaseReward(event: DomainEvent, rewards: RewardsConfig): RewardComputation {
  const subscriptions = rewards.happyHour ? rewards.happyHourRewards : rewards;
  const mention = rewards.happyHour ? `, ${HAPPY_HOUR_MENTION}` : '';

  switch (event.type) {
    case 'sub':
      return granted(tierSeconds(subscriptions.sub, event.tier), `abonnement ${event.tier}${mention}`);

    case 'resub':
      return granted(
        tierSeconds(subscriptions.resub, event.tier),
        `réabonnement ${event.tier}, ${String(event.cumulativeMonths)} mois${mention}`,
      );

    case 'gift': {
      if (event.total <= 0) {
        return refused("nombre d'abonnements offerts invalide");
      }

      const unitSeconds = giftTierSeconds(subscriptions.gift, event.tier);
      return granted(
        unitSeconds * event.total,
        `${String(event.total)} abonnement(s) offert(s) ${event.tier}${mention}`,
      );
    }

    case 'bits':
      return computeBitsReward(event.bits, rewards.bits);

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

export function computeReward(event: DomainEvent, rewards: RewardsConfig): RewardComputation {
  const base = computeBaseReward(event, rewards);

  // Les abonnements ont leur barème Happy Hour ; seuls les bits passent encore par le doublement,
  // qui ne touche pas à leurs seuils d'entrée.
  if (!rewards.happyHour || !base.applied || event.type !== 'bits') {
    return base;
  }

  return {
    ...base,
    seconds: base.seconds * HAPPY_HOUR_MULTIPLIER,
    reason: `${base.reason}, ${HAPPY_HOUR_MENTION} ×${String(HAPPY_HOUR_MULTIPLIER)}`,
  };
}
