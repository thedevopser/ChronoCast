import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  AUTHOR,
  COPYRIGHT_YEAR,
  DONATION_URL,
  LICENSE_NAME,
  REPOSITORY_URL,
} from '../../../src/core/app/about.js';
import { decideNavigation } from '../../../src/main/navigation-policy.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const read = (relative: string): Promise<string> => readFile(resolve(ROOT, relative), 'utf8');

interface Manifest {
  readonly author: string;
  readonly license: string;
}

const manifest = async (): Promise<Manifest> => JSON.parse(await read('package.json')) as Manifest;

describe('cohérence avec le manifeste npm', () => {
  it('annonce le même auteur que `package.json`', async () => {
    expect(AUTHOR).toBe((await manifest()).author);
  });

  it('annonce la même licence que `package.json`', async () => {
    expect(LICENSE_NAME).toBe((await manifest()).license);
  });
});

describe('URL sortantes', () => {
  // Le port vide et le schéma https sont exigés par `decideNavigation` : une URL qui les
  // enfreindrait produirait un lien que la fenêtre Electron bloquerait en silence.
  it.each([
    ['le dépôt', REPOSITORY_URL],
    ['la page de soutien', DONATION_URL],
  ])('%s est une URL https sans port', (_label, value) => {
    const url = new URL(value);

    expect(url.protocol).toBe('https:');
    expect(url.port).toBe('');
  });

  it('ne confond pas le dépôt et la page de soutien', () => {
    expect(REPOSITORY_URL).not.toBe(DONATION_URL);
  });
});

const PAGES = ['src/web/admin/index.html', 'src/web/setup/index.html'] as const;

/** Les balises `<a>` de la page, telles quelles, pour en inspecter tous les attributs. */
function anchors(html: string): readonly string[] {
  return html.match(/<a\b[^>]*>/g) ?? [];
}

function attribute(tag: string, name: string): string | null {
  return new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
}

describe('mentions publiées dans les pages', () => {
  it('crédite l’auteur, l’année et la licence dans le panneau', async () => {
    const html = await read('src/web/admin/index.html');

    expect(html).toContain(AUTHOR);
    expect(html).toContain(COPYRIGHT_YEAR);
    expect(html).toContain(LICENSE_NAME);
  });

  it.each(PAGES)('publie le lien de soutien dans %s', async (page) => {
    expect(await read(page)).toContain(DONATION_URL);
  });

  it('renvoie au dépôt depuis le panneau', async () => {
    expect(await read('src/web/admin/index.html')).toContain(REPOSITORY_URL);
  });
});

describe('liens sortants des pages', () => {
  // Le vrai garde-fou : un lien vers un hôte absent de la liste blanche serait bloqué par
  // `decideNavigation` sans aucun message dans la fenêtre Electron. Le test lie donc ce que
  // les pages publient à ce que la politique de navigation accepte.
  it.each(PAGES)('n’expose dans %s que des liens que la navigation accepte', async (page) => {
    const externals = anchors(await read(page)).filter((tag) =>
      (attribute(tag, 'href') ?? '').startsWith('http'),
    );

    expect(externals.length).toBeGreaterThan(0);

    for (const tag of externals) {
      const href = attribute(tag, 'href') ?? '';

      expect(decideNavigation(href, { appOrigin: 'http://127.0.0.1:3777' })).toBe('external');
    }
  });

  it.each(PAGES)('ouvre les liens de %s hors de la page, sans fuite de contexte', async (page) => {
    const externals = anchors(await read(page)).filter((tag) =>
      (attribute(tag, 'href') ?? '').startsWith('http'),
    );

    for (const tag of externals) {
      const rel = (attribute(tag, 'rel') ?? '').split(/\s+/);

      expect(attribute(tag, 'target')).toBe('_blank');
      expect(rel).toContain('noopener');
      expect(rel).toContain('noreferrer');
    }
  });
});

describe('fichier LICENSE', () => {
  it('existe et porte la licence annoncée', async () => {
    const license = await read('LICENSE');

    expect(license).toContain('MIT License');
    expect(LICENSE_NAME).toBe('MIT');
  });

  it('porte le même détenteur et la même année que le module', async () => {
    const license = await read('LICENSE');

    expect(license).toContain(`Copyright (c) ${COPYRIGHT_YEAR} ${AUTHOR}`);
  });
});
