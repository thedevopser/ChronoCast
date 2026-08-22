import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const goalHtml = (): Promise<string> => readFile(resolve(ROOT, 'src/web/goal/index.html'), 'utf8');
const goalCss = (): Promise<string> => readFile(resolve(ROOT, 'src/web/goal/goal.css'), 'utf8');

describe('page /goal', () => {
  describe('document', () => {
    it('porte la balise du port WebSocket, sans quoi la page ne se connecterait à rien', async () => {
      expect(await goalHtml()).toContain('__CHRONOCAST_WS_PORT__');
    });

    // La page est servie sans jeton, comme /overlay : y placer l'emplacement du jeton laisserait
    // croire qu'elle peut muter quelque chose.
    it('ne réclame aucun jeton CSRF', async () => {
      expect(await goalHtml()).not.toContain('chronocast-csrf');
    });

    it('charge la feuille personnelle, sous le même interrupteur que l’overlay', async () => {
      expect(await goalHtml()).toContain('href="/custom.css"');
    });

    it('charge son module par un chemin absolu, faute de bundler', async () => {
      const html = await goalHtml();

      expect(html).toContain('src="/goal/main.js"');
      expect(html).toContain('type="module"');
    });

    // La CSP interdit la balise <style> et l'attribut style= : l'apparence passe par le CSSOM.
    it('ne pose ni balise de style ni attribut de style', async () => {
      const html = await goalHtml();

      expect(html).not.toContain('<style');
      expect(html).not.toMatch(/\sstyle=/);
    });
  });

  describe('feuille de style', () => {
    it('laisse le fond transparent : une Browser Source se superpose à la scène', async () => {
      expect(await goalCss()).toMatch(/background:\s*transparent/);
    });

    it('tire la largeur de la barre de la variable de progression', async () => {
      expect(await goalCss()).toContain('calc(var(--cc-goal-progress) * 100%)');
    });

    it('ne préfixe que --cc-goal-, pour ne jamais heurter les variables de l’overlay', async () => {
      const declared = [...(await goalCss()).matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map(
        (match) => match[1] ?? '',
      );

      expect(declared.length).toBeGreaterThan(0);
      for (const name of declared) {
        expect(name.startsWith('--cc-goal-')).toBe(true);
      }
    });

    it('coupe l’animation quand le système la refuse', async () => {
      expect(await goalCss()).toContain('prefers-reduced-motion');
    });
  });
});
