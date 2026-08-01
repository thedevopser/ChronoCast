import { describe, expect, it } from 'vitest';

import { createRedactor, REDACTED } from '../../../src/core/logging/redaction.js';

/**
 * La rédaction est un contrôle de sécurité, pas une commodité : un jeton OAuth
 * écrit dans `logs/chronocast-*.jsonl` reste sur le disque en clair et se
 * retrouve dans le premier rapport de bug transmis par un utilisateur.
 *
 * Ces tests décrivent donc ce que le système garantit avant tout écriture de log.
 */
describe('createRedactor', () => {
  describe('clés sensibles', () => {
    it('masque la valeur associée à une clé sensible', () => {
      const redactor = createRedactor();

      expect(redactor.redact({ client_secret: 'valeur-confidentielle' })).toEqual({
        client_secret: REDACTED,
      });
    });

    it('reconnaît les variantes de nommage camelCase et snake_case', () => {
      const redactor = createRedactor();

      expect(
        redactor.redact({
          accessToken: 'a',
          access_token: 'b',
          refreshToken: 'c',
          clientSecret: 'd',
          authorization: 'e',
          password: 'f',
        }),
      ).toEqual({
        accessToken: REDACTED,
        access_token: REDACTED,
        refreshToken: REDACTED,
        clientSecret: REDACTED,
        authorization: REDACTED,
        password: REDACTED,
      });
    });

    it('laisse intactes les clés de diagnostic qui ressemblent à des secrets', () => {
      const redactor = createRedactor();

      // `code` porte le code d'erreur système (ENOENT, ECONNRESET) et `status` le
      // code HTTP : les masquer rendrait les logs inexploitables.
      expect(redactor.redact({ code: 'ENOENT', status: 404, statusCode: 500 })).toEqual({
        code: 'ENOENT',
        status: 404,
        statusCode: 500,
      });
    });

    it('descend dans les objets imbriqués et les tableaux', () => {
      const redactor = createRedactor();

      expect(
        redactor.redact({
          twitch: { credentials: [{ access_token: 'secret' }] },
        }),
      ).toEqual({
        twitch: { credentials: [{ access_token: REDACTED }] },
      });
    });
  });

  describe('valeurs de secrets enregistrées', () => {
    it("masque un secret enregistré où qu'il apparaisse dans une chaîne", () => {
      const redactor = createRedactor();
      redactor.registerSecret('oauth-token-abc123');

      expect(redactor.redact('échec de la requête avec oauth-token-abc123 en en-tête')).toBe(
        `échec de la requête avec ${REDACTED} en en-tête`,
      );
    });

    it('masque un secret enregistré présent sous une clé anodine', () => {
      const redactor = createRedactor();
      redactor.registerSecret('oauth-token-abc123');

      expect(redactor.redact({ url: 'https://api.twitch.tv/?x=oauth-token-abc123' })).toEqual({
        url: `https://api.twitch.tv/?x=${REDACTED}`,
      });
    });

    it('cesse de masquer un secret oublié après révocation', () => {
      const redactor = createRedactor();
      redactor.registerSecret('ancien-jeton');
      redactor.forgetSecret('ancien-jeton');

      expect(redactor.redact('ancien-jeton')).toBe('ancien-jeton');
    });

    it("ignore l'enregistrement d'une chaîne trop courte pour être un secret", () => {
      const redactor = createRedactor();
      // Enregistrer une valeur courte masquerait des fragments de texte au hasard
      // et rendrait les logs illisibles.
      redactor.registerSecret('ab');

      expect(redactor.redact('table abstraite')).toBe('table abstraite');
    });
  });

  describe('chaînes contenant des identifiants', () => {
    it('masque un paramètre sensible dans une URL', () => {
      const redactor = createRedactor();

      expect(
        redactor.redact('https://id.twitch.tv/oauth2/token?client_secret=xyz789&client_id=public'),
      ).toBe(`https://id.twitch.tv/oauth2/token?client_secret=${REDACTED}&client_id=public`);
    });

    it('masque un jeton porteur dans un en-tête sérialisé', () => {
      const redactor = createRedactor();

      expect(redactor.redact('Authorization: Bearer abcdef123456')).toBe(
        `Authorization: Bearer ${REDACTED}`,
      );
    });
  });

  describe('robustesse', () => {
    it("préserve le nom et le message d'une erreur tout en masquant son contenu", () => {
      const redactor = createRedactor();
      redactor.registerSecret('jeton-secret-xyz');

      const redacted = redactor.redact(new TypeError('appel refusé avec jeton-secret-xyz'));

      expect(redacted).toMatchObject({
        name: 'TypeError',
        message: `appel refusé avec ${REDACTED}`,
      });
    });

    it('traite une référence circulaire sans boucler indéfiniment', () => {
      const redactor = createRedactor();
      const cyclic: Record<string, unknown> = { access_token: 'secret' };
      cyclic['self'] = cyclic;

      expect(redactor.redact(cyclic)).toEqual({
        access_token: REDACTED,
        self: '[circular]',
      });
    });

    it('restitue les primitives sans altération', () => {
      const redactor = createRedactor();

      expect(redactor.redact(42)).toBe(42);
      expect(redactor.redact(true)).toBe(true);
      expect(redactor.redact(null)).toBeNull();
      expect(redactor.redact(undefined)).toBeUndefined();
    });

    it("ne modifie jamais l'objet fourni en entrée", () => {
      const redactor = createRedactor();
      const original = { access_token: 'secret' };

      redactor.redact(original);

      expect(original.access_token).toBe('secret');
    });
  });
});
