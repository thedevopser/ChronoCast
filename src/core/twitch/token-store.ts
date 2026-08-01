/**
 * Magasin des identifiants Twitch.
 *
 * Point de convergence des trois secrets de ChronoCast : le secret client de
 * l'application, le jeton d'accès et le jeton de rafraîchissement.
 *
 * Deux responsabilités que rien d'autre ne couvre :
 *
 *   1. **Le chiffrement au repos**, délégué au port `SecretStore`. Sous Windows,
 *      l'implémentation s'appuie sur `safeStorage`, adossé à DPAPI : le
 *      chiffrement est lié au compte utilisateur, si bien qu'un autre compte de
 *      la même machine ne peut pas déchiffrer les jetons.
 *   2. **L'enregistrement des valeurs auprès du rédacteur.** Dès qu'un jeton est
 *      connu, il devient impossible de le faire apparaître dans un log, où qu'il
 *      se glisse — message d'erreur, URL, pile d'appels. C'est ce qui transforme
 *      la protection des secrets en garantie plutôt qu'en discipline.
 */

import type { SecretStore } from '../app/ports.js';
import type { Logger } from '../logging/logger.js';
import type { Redactor } from '../logging/redaction.js';

/** Clé sous laquelle les identifiants sont conservés. */
const STORAGE_KEY = 'twitch-credentials';

/** Identifiants complets d'une session Twitch authentifiée. */
export interface TwitchCredentials {
  /** Secret de l'application, saisi une fois dans l'assistant. */
  readonly clientSecret: string;

  readonly accessToken: string;
  readonly refreshToken: string;

  /** Expiration du jeton d'accès, en millisecondes depuis l'époque. */
  readonly expiresAt: number;

  /** Portées réellement accordées par Twitch, qui peuvent différer du demandé. */
  readonly scopes: readonly string[];
}

export interface TokenStore {
  /** Relit les identifiants. Renvoie `null` si aucun n'est exploitable. */
  load(): Promise<TwitchCredentials | null>;

  /**
   * Enregistre les identifiants et les déclare au rédacteur.
   * @throws si le magasin de secrets refuse l'écriture.
   */
  save(credentials: TwitchCredentials): Promise<void>;

  /** Efface les identifiants et cesse de les masquer dans les logs. */
  clear(): Promise<void>;
}

export interface TokenStoreOptions {
  readonly secretStore: SecretStore;
  readonly redactor: Redactor;
  readonly logger: Logger;
}

/** Vrai si la valeur relue a la forme attendue. */
function isCredentials(value: unknown): value is TwitchCredentials {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['clientSecret'] === 'string' &&
    typeof candidate['accessToken'] === 'string' &&
    typeof candidate['refreshToken'] === 'string' &&
    typeof candidate['expiresAt'] === 'number' &&
    Array.isArray(candidate['scopes']) &&
    candidate['scopes'].every((scope) => typeof scope === 'string')
  );
}

export function createTokenStore(options: TokenStoreOptions): TokenStore {
  const { secretStore, redactor, logger } = options;

  /**
   * Dernières valeurs déclarées au rédacteur.
   *
   * Conservées pour pouvoir les retirer lors d'un renouvellement ou d'un
   * effacement : un jeton révoqué n'est plus un secret, et continuer à le
   * masquer encombrerait les logs sans rien protéger.
   */
  let registered: readonly string[] = [];

  function registerSecrets(credentials: TwitchCredentials): void {
    for (const secret of registered) {
      redactor.forgetSecret(secret);
    }

    registered = [credentials.clientSecret, credentials.accessToken, credentials.refreshToken];
    for (const secret of registered) {
      redactor.registerSecret(secret);
    }
  }

  return {
    async load(): Promise<TwitchCredentials | null> {
      let raw: string | null;
      try {
        raw = await secretStore.read(STORAGE_KEY);
      } catch (error) {
        logger.warning('lecture des identifiants Twitch impossible', { cause: error });
        return null;
      }

      if (raw === null) {
        logger.debug('aucun identifiant Twitch enregistré');
        return null;
      }

      let decoded: unknown;
      try {
        decoded = JSON.parse(raw);
      } catch (error) {
        logger.warning('identifiants Twitch illisibles, réauthentification requise', {
          cause: error,
        });
        return null;
      }

      if (!isCredentials(decoded)) {
        logger.warning('identifiants Twitch incomplets, réauthentification requise');
        return null;
      }

      // Déclaration au rédacteur dès la relecture : au lancement suivant, les
      // jetons viennent du disque et non d'un appel à save, mais ils doivent
      // être protégés tout autant.
      registerSecrets(decoded);
      return decoded;
    },

    async save(credentials: TwitchCredentials): Promise<void> {
      if (!secretStore.isEncryptionAvailable()) {
        // Averti mais pas bloquant : refuser d'enregistrer rendrait
        // l'application inutilisable, l'utilisateur doit pouvoir décider.
        logger.warning(
          "le chiffrement du système n'est pas disponible : les identifiants Twitch seront moins bien protégés",
        );
      }

      // L'échec est propagé : ne pas pouvoir enregistrer un jeton fraîchement
      // obtenu doit être visible, sinon l'utilisateur devra se réauthentifier au
      // prochain démarrage sans comprendre pourquoi.
      await secretStore.write(STORAGE_KEY, JSON.stringify(credentials));

      registerSecrets(credentials);
      logger.info('identifiants Twitch enregistrés', {
        expiresAt: new Date(credentials.expiresAt).toISOString(),
        scopes: credentials.scopes,
      });
    },

    async clear(): Promise<void> {
      try {
        await secretStore.delete(STORAGE_KEY);
      } catch (error) {
        logger.warning('effacement des identifiants Twitch impossible', { cause: error });
      }

      for (const secret of registered) {
        redactor.forgetSecret(secret);
      }
      registered = [];

      logger.info('identifiants Twitch effacés');
    },
  };
}
