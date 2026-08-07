/**
 * Moteur de barème : convertit un événement en temps à créditer.
 *
 * Fonction pure. Un événement et une configuration donnent un nombre de
 * secondes, sans horloge, sans état, sans entrées-sorties. C'est ce qui rend
 * vérifiable la totalité des combinaisons — salves de gift subs, dons de bits
 * massifs, raids — sans attendre qu'elles surviennent réellement.
 *
 * **Aucune valeur n'est codée en dur ici.** Tout provient de la configuration,
 * donc du panneau d'administration : c'est l'exigence centrale du projet.
 *
 * Chaque catégorie est plafonnée. Sans plafond, un unique don de cent
 * abonnements ajouterait cinq heures d'un coup et enfermerait le streamer dans
 * un engagement qu'il n'a pas choisi.
 */

import type { RewardsConfig } from '../config/schema.js';
import type { DomainEvent, GiftTier, SubscriptionTier } from '../events/domain-event.js';

/** Résultat de l'évaluation d'un événement. */
export interface RewardComputation {
  /** Temps à créditer, en secondes. Vaut 0 lorsque rien n'est dû. */
  readonly seconds: number;

  /**
   * Vrai si l'événement a donné lieu à une récompense.
   *
   * Distinct de `seconds > 0` : un barème configuré à zéro seconde reste une
   * règle appliquée, alors qu'un follow refusé par le quota horaire ne l'est pas.
   * L'historique doit pouvoir montrer la différence.
   */
  readonly applied: boolean;

  /** Explication lisible, destinée à l'historique et à la bulle de l'overlay. */
  readonly reason: string;
}

/** Informations d'état nécessaires à certaines règles anti-abus. */
export interface RewardContext {
  /**
   * Nombre de follows déjà récompensés sur l'heure glissante.
   *
   * Fourni par l'appelant afin que ce module reste pur : le comptage relève du
   * service, l'arbitrage relève du barème.
   */
  readonly followsInLastHour?: number;
}

function refused(reason: string): RewardComputation {
  return { seconds: 0, applied: false, reason };
}

function granted(seconds: number, reason: string): RewardComputation {
  return { seconds, applied: true, reason };
}

/** Applique un plafond en signalant explicitement lorsqu'il a joué. */
function capped(seconds: number, maximum: number, reason: string): RewardComputation {
  if (seconds <= maximum) {
    return granted(seconds, reason);
  }
  return granted(maximum, `${reason} (plafonné à ${String(maximum)} s)`);
}

/** Récompense associée à un palier d'abonnement. */
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

/** Récompense unitaire d'un abonnement offert. */
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

/** Évaluation d'un don de bits selon le mode de barème configuré. */
function computeBitsReward(bits: number, config: RewardsConfig['bits']): RewardComputation {
  if (bits <= 0) {
    return refused('nombre de bits invalide');
  }

  if (config.mode === 'tiers') {
    // Le tableau vient de l'utilisateur : il peut arriver dans n'importe quel
    // ordre. On retient le palier atteint le plus généreux plutôt que de se fier
    // à la position dans la liste.
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

  // Division entière : le streamer ne doit pas avoir à justifier des secondes à
  // la virgule, et une unité entamée n'est pas une unité.
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

/**
 * Évalue le temps dû pour un événement.
 *
 * @param event Événement normalisé.
 * @param rewards Barème, issu de la configuration.
 * @param context État complémentaire requis par les règles anti-abus.
 */
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

      // Garde-fou anti robots : sans lui, une attaque automatisée pourrait
      // prolonger le subathon indéfiniment.
      const recent = context.followsInLastHour ?? 0;
      if (recent >= rewards.follow.maxPerHour) {
        return refused(`quota horaire de ${String(rewards.follow.maxPerHour)} follow(s) atteint`);
      }

      return granted(rewards.follow.seconds, 'follow');
    }

    case 'command': {
      // Le seul cas où les secondes viennent de l'événement : c'est un
      // modérateur qui les a tapées. Le moteur reste malgré tout la seule
      // réponse à « combien de secondes », et il y applique le plafond.
      if (!Number.isFinite(event.seconds) || event.seconds <= 0) {
        // `applyAdd` refuse tout delta négatif ou nul **sans rien signaler** :
        // sans ce refus, le compteur ne bougerait pas alors que l'historique
        // dirait l'événement appliqué, et la panne serait introuvable.
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
