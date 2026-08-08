import { describe, expect, it } from 'vitest';

import { decideNavigation } from '../../src/main/navigation-policy.js';

const APP_ORIGIN = 'http://127.0.0.1:3777';

function withScheme(scheme: string, rest: string): string {
  return `${scheme}:${rest}`;
}

const decide = (url: string): string => decideNavigation(url, { appOrigin: APP_ORIGIN });

describe('decideNavigation', () => {
  describe('origine de l’application', () => {
    it('autorise la racine', () => {
      expect(decide('http://127.0.0.1:3777/')).toBe('allow');
    });

    it('autorise les trois pages', () => {
      expect(decide('http://127.0.0.1:3777/overlay')).toBe('allow');
      expect(decide('http://127.0.0.1:3777/admin')).toBe('allow');
      expect(decide('http://127.0.0.1:3777/setup')).toBe('allow');
    });

    it('autorise une page avec fragment et paramètres', () => {
      expect(decide('http://127.0.0.1:3777/admin#/rewards')).toBe('allow');
      expect(decide('http://127.0.0.1:3777/setup?oauth=ok')).toBe('allow');
    });

    it('refuse un autre port que celui de l’application', () => {
      expect(decide('http://127.0.0.1:3778/admin')).toBe('block');
    });

    it('refuse « localhost », qui n’est pas l’origine retenue', () => {
      expect(decide('http://localhost:3777/admin')).toBe('block');
    });

    it('refuse la même origine en https, qui n’est pas la nôtre', () => {
      expect(decide('https://127.0.0.1:3777/admin')).toBe('block');
    });
  });

  describe('Twitch, renvoyé au navigateur système', () => {
    it('renvoie la page d’autorisation', () => {
      expect(decide('https://id.twitch.tv/oauth2/authorize?client_id=abc')).toBe('external');
    });

    it('renvoie la console développeur', () => {
      expect(decide('https://dev.twitch.tv/console/apps')).toBe('external');
    });

    it('renvoie le site principal, avec ou sans www', () => {
      expect(decide('https://twitch.tv/')).toBe('external');
      expect(decide('https://www.twitch.tv/')).toBe('external');
    });

    it('refuse Twitch en clair', () => {
      expect(decide('http://id.twitch.tv/oauth2/authorize')).toBe('block');
    });

    it('refuse un port explicite sur Twitch', () => {
      expect(decide('https://id.twitch.tv:8443/oauth2/authorize')).toBe('block');
    });
  });

  describe('hôtes qui ressemblent à Twitch', () => {
    const usurpations = [
      ['https://id.twitch.tv.evil.test/', 'suffixe : le vrai domaine est evil.test'],
      ['https://twitch.tv.evil.test/', 'suffixe sur le domaine nu'],
      ['https://eviltwitch.tv/', 'préfixe collé'],
      ['https://id-twitch.tv/', 'tiret au lieu du point'],
      ['https://sub.id.twitch.tv/', 'sous-domaine non listé'],
      ['https://xn--twitch-6dg.tv/', 'homographe en punycode'],
      ['https://twitch.tv.', 'point final, hôte distinct pour la résolution'],
    ] as const;

    it.each(usurpations)('refuse %s (%s)', (url) => {
      expect(decide(url)).toBe('block');
    });

    it('refuse un hôte caché derrière un identifiant d’utilisateur', () => {
      expect(decide('https://id.twitch.tv@evil.test/')).toBe('block');
      expect(decide('https://127.0.0.1:3777@evil.test/')).toBe('block');
    });
  });

  describe('schémas et formes hostiles', () => {
    const hostiles = [
      ['file:///C:/Windows/System32/', 'accès au système de fichiers'],
      ['ms-msdt:/id', 'protocole système enregistré par un tiers'],
      ['ftp://exemple.test/', 'schéma sans rapport'],
      ['about:blank', 'page vide, origine nulle'],
      ['chrome://settings', 'interface interne du moteur'],
      ['devtools://devtools/bundled/inspector.html', 'outils de développement'],
      ['//id.twitch.tv/', 'URL relative au protocole, non analysable seule'],
      ['/admin', 'chemin relatif, sans origine'],
      ['', 'chaîne vide'],
      ['pas une url', 'chaîne quelconque'],
    ] as const;

    it.each(hostiles)('refuse %s (%s)', (url) => {
      expect(decide(url)).toBe('block');
    });

    it('refuse une URL de script', () => {
      expect(decide(withScheme('javascript', 'alert(1)'))).toBe('block');
      expect(decide(withScheme('data', 'text/html,<script>alert(1)</script>'))).toBe('block');
      expect(decide(withScheme('vbscript', 'msgbox(1)'))).toBe('block');
    });
  });

  describe('robustesse de la politique elle-même', () => {
    it('ne lève jamais, quelle que soit l’entrée', () => {
      const entrées = ['', 'pas une url', 'https://', '://', '\u0000', 'x'.repeat(10_000)];

      for (const entrée of entrées) {
        expect(() => decide(entrée)).not.toThrow();
      }
    });

    it('refuse tout lorsque l’origine de l’application est inexploitable', () => {
      expect(decideNavigation('http://127.0.0.1:3777/admin', { appOrigin: '' })).toBe('block');
    });
  });
});
