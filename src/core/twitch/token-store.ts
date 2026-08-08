import type { SecretStore } from '../app/ports.js';
import type { Logger } from '../logging/logger.js';
import type { Redactor } from '../logging/redaction.js';

const STORAGE_KEY = 'twitch-credentials';

export interface TwitchCredentials {
  readonly clientSecret: string;

  readonly accessToken: string;
  readonly refreshToken: string;

  readonly expiresAt: number;

  readonly scopes: readonly string[];
}

export interface TokenStore {
  load(): Promise<TwitchCredentials | null>;

  save(credentials: TwitchCredentials): Promise<void>;

  clear(): Promise<void>;
}

export interface TokenStoreOptions {
  readonly secretStore: SecretStore;
  readonly redactor: Redactor;
  readonly logger: Logger;
}

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

      registerSecrets(decoded);
      return decoded;
    },

    async save(credentials: TwitchCredentials): Promise<void> {
      if (!secretStore.isEncryptionAvailable()) {
        logger.warning(
          "le chiffrement du système n'est pas disponible : les identifiants Twitch seront moins bien protégés",
        );
      }

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
