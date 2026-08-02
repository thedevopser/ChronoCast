import { describe, expect, it } from 'vitest';

import { decideNavigation } from '../../src/main/navigation-policy.js';

/**
 * Politique de navigation de la fenêtre Electron.
 *
 * C'est la pièce de sécurité de la coquille, et c'est pourquoi elle est pure :
 * `windows.ts` ne fait que lui poser la question et appliquer la réponse. Une
 * décision enfouie dans un gestionnaire d'événement Electron ne serait
 * vérifiable que sur un poste Windows, c'est-à-dire jamais pendant l'écriture.
 *
 * Trois réponses, et une seule est permissive :
 *
 *   - `allow` : la page est servie par notre propre serveur local. C'est le
 *     seul cas où du contenu s'affiche dans la fenêtre.
 *   - `external` : Twitch, renvoyé au navigateur du système. La fenêtre ne rend
 *     jamais une page Twitch — le flux OAuth passe par le navigateur et le
 *     rappel loopback depuis la PR B, elle n'a donc aucune raison légitime de
 *     le faire.
 *   - `block` : tout le reste, sans exception ni tolérance.
 *
 * La comparaison d'hôte est exacte, comme la garde d'`Host` de la Phase 4. Le
 * suffixe est refusé par principe : `id.twitch.tv.evil.com` se termine par
 * `twitch.tv` sans rien avoir de commun avec Twitch.
 */

const APP_ORIGIN = 'http://127.0.0.1:3777';

/**
 * Compose une URL à partir de son schéma et du reste.
 *
 * `no-script-url` interdit le littéral `javascript:`, y compris dans les tests,
 * et la désactiver localement reviendrait à s'autoriser ce qu'on interdit
 * ailleurs. Même discipline que pour les caractères de contrôle, décrits par
 * leur code plutôt qu'écrits tels quels.
 */
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
      // Le panneau route par hash, et l'assistant reçoit `?oauth=ok` au retour
      // du rappel : les deux formes doivent passer.
      expect(decide('http://127.0.0.1:3777/admin#/rewards')).toBe('allow');
      expect(decide('http://127.0.0.1:3777/setup?oauth=ok')).toBe('allow');
    });

    it('refuse un autre port que celui de l’application', () => {
      // Un port voisin n'est pas notre serveur : c'est n'importe quoi d'autre
      // qui écoute sur la machine.
      expect(decide('http://127.0.0.1:3778/admin')).toBe('block');
    });

    it('refuse « localhost », qui n’est pas l’origine retenue', () => {
      // `localhost` et `127.0.0.1` sont deux origines distinctes pour le
      // navigateur comme pour nous. La garde d'`Host` du serveur fait déjà
      // cette distinction, et les deux doivent rester d'accord.
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
      // Une redirection vers `http://` est le premier signe d'une interception.
      expect(decide('http://id.twitch.tv/oauth2/authorize')).toBe('block');
    });

    it('refuse un port explicite sur Twitch', () => {
      // Twitch écoute sur 443. Un port explicite désigne autre chose, quel que
      // soit le nom qui le précède.
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
      // `https://id.twitch.tv@evil.test/` va sur evil.test : tout ce qui précède
      // l'arobase est un identifiant, pas un nom d'hôte. C'est l'usurpation la
      // plus efficace parce qu'elle se lit correctement.
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
      // Elle est appelée depuis un gestionnaire d'événement Electron : une
      // levée y laisserait la navigation suivre son cours par défaut, soit
      // exactement ce que la politique doit empêcher.
      const entrées = ['', 'pas une url', 'https://', '://', '\u0000', 'x'.repeat(10_000)];

      for (const entrée of entrées) {
        expect(() => decide(entrée)).not.toThrow();
      }
    });

    it('refuse tout lorsque l’origine de l’application est inexploitable', () => {
      // Cas de programmation : la fenêtre construite avant que le serveur ait
      // annoncé son port. Mieux vaut une fenêtre qui n'affiche rien qu'une
      // fenêtre qui affiche n'importe quoi.
      expect(decideNavigation('http://127.0.0.1:3777/admin', { appOrigin: '' })).toBe('block');
    });
  });
});
