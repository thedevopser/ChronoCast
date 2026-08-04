import { describe, expect, it } from 'vitest';

import type { UpdateStatus } from '../../../../src/web/shared/protocol.js';
import { updateBannerModel } from '../../../../src/web/admin/update-banner.js';

/**
 * Ce que le panneau dit d'une mise à jour, et ce qu'il propose d'en faire.
 *
 * Modèle pur : il ne connaît pas le DOM, seulement l'état du service et celui
 * du compteur. C'est cette séparation qui permet d'éprouver la règle qui compte
 * — **on avertit avant d'installer pendant un direct** — sans monter une page.
 *
 * Le bandeau est volontairement muet la plupart du temps. Une barre permanente
 * annonçant « à jour » n'apprend rien et occupe la place de ce qui compte.
 */

const base: UpdateStatus = {
  phase: 'idle',
  currentVersion: '0.5.0',
  availableVersion: null,
  notesUrl: null,
  message: null,
  checkedAt: null,
};

const ready: UpdateStatus = {
  ...base,
  phase: 'ready',
  availableVersion: '0.5.1',
  notesUrl: 'https://github.com/thedevopser/ChronoCast/releases/tag/v0.5.1',
};

/** Le compteur tourne ou non — la seule autre entrée du modèle. */
const running = { counterRunning: true };
const stopped = { counterRunning: false };

describe('updateBannerModel', () => {
  describe('silence', () => {
    it.each([
      ['à jour', 'idle'],
      ['vérification en cours', 'checking'],
      ['réglage désactivé', 'disabled'],
      ['point d’entrée sans installeur', 'unsupported'],
    ] as const)('n’affiche rien quand %s', (_libelle, phase) => {
      expect(updateBannerModel({ ...base, phase }, stopped)).toBeNull();
    });

    it('n’affiche rien pendant le téléchargement', () => {
      // Le téléchargement est silencieux par construction : annoncer une
      // version qu'on n'a pas encore vérifiée reviendrait à promettre ce qu'on
      // pourrait devoir retirer.
      expect(updateBannerModel({ ...base, phase: 'downloading', availableVersion: '0.5.1' }, stopped)).toBeNull();
    });
  });

  describe('version prête', () => {
    it('annonce la version et propose de l’installer', () => {
      const model = updateBannerModel(ready, stopped);

      expect(model).toMatchObject({
        tone: 'update',
        action: 'install',
        version: '0.5.1',
        notesUrl: ready.notesUrl,
        requiresConfirmation: false,
      });
      expect(model?.text).toContain('0.5.1');
    });

    it('demande une confirmation quand le compteur tourne', () => {
      // La règle qui protège le direct. Installer ferme l'application : le
      // faire d'un clic distrait pendant un subathon coûterait le stream.
      const model = updateBannerModel(ready, running);

      expect(model?.requiresConfirmation).toBe(true);
      expect(model?.confirmText).toContain('compteur');
    });

    it('dit ce qui va se passer, pas seulement qu’il va se passer quelque chose', () => {
      const model = updateBannerModel(ready, running);

      // « ChronoCast va se fermer » est l'information que l'utilisateur n'a
      // aucun moyen de deviner, et la seule qui puisse le faire hésiter.
      expect(model?.confirmText).toContain('fermer');
    });
  });

  describe('échec', () => {
    it('affiche le message du service', () => {
      const model = updateBannerModel(
        { ...base, phase: 'error', message: 'Mise à jour non appliquée : empreinte discordante.' },
        stopped,
      );

      expect(model).toMatchObject({ tone: 'error', action: 'retry' });
      expect(model?.text).toContain('empreinte discordante');
    });

    it('reste lisible quand le service n’a rien à dire', () => {
      // `message` peut être `null` : afficher « null » serait pire que se
      // taire, et se taire tout court cacherait un échec réel.
      const model = updateBannerModel({ ...base, phase: 'error', message: null }, stopped);

      expect(model?.tone).toBe('error');
      expect(model?.text).not.toContain('null');
      expect(model?.text.length).toBeGreaterThan(0);
    });

    it('n’offre jamais d’installer après un échec', () => {
      // L'invariant : rien ne s'installe qui n'ait été vérifié. Un bouton
      // « installer » sur un état d'erreur contredirait tout le module.
      const model = updateBannerModel(
        { ...base, phase: 'error', availableVersion: '0.5.1', message: 'échec' },
        stopped,
      );

      expect(model?.action).not.toBe('install');
    });
  });
});
