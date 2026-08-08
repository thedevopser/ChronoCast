import { describe, expect, it } from 'vitest';

import { buildTrayMenu, formatTrayDuration } from '../../../src/main/tray-menu.js';

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
    const items = buildTrayMenu(base);
    const quitIndex = items.findIndex((item) => item.kind === 'command' && item.id === 'quit');

    expect(items[quitIndex - 1]?.kind).toBe('separator');
  });

  describe('copie de l’URL de l’overlay', () => {
    it('est active lorsque le serveur écoute', () => {
      const copy = buildTrayMenu(base).find(
        (item) => item.kind === 'command' && item.id === 'copy-overlay-url',
      );

      expect(copy).toMatchObject({ enabled: true });
    });

    it('est inactive tant qu’aucune URL n’existe', () => {
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

describe('formatTrayDuration', () => {
  it('met en forme heures, minutes et secondes', () => {
    expect(formatTrayDuration(3_723_000)).toBe('01:02:03');
  });

  it('tronque au lieu d’arrondir au supérieur', () => {
    expect(formatTrayDuration(1_999)).toBe('00:00:01');
  });

  it('affiche zéro plutôt qu’une valeur négative', () => {
    expect(formatTrayDuration(-5_000)).toBe('00:00:00');
  });

  it('dépasse vingt-quatre heures sans repartir de zéro', () => {
    expect(formatTrayDuration(90_000_000)).toBe('25:00:00');
  });

  it('supporte une valeur non finie sans lever', () => {
    expect(formatTrayDuration(Number.NaN)).toBe('00:00:00');
  });
});
