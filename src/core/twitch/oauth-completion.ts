import type { Logger } from '../logging/logger.js';
import type { TokenValidation } from './oauth-service.js';
import type { TwitchCredentials } from './token-store.js';

export interface BroadcasterIdentity {
  readonly userId: string;
  readonly login: string;
}

export interface OAuthCompletionOptions {
  readonly exchangeCode: (code: string, clientSecret: string) => Promise<TwitchCredentials>;
  readonly validate: (accessToken: string) => Promise<TokenValidation>;
  readonly findMissingScopes: (granted: readonly string[]) => string[];

  readonly readClientSecret: () => Promise<string | null>;

  readonly getBroadcaster: () => BroadcasterIdentity;
  readonly updateBroadcaster: (identity: BroadcasterIdentity) => Promise<void>;

  readonly restartTwitch: () => Promise<void>;

  readonly logger: Logger;
}

export function createOAuthCompletion(
  options: OAuthCompletionOptions,
): (code: string) => Promise<void> {
  const scoped = options.logger.child('oauth');

  return async function complete(code: string): Promise<void> {
    const clientSecret = await options.readClientSecret();
    if (clientSecret === null || clientSecret === '') {
      throw new Error(
        'Secret client absent : renseignez-le dans l’assistant avant de vous connecter.',
      );
    }

    const credentials = await options.exchangeCode(code, clientSecret);

    const validation = await options.validate(credentials.accessToken);

    const missing = options.findMissingScopes(credentials.scopes);
    if (missing.length > 0) {
      scoped.warning('portées non accordées : certaines sources resteront inactives', {
        missing,
      });
    }

    const broadcaster = options.getBroadcaster();
    if (broadcaster.userId === '') {
      await options.updateBroadcaster({ userId: validation.userId, login: validation.login });
    } else {
      scoped.info('chaîne déjà configurée : identité du compte connecté non reportée', {
        broadcasterLogin: broadcaster.login,
        connectedLogin: validation.login,
      });
    }

    await options.restartTwitch();
  };
}
