/**
 * Fin du flux d'autorisation : du code reçu à une connexion EventSub vivante.
 *
 * C'est l'enchaînement le plus critique de la première configuration. Il touche
 * au magasin de secrets, à Twitch, à la configuration persistée et au client
 * EventSub — quatre choses qu'on ne peut pas observer depuis le composition
 * root. D'où ce module : toutes les dépendances sont injectées, l'ordre des
 * opérations est vérifiable, et `application.ts` n'a plus qu'à câbler.
 *
 * L'ordre n'est pas cosmétique. Le client EventSub lit l'identité de la chaîne
 * à son démarrage : le relancer avant d'avoir écrit cette identité le ferait
 * repartir à vide, et le streamer verrait une connexion « établie » qui ne
 * souscrit à rien.
 */

import type { Logger } from '../logging/logger.js';
import type { TokenValidation } from './oauth-service.js';
import type { TwitchCredentials } from './token-store.js';

/** Chaîne dont ChronoCast suit les événements. */
export interface BroadcasterIdentity {
  readonly userId: string;
  readonly login: string;
}

export interface OAuthCompletionOptions {
  readonly exchangeCode: (code: string, clientSecret: string) => Promise<TwitchCredentials>;
  readonly validate: (accessToken: string) => Promise<TokenValidation>;
  readonly findMissingScopes: (granted: readonly string[]) => string[];

  /** Secret client, écrit par l'assistant avant le lancement du flux. */
  readonly readClientSecret: () => Promise<string | null>;

  readonly getBroadcaster: () => BroadcasterIdentity;
  readonly updateBroadcaster: (identity: BroadcasterIdentity) => Promise<void>;

  /** Rouvre la connexion EventSub avec la nouvelle identité et le nouveau jeton. */
  readonly restartTwitch: () => Promise<void>;

  readonly logger: Logger;
}

/**
 * Conclut le flux à partir du code d'autorisation.
 *
 * Lève si l'une des étapes échoue : c'est ce qui permet au serveur de rappel de
 * renvoyer l'utilisateur dans l'assistant avec une issue négative plutôt que de
 * lui laisser croire à une connexion établie.
 */
export function createOAuthCompletion(
  options: OAuthCompletionOptions,
): (code: string) => Promise<void> {
  const scoped = options.logger.child('oauth');

  return async function complete(code: string): Promise<void> {
    const clientSecret = await options.readClientSecret();
    if (clientSecret === null || clientSecret === '') {
      // Partir quand même produirait une erreur d'API que l'utilisateur n'a
      // aucun moyen de relier à l'étape de l'assistant qu'il a sautée.
      throw new Error(
        'Secret client absent : renseignez-le dans l’assistant avant de vous connecter.',
      );
    }

    const credentials = await options.exchangeCode(code, clientSecret);

    // L'identité vient de Twitch et non d'une saisie : la demander à
    // l'utilisateur serait une faute de frappe en puissance, et elle ne se
    // verrait qu'à l'absence d'événements, des heures plus tard.
    const validation = await options.validate(credentials.accessToken);

    const missing = options.findMissingScopes(credentials.scopes);
    if (missing.length > 0) {
      // Pas un échec. `channel.chat.notification` est facultative depuis la
      // Phase 3 : sans elle le subathon fonctionne, Prime étant simplement
      // traité comme un Tier 1. Refuser la connexion priverait l'utilisateur
      // d'un produit qui marche.
      scoped.warning('portées non accordées : certaines sources resteront inactives', {
        missing,
      });
    }

    const broadcaster = options.getBroadcaster();
    if (broadcaster.userId === '') {
      await options.updateBroadcaster({ userId: validation.userId, login: validation.login });
    } else {
      // Le compte qui autorise n'est pas toujours celui de la chaîne : un bot
      // ou un modérateur peut avoir été branché exprès. Écraser ce réglage
      // ferait décrocher les événements sans rien expliquer.
      scoped.info('chaîne déjà configurée : identité du compte connecté non reportée', {
        broadcasterLogin: broadcaster.login,
        connectedLogin: validation.login,
      });
    }

    await options.restartTwitch();
  };
}
