import { describe, expect, it } from 'vitest';

import { buildTrayMenu, formatTrayDuration } from '../../../src/main/tray-menu.js';

/**
 * Modèle du menu de la zone de notification.
 *
 * Le tray est le seul chemin par lequel on quitte l'application : fermer la
 * fenêtre replie, il ne termine rien. Ce que ce menu propose, et surtout ce
 * qu'il propose *quand*, mérite donc d'être décidé ici plutôt que dans
 * `tray.ts`, où seule une exécution sur Windows le vérifierait.
 *
 * Le module est pur : il transforme un état en descriptions d'entrées.
 * `tray.ts` se contente de les passer à `Menu.buildFromTemplate` et de brancher
 * les gestionnaires sur les identifiants.
 */
describe('buildTrayMenu', () => {
  const base = {
    status: 'running' as const,
    remainingMs: 3_723_000,
    overlayUrl: 'http://127.0.0.1:3777/overlay',
  };

  it('annonce le temps restant en tête, en lecture seule', () => {
    const [first] = buildTrayMenu(base);

    expect(first).toEqual({ kind: 'status', label: '01:02:03 restantes' });
  });

  it('propose d’ouvrir la fenêtre, de copier l’URL et de quitter', () => {
    const commands = buildTrayMenu(base)
      .filter((item) => item.kind === 'command')
      .map((item) => item.id);

    expect(commands).toEqual(['show', 'copy-overlay-url', 'quit']);
  });

  it('sépare la sortie du reste', () => {
    // Quitter arrête le subathon. Le coller sous « copier l'URL » en ferait le
    // voisin immédiat d'un geste anodin, et donc un clic malheureux.
    const items = buildTrayMenu(base);
    const quitIndex = items.findIndex((item) => item.kind === 'command' && item.id === 'quit');

    expect(items[quitIndex - 1]?.kind).toBe('separator');
  });

  describe('mise à jour disponible', () => {
    it('n’apparaît pas tant qu’aucune version n’est prête', () => {
      // Une entrée permanente et grisée ferait croire à une fonction en panne.
      // Elle n'existe que lorsqu'il y a quelque chose à installer.
      const commands = buildTrayMenu(base)
        .filter((item) => item.kind === 'command')
        .map((item) => item.id);

      expect(commands).not.toContain('install-update');
    });

    it('apparaît, en nommant la version, quand une mise à jour est prête', () => {
      const item = buildTrayMenu({ ...base, updateVersion: '0.5.1' }).find(
        (entry) => entry.kind === 'command' && entry.id === 'install-update',
      );

      expect(item).toMatchObject({ enabled: true });
      expect(item && 'label' in item ? item.label : '').toContain('0.5.1');
    });

    it('se place avant le séparateur qui isole la sortie', () => {
      // Installer ferme l'application, comme quitter. Les deux doivent rester
      // distincts : « installer » est une action qu'on veut, « quitter » une
      // action qu'on regrette si on la clique par erreur.
      const items = buildTrayMenu({ ...base, updateVersion: '0.5.1' });
      const updateIndex = items.findIndex(
        (item) => item.kind === 'command' && item.id === 'install-update',
      );
      const quitIndex = items.findIndex((item) => item.kind === 'command' && item.id === 'quit');

      expect(updateIndex).toBeGreaterThan(-1);
      expect(updateIndex).toBeLessThan(quitIndex);
      expect(items[quitIndex - 1]?.kind).toBe('separator');
    });
  });

  describe('copie de l’URL de l’overlay', () => {
    it('est active lorsque le serveur écoute', () => {
      const copy = buildTrayMenu(base).find(
        (item) => item.kind === 'command' && item.id === 'copy-overlay-url',
      );

      expect(copy).toMatchObject({ enabled: true });
    });

    it('est inactive tant qu’aucune URL n’existe', () => {
      // Avant que le serveur ait annoncé son port, il n'y a rien à copier.
      // Proposer l'entrée quand même remplirait le presse-papiers de vide, ce
      // qui est plus déroutant qu'une entrée grisée.
      const copy = buildTrayMenu({ ...base, overlayUrl: null }).find(
        (item) => item.kind === 'command' && item.id === 'copy-overlay-url',
      );

      expect(copy).toMatchObject({ enabled: false });
    });
  });

  describe('libellé d’état selon le compteur', () => {
    it('décrit un compteur jamais démarré', () => {
      const [first] = buildTrayMenu({ ...base, status: 'idle' });

      expect(first).toEqual({ kind: 'status', label: 'En attente — 01:02:03' });
    });

    it('décrit une pause', () => {
      const [first] = buildTrayMenu({ ...base, status: 'paused' });

      expect(first).toEqual({ kind: 'status', label: 'En pause — 01:02:03' });
    });

    it('décrit un subathon achevé', () => {
      const [first] = buildTrayMenu({ ...base, status: 'finished', remainingMs: 0 });

      expect(first).toEqual({ kind: 'status', label: 'Terminé' });
    });
  });

  it('propose toujours de quitter, quel que soit l’état', () => {
    for (const status of ['idle', 'running', 'paused', 'finished'] as const) {
      const quit = buildTrayMenu({ ...base, status }).find(
        (item) => item.kind === 'command' && item.id === 'quit',
      );

      expect(quit).toMatchObject({ enabled: true });
    }
  });
});

/**
 * Mise en forme de la durée.
 *
 * Volontairement redite de `web/shared/time-format.ts` plutôt que partagée avec
 * lui : ce module-là est compilé pour le navigateur, avec sa propre racine et
 * ses propres règles d'import. L'y raccorder ferait entrer du code serveur dans
 * le paquet servi au client, ce que la Phase 5 a explicitement exclu. La règle
 * qui compte — **tronquer, jamais arrondir au supérieur** — est en revanche la
 * même, et pour la même raison.
 */
describe('formatTrayDuration', () => {
  it('met en forme heures, minutes et secondes', () => {
    expect(formatTrayDuration(3_723_000)).toBe('01:02:03');
  });

  it('tronque au lieu d’arrondir au supérieur', () => {
    // Afficher une seconde de plus que ce qui reste ferait mentir le compteur
    // dans le sens qui déçoit : celui où le temps annoncé n'existe pas.
    expect(formatTrayDuration(1_999)).toBe('00:00:01');
  });

  it('affiche zéro plutôt qu’une valeur négative', () => {
    expect(formatTrayDuration(-5_000)).toBe('00:00:00');
  });

  it('dépasse vingt-quatre heures sans repartir de zéro', () => {
    // Un subathon de plusieurs jours est le cas nominal, pas l'exception : les
    // heures s'accumulent au lieu de retomber à `01:00:00` le lendemain.
    expect(formatTrayDuration(90_000_000)).toBe('25:00:00');
  });

  it('supporte une valeur non finie sans lever', () => {
    expect(formatTrayDuration(Number.NaN)).toBe('00:00:00');
  });
});
