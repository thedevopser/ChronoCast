import { describe, expect, it } from 'vitest';

import { checkHost, isLoopbackHost } from '../../src/core/server/security/host-guard.js';
import { makeRequest } from '../helpers/http-request.js';

/**
 * ChronoCast écoute sur la boucle locale, ce qui semble suffire à le protéger.
 * Ce n'est pas le cas.
 *
 * Un site web visité par le streamer peut faire pointer son propre nom de domaine
 * vers `127.0.0.1` — c'est le rebinding DNS. Le navigateur émet alors des requêtes
 * vers l'application locale en croyant rester sur le site d'origine, et l'attaquant
 * pilote le compteur, lit la configuration, révoque les jetons.
 *
 * La seule défense côté serveur est l'en-tête `Host` : le navigateur y écrit le nom
 * réellement demandé, et un attaquant ne peut pas le falsifier depuis une page web.
 * Rejeter tout ce qui n'est pas littéralement la boucle locale ferme l'attaque.
 *
 * D'où la sévérité de ces tests : ce sont les formes trompeuses qui comptent, pas
 * les cas nominaux.
 */

describe('isLoopbackHost', () => {
  describe('accepte les formes légitimes', () => {
    const accepted = [
      '127.0.0.1',
      '127.0.0.1:3777',
      'localhost',
      'localhost:3777',
      '[::1]',
      '[::1]:3777',
      // L'en-tête Host est insensible à la casse pour le nom d'hôte.
      'LOCALHOST',
      'LocalHost:3777',
    ];

    it.each(accepted)('accepte %s', (host) => {
      expect(isLoopbackHost(host)).toBe(true);
    });
  });

  describe('rejette les formes trompeuses', () => {
    const rejected = [
      // Le cœur de l'attaque : un domaine contrôlé par un tiers, résolu vers 127.0.0.1.
      'evil.com',
      'evil.com:3777',
      // Suffixes : la vérification ne doit jamais être un « commence par ».
      '127.0.0.1.evil.com',
      'localhost.evil.com',
      '127.0.0.1.evil.com:3777',
      // Préfixes : ni un « contient ».
      'evil.com/127.0.0.1',
      'notlocalhost',
      'xlocalhost',
      // Syntaxe d'authentification : tout ce qui précède @ est ignoré par le navigateur.
      '127.0.0.1@evil.com',
      'localhost@evil.com',
      // Autres adresses de la plage 127/8 : le serveur ne lie que 127.0.0.1.
      '127.0.0.2',
      '127.1.1.1',
      // Adresses réseau : jamais, même si le serveur y était lié par erreur.
      '0.0.0.0',
      '192.168.1.10',
      '[::]',
      // En-tête dupliqué, replié par le client HTTP en une valeur séparée par des virgules.
      '127.0.0.1,evil.com',
      'localhost, evil.com',
      // Ports invalides.
      '127.0.0.1:0',
      '127.0.0.1:99999',
      '127.0.0.1:abc',
      '127.0.0.1:',
      // Bruit et chaînes vides.
      '',
      '   ',
      'localhost ',
      ' localhost',
      'local\thost',
      // IPv6 sans crochets : la forme non canonique ne doit pas ouvrir de brèche.
      '::1',
      '::1:3777',
    ];

    it.each(rejected)('rejette %j', (host) => {
      expect(isLoopbackHost(host)).toBe(false);
    });
  });

  it("rejette un en-tête Host absent", () => {
    expect(isLoopbackHost(undefined)).toBe(false);
  });
});

describe('checkHost', () => {
  it('laisse passer une requête de la boucle locale', () => {
    expect(checkHost(makeRequest())).toBeNull();
  });

  it('répond 403 sur un Host étranger', () => {
    const response = checkHost(makeRequest({ headers: { host: 'evil.com' } }));

    expect(response).not.toBeNull();
    expect(response?.status).toBe(403);
  });

  it("ne révèle pas la valeur reçue dans le corps de la réponse", () => {
    // Renvoyer l'en-tête fautif tel quel le réfléchirait vers un contexte que
    // l'attaquant contrôle : la réponse reste volontairement muette.
    const response = checkHost(makeRequest({ headers: { host: '<script>alert(1)</script>' } }));

    expect(response?.status).toBe(403);
    expect(String(response?.body)).not.toContain('script');
  });

  it('répond 403 lorsque le Host est absent', () => {
    const request = makeRequest();
    const headers: Record<string, string> = { ...request.headers };
    delete headers['host'];

    expect(checkHost({ ...request, headers })?.status).toBe(403);
  });
});
