import { describe, expect, it } from 'vitest';

import { createLogger } from '../../../src/core/logging/logger.js';
import { createOAuthCompletion } from '../../../src/core/twitch/oauth-completion.js';
import type { TwitchCredentials } from '../../../src/core/twitch/token-store.js';
import type { TokenValidation } from '../../../src/core/twitch/oauth-service.js';

const CREDENTIALS: TwitchCredentials = {
  clientSecret: 'secret-client',
  accessToken: 'jeton-acces',
  refreshToken: 'jeton-renouvellement',
  expiresAt: 1_000_000,
  scopes: ['channel:read:subscriptions', 'bits:read'],
};

const VALIDATION: TokenValidation = {
  clientId: 'id-client',
  login: 'streameuse',
  userId: '123456',
  scopes: ['channel:read:subscriptions', 'bits:read'],
};

interface HarnessOptions {
  readonly clientSecret?: string | null;
  readonly broadcasterUserId?: string;
  readonly broadcasterLogin?: string;
  readonly exchange?: () => Promise<TwitchCredentials>;
  readonly validate?: () => Promise<TokenValidation>;
  readonly missingScopes?: readonly string[];
  readonly restart?: () => Promise<void>;
}

function createHarness(options: HarnessOptions = {}) {
  const exchanges: { code: string; secret: string }[] = [];
  const validated: string[] = [];
  const patches: unknown[] = [];
  const order: string[] = [];

  let broadcasterUserId = options.broadcasterUserId ?? '';
  let broadcasterLogin = options.broadcasterLogin ?? '';

  const complete = createOAuthCompletion({
    exchangeCode: async (code, secret) => {
      exchanges.push({ code, secret });
      order.push('échange');
      return await (options.exchange?.() ?? Promise.resolve(CREDENTIALS));
    },
    validate: async (accessToken) => {
      validated.push(accessToken);
      order.push('validation');
      return await (options.validate?.() ?? Promise.resolve(VALIDATION));
    },
    findMissingScopes: () => [...(options.missingScopes ?? [])],
    readClientSecret: () =>
      Promise.resolve(options.clientSecret === undefined ? 'secret-client' : options.clientSecret),
    getBroadcaster: () => ({ userId: broadcasterUserId, login: broadcasterLogin }),
    updateBroadcaster: (identity) => {
      patches.push(identity);
      order.push('configuration');
      broadcasterUserId = identity.userId;
      broadcasterLogin = identity.login;
      return Promise.resolve();
    },
    restartTwitch: async () => {
      order.push('redémarrage');
      await (options.restart?.() ?? Promise.resolve());
    },
    logger: createLogger({ level: 'error', sinks: [] }),
  });

  return { complete, exchanges, validated, patches, order };
}

describe('createOAuthCompletion', () => {
  describe('secret client', () => {
    it('échange le code avec le secret enregistré', async () => {
      const harness = createHarness();

      await harness.complete('code-recu');

      expect(harness.exchanges).toStrictEqual([{ code: 'code-recu', secret: 'secret-client' }]);
    });

    it('refuse de partir sans secret, avec un message compréhensible', async () => {
      const harness = createHarness({ clientSecret: null });

      await expect(harness.complete('code-recu')).rejects.toThrow(/secret/iu);
      expect(harness.exchanges).toStrictEqual([]);
    });
  });

  describe('identité de la chaîne', () => {
    it('valide le jeton fraîchement obtenu', async () => {
      const harness = createHarness();

      await harness.complete('code');

      expect(harness.validated).toStrictEqual(['jeton-acces']);
    });

    it('enregistre l’identité rapportée par Twitch', async () => {
      const harness = createHarness();

      await harness.complete('code');

      expect(harness.patches).toStrictEqual([{ userId: '123456', login: 'streameuse' }]);
    });

    it('ne remplace pas une chaîne déjà configurée', async () => {
      const harness = createHarness({ broadcasterUserId: '999', broadcasterLogin: 'la-chaine' });

      await harness.complete('code');

      expect(harness.patches).toStrictEqual([]);
    });
  });

  describe('portées', () => {
    it('aboutit malgré une portée facultative manquante', async () => {
      const harness = createHarness({ missingScopes: ['user:read:chat'] });

      await expect(harness.complete('code')).resolves.toBeUndefined();
      expect(harness.order).toContain('redémarrage');
    });
  });

  describe('enchaînement', () => {
    it('remet Twitch en route après avoir écrit la configuration', async () => {
      const harness = createHarness();

      await harness.complete('code');

      expect(harness.order).toStrictEqual([
        'échange',
        'validation',
        'configuration',
        'redémarrage',
      ]);
    });

    it('ne redémarre rien si l’échange échoue', async () => {
      const harness = createHarness({
        exchange: () => Promise.reject(new Error('Twitch a répondu 400')),
      });

      await expect(harness.complete('code')).rejects.toThrow(/400/u);
      expect(harness.order).toStrictEqual(['échange']);
    });

    it('ne redémarre rien si la validation échoue', async () => {
      const harness = createHarness({
        validate: () => Promise.reject(new Error('jeton refusé')),
      });

      await expect(harness.complete('code')).rejects.toThrow(/refusé/u);
      expect(harness.order).toStrictEqual(['échange', 'validation']);
    });

    it('propage un échec de redémarrage', async () => {
      const harness = createHarness({ restart: () => Promise.reject(new Error('EventSub muet')) });

      await expect(harness.complete('code')).rejects.toThrow(/EventSub/u);
    });
  });
});
