import type { RewardsConfig } from '../config/schema.js';
import type { DomainEvent, GiftTier, SubscriptionTier } from '../events/domain-event.js';

export interface RewardComputation {
  readonly seconds: number;

  readonly applied: boolean;

  readonly reason: string;
}

export interface RewardContext {
  readonly followsInLastHour?: number;
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

    return capped(
      best.seconds,
      config.maxPerEvent,
      `${String(bits)} bits, palier ${String(best.minBits)}`,
    );
  }

  if (bits < config.linear.minBits) {
    return refused(`${String(bits)} bits, sous le seuil de ${String(config.linear.minBits)}`);
  }

  const units = Math.floor(bits / config.linear.unit);
  if (units <= 0) {
    return refused(`${String(bits)} bits, moins d'une unité de ${String(config.linear.unit)}`);
  }

  return capped(
    units * config.linear.secondsPerUnit,
    config.maxPerEvent,
    `${String(bits)} bits, ${String(units)} unité(s)`,
  );
}

export function computeReward(
  event: DomainEvent,
  rewards: RewardsConfig,
  context: RewardContext = {},
): RewardComputation {
  switch (event.type) {
    case 'sub':
      return granted(tierSeconds(rewards.sub, event.tier), `abonnement ${event.tier}`);

    case 'resub':
      return granted(
        tierSeconds(rewards.resub, event.tier),
        `réabonnement ${event.tier}, ${String(event.cumulativeMonths)} mois`,
      );

    case 'gift': {
      if (event.total <= 0) {
        return refused("nombre d'abonnements offerts invalide");
      }

      const unitSeconds = giftTierSeconds(rewards.gift, event.tier);
      return capped(
        unitSeconds * event.total,
        rewards.gift.maxPerEvent,
        `${String(event.total)} abonnement(s) offert(s) ${event.tier}`,
      );
    }

    case 'bits':
      return computeBitsReward(event.bits, rewards.bits);

    case 'raid': {
      if (!rewards.raid.enabled) {
        return refused('récompense de raid désactivée');
      }
      if (event.viewers < rewards.raid.minViewers) {
        return refused(
          `raid de ${String(event.viewers)} spectateur(s), sous le seuil de ${String(rewards.raid.minViewers)}`,
        );
      }

      return capped(
        event.viewers * rewards.raid.secondsPerViewer,
        rewards.raid.maxSeconds,
        `raid de ${String(event.viewers)} spectateur(s)`,
      );
    }

    case 'follow': {
      if (!rewards.follow.enabled) {
        return refused('récompense de follow désactivée');
      }

      const recent = context.followsInLastHour ?? 0;
      if (recent >= rewards.follow.maxPerHour) {
        return refused(`quota horaire de ${String(rewards.follow.maxPerHour)} follow(s) atteint`);
      }

      return granted(rewards.follow.seconds, 'follow');
    }

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
