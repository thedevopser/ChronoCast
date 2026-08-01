import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createLogger, type LogRecord, type LogSink } from '../../../src/core/logging/logger.js';
import { HelixError, createHelixClient } from '../../../src/core/twitch/helix-client.js';
import { ReauthenticationRequiredError } from '../../../src/core/twitch/oauth-service.js';

/**
 * Le client Helix crée et supprime les souscriptions EventSub, et résout
 * l'identité de la chaîne. C'est le seul composant qui parle à l'API REST de
 * Twitch.
 *
 * Sa robustesse détermine celle de toute la connexion : si la création des
 * souscriptions échoue au démarrage, le subathon ne reçoit aucun événement sans
 * que rien ne le signale visiblement. D'où une politique de reprise explicite,
 * différenciée selon la nature de l'échec.
 */

const CLIENT_ID = 'client-id-public';

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

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('createHelixClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let getAccessToken: ReturnType<typeof vi.fn>;
  let sleep: ReturnType<typeof vi.fn>;
  let sink: ReturnType<typeof createMemorySink>;

  beforeEach(() => {
    fetchMock = vi.fn();
    getAccessToken = vi.fn().mockResolvedValue('jeton-valide');
    // Attente simulée : la suite ne doit jamais patienter réellement.
    sleep = vi.fn().mockResolvedValue(undefined);
    sink = createMemorySink();
  });

  function createClient() {
    return createHelixClient({
      getSettings: () => ({ helixBaseUrl: 'https://api.twitch.tv/helix', clientId: CLIENT_ID }),
      getAccessToken: getAccessToken as unknown as () => Promise<string>,
      logger: createLogger({ level: 'debug', sinks: [sink] }),
      fetch: fetchMock as unknown as typeof fetch,
      sleep: sleep as unknown as (ms: number) => Promise<void>,
      maxAttempts: 3,
    });
  }

  describe('en-têtes d\'authentification', () => {
    it('transmet le jeton et l\'identifiant client', async () => {
      const client = createClient();
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: [{ id: '1', login: 'x', display_name: 'X' }] }));

      await client.getCurrentUser();

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = new Headers(init.headers);
      expect(headers.get('Authorization')).toBe('Bearer jeton-valide');
      expect(headers.get('Client-Id')).toBe(CLIENT_ID);
    });

    it('demande un jeton frais avant chaque appel', async () => {
      const client = createClient();
      fetchMock.mockImplementation(() => jsonResponse(200, { data: [] }));

      await client.listEventSubSubscriptions();
      await client.listEventSubSubscriptions();

      expect(getAccessToken).toHaveBeenCalledTimes(2);
    });
  });

  describe('résolution de la chaîne', () => {
    it('renvoie l\'utilisateur courant', async () => {
      const client = createClient();
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, { data: [{ id: '1337', login: 'cooler_user', display_name: 'Cooler_User' }] }),
      );

      await expect(client.getCurrentUser()).resolves.toEqual({
        id: '1337',
        login: 'cooler_user',
        displayName: 'Cooler_User',
      });
    });

    it('signale une réponse sans utilisateur', async () => {
      const client = createClient();
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: [] }));

      await expect(client.getCurrentUser()).rejects.toBeInstanceOf(HelixError);
    });
  });

  describe('souscriptions EventSub', () => {
    it('crée une souscription avec le transport WebSocket', async () => {
      const client = createClient();
      fetchMock.mockResolvedValueOnce(
        jsonResponse(202, { data: [{ id: 'sub-1', type: 'channel.subscribe', version: '1', status: 'enabled' }] }),
      );

      await client.createEventSubSubscription({
        type: 'channel.subscribe',
        version: '1',
        condition: { broadcaster_user_id: '1337' },
        sessionId: 'session-abc',
      });

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(init.body as string)).toMatchObject({
        type: 'channel.subscribe',
        transport: { method: 'websocket', session_id: 'session-abc' },
      });
    });

    it('renvoie la souscription créée', async () => {
      const client = createClient();
      fetchMock.mockResolvedValueOnce(
        jsonResponse(202, { data: [{ id: 'sub-1', type: 'channel.subscribe', version: '1', status: 'enabled' }] }),
      );

      await expect(
        client.createEventSubSubscription({
          type: 'channel.subscribe',
          version: '1',
          condition: { broadcaster_user_id: '1337' },
          sessionId: 'session-abc',
        }),
      ).resolves.toMatchObject({ id: 'sub-1', status: 'enabled' });
    });

    it('liste les souscriptions actives', async () => {
      const client = createClient();
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, {
          data: [
            { id: 'sub-1', type: 'channel.subscribe', version: '1', status: 'enabled' },
            { id: 'sub-2', type: 'channel.cheer', version: '1', status: 'enabled' },
          ],
        }),
      );

      await expect(client.listEventSubSubscriptions()).resolves.toHaveLength(2);
    });

    it('supprime une souscription', async () => {
      const client = createClient();
      // 204 interdit tout corps, fût-il vide : Twitch répond ainsi aux suppressions.
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

      await client.deleteEventSubSubscription('sub-1');

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(init.method).toBe('DELETE');
      expect(url).toContain('id=sub-1');
    });
  });

  describe('reprise sur jeton expiré', () => {
    it('renouvelle le jeton et rejoue l\'appel après un 401', async () => {
      const client = createClient();
      fetchMock
        .mockResolvedValueOnce(jsonResponse(401, { message: 'Invalid OAuth token' }))
        .mockResolvedValueOnce(jsonResponse(200, { data: [] }));

      await client.listEventSubSubscriptions();

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('ne rejoue qu\'une seule fois après un 401', async () => {
      // Un second refus signifie que le problème n'est pas l'expiration :
      // insister ne ferait que retarder le diagnostic.
      const client = createClient();
      fetchMock.mockImplementation(() => jsonResponse(401, { message: 'Invalid OAuth token' }));

      await expect(client.listEventSubSubscriptions()).rejects.toBeInstanceOf(HelixError);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('propage une demande de réauthentification sans la déguiser', async () => {
      const client = createClient();
      getAccessToken.mockRejectedValueOnce(new ReauthenticationRequiredError('jeton révoqué'));

      await expect(client.listEventSubSubscriptions()).rejects.toBeInstanceOf(
        ReauthenticationRequiredError,
      );
    });
  });

  describe('limitation de débit', () => {
    it('attend puis rejoue après un 429', async () => {
      const client = createClient();
      fetchMock
        .mockResolvedValueOnce(jsonResponse(429, { message: 'Too Many Requests' }))
        .mockResolvedValueOnce(jsonResponse(200, { data: [] }));

      await client.listEventSubSubscriptions();

      expect(sleep).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('respecte l\'échéance annoncée par Twitch', async () => {
      const client = createClient();
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse(429, { message: 'Too Many Requests' }, { 'ratelimit-reset': '5' }),
        )
        .mockResolvedValueOnce(jsonResponse(200, { data: [] }));

      await client.listEventSubSubscriptions();

      expect(sleep.mock.calls[0]?.[0]).toBeGreaterThanOrEqual(5_000);
    });

    it('abandonne après le nombre de tentatives configuré', async () => {
      const client = createClient();
      fetchMock.mockImplementation(() => jsonResponse(429, { message: 'Too Many Requests' }));

      await expect(client.listEventSubSubscriptions()).rejects.toBeInstanceOf(HelixError);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });

  describe('erreurs serveur et réseau', () => {
    it('rejoue après une erreur serveur', async () => {
      const client = createClient();
      fetchMock
        .mockResolvedValueOnce(jsonResponse(503, { message: 'Service Unavailable' }))
        .mockResolvedValueOnce(jsonResponse(200, { data: [] }));

      await client.listEventSubSubscriptions();

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('espace les tentatives de façon croissante', async () => {
      const client = createClient();
      fetchMock.mockImplementation(() => jsonResponse(503, { message: 'Service Unavailable' }));

      await expect(client.listEventSubSubscriptions()).rejects.toThrow();

      const attentes = sleep.mock.calls.map((call) => call[0] as number);
      expect(attentes[1]!).toBeGreaterThan(attentes[0]!);
    });

    it('rejoue après une panne réseau', async () => {
      const client = createClient();
      fetchMock
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockResolvedValueOnce(jsonResponse(200, { data: [] }));

      await client.listEventSubSubscriptions();

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('ne rejoue jamais une erreur de requête', async () => {
      // Un 400 vient d'une condition ou d'un type de souscription erroné :
      // le rejouer donnerait exactement le même refus.
      const client = createClient();
      fetchMock.mockImplementation(() => jsonResponse(400, { message: 'Invalid condition' }));

      await expect(client.listEventSubSubscriptions()).rejects.toBeInstanceOf(HelixError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('expose le code de statut dans l\'erreur levée', async () => {
      const client = createClient();
      fetchMock.mockImplementation(() => jsonResponse(403, { message: 'Forbidden' }));

      await expect(client.listEventSubSubscriptions()).rejects.toMatchObject({ status: 403 });
    });

    it('rapporte le message d\'erreur de Twitch', async () => {
      const client = createClient();
      fetchMock.mockImplementation(() => jsonResponse(403, { message: 'missing scope' }));

      await expect(client.listEventSubSubscriptions()).rejects.toThrow(/missing scope/);
    });

    it('signale une réponse illisible', async () => {
      const client = createClient();
      fetchMock.mockImplementation(() => new Response('<html>panne</html>', { status: 200 }));

      await expect(client.listEventSubSubscriptions()).rejects.toBeInstanceOf(HelixError);
    });
  });
});
