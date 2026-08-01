import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Clock } from '../../../src/core/app/ports.js';
import { createLogger, type LogRecord, type LogSink } from '../../../src/core/logging/logger.js';
import { createRedactor } from '../../../src/core/logging/redaction.js';
import {
  OAuthError,
  ReauthenticationRequiredError,
  buildAuthorizationUrl,
  createOAuthService,
} from '../../../src/core/twitch/oauth-service.js';
import { createTokenStore, type TwitchCredentials } from '../../../src/core/twitch/token-store.js';
import type { SecretStore } from '../../../src/core/app/ports.js';

/**
 * Le service OAuth doit tenir une promesse forte du cahier des charges :
 * « l'utilisateur ne doit plus jamais refaire la manipulation ».
 *
 * Cela se traduit par trois comportements vérifiés ici. Le renouvellement est
 * proactif, déclenché avant expiration plutôt qu'après un refus, afin qu'aucun
 * appel ne parte avec un jeton mort. Un rejet ponctuel du réseau est réessayé,
 * mais un jeton de rafraîchissement invalide ne l'est jamais : insister
 * n'aboutirait pas et masquerait la seule action utile, qui est de prévenir
 * l'utilisateur.
 *
 * Le flux retenu est le code d'autorisation, seul à délivrer un jeton de
 * rafraîchissement utilisateur — indispensable aux portées d'abonnements, de
 * bits et de chat.
 */

const NOW = 1_754_000_000_000;
const CLIENT_ID = 'client-id-public';
const CLIENT_SECRET = 'secret-client-tres-long-abc123';
const REDIRECT_URI = 'http://localhost:37771/auth/callback';

const SCOPES = ['channel:read:subscriptions', 'bits:read'];

function createFakeClock(): Clock & { advance(ms: number): void } {
  let epoch = NOW;
  return {
    now: () => epoch,
    monotonicMs: () => epoch - NOW,
    advance(ms: number): void {
      epoch += ms;
    },
  };
}

function createMemorySink(): LogSink & { readonly records: LogRecord[] } {
  const records: LogRecord[] = [];
  return {
    name: 'memory',
    records,
    write(record: LogRecord): void {
      records.push(record);
    },
  };
}

function createSecretStoreDouble(): SecretStore {
  const values = new Map<string, string>();
  return {
    isEncryptionAvailable: () => true,
    read: (key) => Promise.resolve(values.get(key) ?? null),
    write: (key, value) => {
      values.set(key, value);
      return Promise.resolve();
    },
    delete: (key) => {
      values.delete(key);
      return Promise.resolve();
    },
  };
}

/** Réponse HTTP simulée, au format attendu de `fetch`. */
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const TOKEN_RESPONSE = {
  access_token: 'jeton-acces-neuf-abcdef',
  refresh_token: 'jeton-refresh-neuf-zyxwvu',
  expires_in: 14_400,
  scope: SCOPES,
  token_type: 'bearer',
};

