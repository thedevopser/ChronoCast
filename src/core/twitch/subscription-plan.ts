/**
 * Plan déclaratif des souscriptions EventSub.
 *
 * **Point d'extension unique de l'application.** Ajouter un événement Twitch se
 * réduit à une entrée dans ce tableau et un cas dans `event-mapper.ts` : ni le
 * client WebSocket, ni le service compteur, ni l'interface n'ont à changer.
 *
 * Le plan porte également la correspondance entre souscriptions et portées
 * OAuth. C'est elle qui permet d'annoncer à l'utilisateur « il vous manque telle
 * autorisation » plutôt que de le laisser face à un compteur qui ne bouge pas —
 * symptôme réel d'une portée oubliée lors de l'authentification.
 */

import type { TwitchConfig } from '../config/schema.js';

/** Identités nécessaires à la construction des conditions. */
export interface SubscriptionContext {
  /** Chaîne surveillée. */
  readonly broadcasterUserId: string;

  /** Compte authentifié, qui lit le chat et modère. */
  readonly userId: string;
}

/** Déclaration d'une souscription possible. */
export interface SubscriptionDefinition {
  readonly type: string;

  /** Twitch versionne ses souscriptions ; l'omettre fait échouer la création. */
  readonly version: string;

  /** Portées OAuth exigées par Twitch pour cette souscription. */
  readonly scopes: readonly string[];

  /**
   * Indique si l'absence de cette souscription compromet le fonctionnement.
   *
   * Une souscription facultative qui échoue est signalée sans interrompre la
   * connexion : un raid qui ne se souscrit pas ne doit pas arrêter le subathon.
   */
  readonly required: boolean;

  /** Détermine si la configuration courante active cette souscription. */
  readonly isEnabled: (config: TwitchConfig) => boolean;

  /** Construit la condition attendue par Twitch. */
  readonly buildCondition: (context: SubscriptionContext) => Record<string, string>;
}

/** Souscription prête à être créée auprès de Helix. */
export interface ResolvedSubscription {
  readonly type: string;
  readonly version: string;
  readonly required: boolean;
  readonly condition: Record<string, string>;
}

/** Condition la plus courante : cibler la chaîne surveillée. */
function broadcasterCondition(context: SubscriptionContext): Record<string, string> {
  return { broadcaster_user_id: context.broadcasterUserId };
}

/**
 * Catalogue complet des souscriptions.
 *
 * L'ordre a son importance : `channel.chat.notification` figure en premier
 * parce que c'est la source primaire des abonnements. En cas de doublon
 * sémantique avec `channel.subscribe`, c'est elle qui aura été traitée, donc
 * elle qui aura fixé le palier — seul ce flux distingue Prime de Tier 1.
 */
export const SUBSCRIPTION_PLAN: readonly SubscriptionDefinition[] = [
  {
    type: 'channel.chat.notification',
    version: '1',
    // `user:bot` autorise le compte à être vu comme un lecteur de chat.
    scopes: ['user:read:chat', 'user:bot'],
    required: false,
    isEnabled: (config) => config.enableChatNotifications,
    buildCondition: (context) => ({
      broadcaster_user_id: context.broadcasterUserId,
      // Twitch exige de savoir au nom de quel compte le chat est lu.
      user_id: context.userId,
    }),
  },
  {
    type: 'channel.subscribe',
    version: '1',
    scopes: ['channel:read:subscriptions'],
    required: true,
    isEnabled: () => true,
    buildCondition: broadcasterCondition,
  },
  {
    type: 'channel.subscription.message',
    version: '1',
    scopes: ['channel:read:subscriptions'],
    required: true,
    isEnabled: () => true,
    buildCondition: broadcasterCondition,
  },
  {
    type: 'channel.subscription.gift',
    version: '1',
    scopes: ['channel:read:subscriptions'],
    required: true,
    isEnabled: () => true,
    buildCondition: broadcasterCondition,
  },
  {
    type: 'channel.cheer',
    version: '1',
    scopes: ['bits:read'],
    required: true,
    isEnabled: () => true,
    buildCondition: broadcasterCondition,
  },
  {
    type: 'channel.raid',
    version: '1',
    // Aucune autorisation particulière : un raid est une information publique.
    scopes: [],
    required: false,
    isEnabled: (config) => config.enableRaid,
    buildCondition: (context) => ({ to_broadcaster_user_id: context.broadcasterUserId }),
  },
  {
    type: 'channel.follow',
    // La version 1 est dépréciée et n'accepte plus de nouvelles souscriptions.
    version: '2',
    scopes: ['moderator:read:followers'],
    required: false,
    isEnabled: (config) => config.enableFollow,
    buildCondition: (context) => ({
      broadcaster_user_id: context.broadcasterUserId,
      moderator_user_id: context.userId,
    }),
  },
];

/** Souscriptions à créer pour la configuration courante. */
export function resolveSubscriptions(
  config: TwitchConfig,
  context: SubscriptionContext,
): ResolvedSubscription[] {
  return SUBSCRIPTION_PLAN.filter((definition) => definition.isEnabled(config)).map(
    (definition) => ({
      type: definition.type,
      version: definition.version,
      required: definition.required,
      condition: definition.buildCondition(context),
    }),
  );
}

/**
 * Portées OAuth à demander pour la configuration courante.
 *
 * Calculées et non figées : activer la détection Prime ou les follows change les
 * autorisations nécessaires, et l'assistant doit les demander en une seule fois
 * pour éviter à l'utilisateur une seconde authentification.
 */
export function requiredScopes(config: TwitchConfig): string[] {
  const scopes = new Set<string>();

  for (const definition of SUBSCRIPTION_PLAN) {
    if (!definition.isEnabled(config)) {
      continue;
    }
    for (const scope of definition.scopes) {
      scopes.add(scope);
    }
  }

  return [...scopes];
}