describe('buildAuthorizationUrl', () => {
  it('compose une URL d\'autorisation conforme', () => {
    const url = new URL(
      buildAuthorizationUrl({
        idBaseUrl: 'https://id.twitch.tv',
        clientId: CLIENT_ID,
        redirectUri: REDIRECT_URI,
        scopes: SCOPES,
        state: 'etat-aleatoire',
      }),
    );

    expect(url.origin + url.pathname).toBe('https://id.twitch.tv/oauth2/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(url.searchParams.get('state')).toBe('etat-aleatoire');
  });

  it('sépare les portées par des espaces, comme l\'exige Twitch', () => {
    const url = new URL(
      buildAuthorizationUrl({
        idBaseUrl: 'https://id.twitch.tv',
        clientId: CLIENT_ID,
        redirectUri: REDIRECT_URI,
        scopes: SCOPES,
        state: 'etat',
      }),
    );

    expect(url.searchParams.get('scope')).toBe(SCOPES.join(' '));
  });

  it('force le consentement afin d\'obtenir un jeton de rafraîchissement neuf', () => {
    // Sans force_verify, une réautorisation silencieuse peut renvoyer un jeton
    // de rafraîchissement déjà expiré côté Twitch.
    const url = new URL(
      buildAuthorizationUrl({
        idBaseUrl: 'https://id.twitch.tv',
        clientId: CLIENT_ID,
        redirectUri: REDIRECT_URI,
        scopes: SCOPES,
        state: 'etat',
        forceVerify: true,
      }),
    );

    expect(url.searchParams.get('force_verify')).toBe('true');
  });
});

describe('createOAuthService', () => {
  let clock: ReturnType<typeof createFakeClock>;
  let sink: ReturnType<typeof createMemorySink>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clock = createFakeClock();
    sink = createMemorySink();
    fetchMock = vi.fn();
  });

  function createService(initial?: TwitchCredentials) {
    const redactor = createRedactor();
    const logger = createLogger({ level: 'debug', sinks: [sink], redactor });
    const tokenStore = createTokenStore({
      secretStore: createSecretStoreDouble(),
      redactor,
      logger,
    });

    const service = createOAuthService({
      tokenStore,
      clock,
      logger,
      fetch: fetchMock as unknown as typeof fetch,
      getSettings: () => ({
        idBaseUrl: 'https://id.twitch.tv',
        clientId: CLIENT_ID,
        redirectUri: REDIRECT_URI,
        scopes: SCOPES,
      }),
    });

    return { service, tokenStore, initial };
  }

  describe('échange du code d\'autorisation', () => {
    it('convertit un code en identifiants complets', async () => {
      const { service } = createService();
      fetchMock.mockResolvedValueOnce(jsonResponse(200, TOKEN_RESPONSE));

      const credentials = await service.exchangeCode('code-recu', CLIENT_SECRET);

      expect(credentials).toMatchObject({
        accessToken: TOKEN_RESPONSE.access_token,
        refreshToken: TOKEN_RESPONSE.refresh_token,
        clientSecret: CLIENT_SECRET,
        scopes: SCOPES,
      });
    });

    it('calcule l\'expiration à partir de l\'instant courant', async () => {
      const { service } = createService();
      fetchMock.mockResolvedValueOnce(jsonResponse(200, TOKEN_RESPONSE));

      const credentials = await service.exchangeCode('code-recu', CLIENT_SECRET);

      expect(credentials.expiresAt).toBe(NOW + TOKEN_RESPONSE.expires_in * 1_000);
    });

    it('persiste les identifiants obtenus', async () => {
      const { service, tokenStore } = createService();
      fetchMock.mockResolvedValueOnce(jsonResponse(200, TOKEN_RESPONSE));

      await service.exchangeCode('code-recu', CLIENT_SECRET);

      await expect(tokenStore.load()).resolves.toMatchObject({
        accessToken: TOKEN_RESPONSE.access_token,
      });
    });

    it('signale un code refusé par Twitch', async () => {
      const { service } = createService();
      fetchMock.mockResolvedValueOnce(
        jsonResponse(400, { status: 400, message: 'Invalid authorization code' }),
      );

      await expect(service.exchangeCode('code-perime', CLIENT_SECRET)).rejects.toBeInstanceOf(
        OAuthError,
      );
    });

    it('transmet le secret client dans le corps et non dans l\'URL', async () => {
      // Un secret placé en chaîne de requête finirait dans les journaux du
      // serveur distant et dans l'historique des mandataires.
      const { service } = createService();
      fetchMock.mockResolvedValueOnce(jsonResponse(200, TOKEN_RESPONSE));

      await service.exchangeCode('code-recu', CLIENT_SECRET);

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).not.toContain(CLIENT_SECRET);
      expect(init.body as string).toContain(CLIENT_SECRET);
    });
  });

  describe('obtention d\'un jeton valide', () => {
    async function serviceWithCredentials(expiresInMs: number) {
      const { service, tokenStore } = createService();
      await tokenStore.save({
        clientSecret: CLIENT_SECRET,
        accessToken: 'jeton-courant-abcdef',
        refreshToken: 'jeton-refresh-courant',
        expiresAt: NOW + expiresInMs,
        scopes: SCOPES,
      });
      return { service, tokenStore };
    }

    it('renvoie le jeton courant lorsqu\'il est largement valide', async () => {
      const { service } = await serviceWithCredentials(3_600_000);

      await expect(service.getAccessToken()).resolves.toBe('jeton-courant-abcdef');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('renouvelle avant expiration plutôt qu\'après un refus', async () => {
      // Marge de sécurité : un appel ne doit jamais partir avec un jeton qui
      // expirera pendant son trajet.
      const { service } = await serviceWithCredentials(60_000);
      fetchMock.mockResolvedValueOnce(jsonResponse(200, TOKEN_RESPONSE));

      await expect(service.getAccessToken()).resolves.toBe(TOKEN_RESPONSE.access_token);
    });

    it('renouvelle un jeton déjà expiré', async () => {
      const { service } = await serviceWithCredentials(-1_000);
      fetchMock.mockResolvedValueOnce(jsonResponse(200, TOKEN_RESPONSE));

      await expect(service.getAccessToken()).resolves.toBe(TOKEN_RESPONSE.access_token);
    });

    it('persiste les identifiants renouvelés', async () => {
      const { service, tokenStore } = await serviceWithCredentials(-1_000);
      fetchMock.mockResolvedValueOnce(jsonResponse(200, TOKEN_RESPONSE));

      await service.getAccessToken();

      await expect(tokenStore.load()).resolves.toMatchObject({
        refreshToken: TOKEN_RESPONSE.refresh_token,
      });
    });

    it('conserve le secret client au fil des renouvellements', async () => {
      // Twitch ne le renvoie pas : le perdre rendrait tout renouvellement
      // ultérieur impossible.
      const { service, tokenStore } = await serviceWithCredentials(-1_000);
      fetchMock.mockResolvedValueOnce(jsonResponse(200, TOKEN_RESPONSE));

      await service.getAccessToken();

      await expect(tokenStore.load()).resolves.toMatchObject({ clientSecret: CLIENT_SECRET });
    });

    it('exige une authentification lorsque rien n\'est enregistré', async () => {
      const { service } = createService();

      await expect(service.getAccessToken()).rejects.toBeInstanceOf(ReauthenticationRequiredError);
    });

    it('exige une réauthentification si le jeton de rafraîchissement est invalide', async () => {
      const { service } = await serviceWithCredentials(-1_000);
      fetchMock.mockResolvedValueOnce(
        jsonResponse(400, { status: 400, message: 'Invalid refresh token' }),
      );

      await expect(service.getAccessToken()).rejects.toBeInstanceOf(ReauthenticationRequiredError);
    });

    it('n\'insiste jamais sur un jeton de rafraîchissement invalide', async () => {
      const { service } = await serviceWithCredentials(-1_000);
      fetchMock.mockResolvedValue(jsonResponse(400, { message: 'Invalid refresh token' }));

      await expect(service.getAccessToken()).rejects.toThrow();

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('efface les identifiants devenus inutilisables', async () => {
      const { service, tokenStore } = await serviceWithCredentials(-1_000);
      fetchMock.mockResolvedValueOnce(jsonResponse(400, { message: 'Invalid refresh token' }));

      await expect(service.getAccessToken()).rejects.toThrow();

      await expect(tokenStore.load()).resolves.toBeNull();
    });

    it('mutualise les renouvellements concurrents en un seul appel réseau', async () => {
      // Le client EventSub et le client Helix peuvent réclamer un jeton au même
      // instant : deux renouvellements simultanés invalideraient l'un l'autre.
      const { service } = await serviceWithCredentials(-1_000);
      fetchMock.mockResolvedValue(jsonResponse(200, TOKEN_RESPONSE));

      await Promise.all([service.getAccessToken(), service.getAccessToken(), service.getAccessToken()]);

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('validation', () => {
    it('renvoie l\'identité et les portées accordées', async () => {
      const { service } = createService();
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, {
          client_id: CLIENT_ID,
          login: 'cooler_user',
          scopes: SCOPES,
          user_id: '1337',
          expires_in: 5_000,
        }),
      );

      await expect(service.validate('jeton-a-verifier')).resolves.toMatchObject({
        login: 'cooler_user',
        userId: '1337',
        scopes: SCOPES,
      });
    });

    it('signale un jeton refusé', async () => {
      const { service } = createService();
      fetchMock.mockResolvedValueOnce(jsonResponse(401, { status: 401, message: 'invalid access token' }));

      await expect(service.validate('jeton-mort')).rejects.toBeInstanceOf(OAuthError);
    });

    it('transmet le jeton dans l\'en-tête et non dans l\'URL', async () => {
      const { service } = createService();
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, { client_id: CLIENT_ID, login: 'x', scopes: [], user_id: '1' }),
      );

      await service.validate('jeton-a-verifier');

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).not.toContain('jeton-a-verifier');
      expect(new Headers(init.headers).get('Authorization')).toBe('OAuth jeton-a-verifier');
    });
  });

  describe('portées manquantes', () => {
    it('détecte une portée requise non accordée', () => {
      const { service } = createService();

      const manquantes = service.findMissingScopes(['channel:read:subscriptions']);

      expect(manquantes).toEqual(SCOPES.filter((scope) => scope !== 'channel:read:subscriptions'));
    });

    it('ne signale rien lorsque toutes les portées sont accordées', () => {
      const { service } = createService();

      expect(service.findMissingScopes(SCOPES)).toEqual([]);
    });
  });

  describe('révocation', () => {
    it('révoque le jeton auprès de Twitch et efface les identifiants', async () => {
      const { service, tokenStore } = createService();
      fetchMock.mockResolvedValueOnce(jsonResponse(200, TOKEN_RESPONSE));
      await service.exchangeCode('code-recu', CLIENT_SECRET);
      fetchMock.mockResolvedValueOnce(new Response('', { status: 200 }));

      await service.revoke();

      await expect(tokenStore.load()).resolves.toBeNull();
    });

    it('efface les identifiants même si Twitch refuse la révocation', async () => {
      // Le jeton local est de toute façon inutilisable : le conserver
      // n'apporterait rien et bloquerait une nouvelle authentification.
      const { service, tokenStore } = createService();
      fetchMock.mockResolvedValueOnce(jsonResponse(200, TOKEN_RESPONSE));
      await service.exchangeCode('code-recu', CLIENT_SECRET);
      fetchMock.mockRejectedValueOnce(new Error('réseau injoignable'));

      await service.revoke();

      await expect(tokenStore.load()).resolves.toBeNull();
    });
  });

  describe('robustesse réseau', () => {
    it('signale une réponse qui n\'est pas du JSON', async () => {
      const { service } = createService();
      fetchMock.mockResolvedValueOnce(new Response('<html>erreur</html>', { status: 200 }));

      await expect(service.exchangeCode('code', CLIENT_SECRET)).rejects.toBeInstanceOf(OAuthError);
    });

    it('signale une réponse à laquelle il manque le jeton', async () => {
      const { service } = createService();
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { expires_in: 100 }));

      await expect(service.exchangeCode('code', CLIENT_SECRET)).rejects.toBeInstanceOf(OAuthError);
    });

    it('enveloppe une panne réseau dans une erreur typée', async () => {
      const { service } = createService();
      fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      await expect(service.exchangeCode('code', CLIENT_SECRET)).rejects.toBeInstanceOf(OAuthError);
    });
  });
});
