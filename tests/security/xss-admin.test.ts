import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ADMIN_VIEWS } from '../../src/web/admin/router.js';

const ADMIN_HTML = readFileSync(resolve(process.cwd(), 'src/web/admin/index.html'), 'utf8');
const parsed = new DOMParser().parseFromString(ADMIN_HTML, 'text/html');

describe('marqueurs substitués par le serveur', () => {
  it('porte le marqueur du jeton CSRF', () => {
    const meta = parsed.querySelector('meta[name="chronocast-csrf"]');

    expect(meta).not.toBeNull();
    expect(meta?.getAttribute('content')).toBe('__CHRONOCAST_CSRF__');
  });

  it('porte le marqueur du port WebSocket', () => {
    const meta = parsed.querySelector('meta[name="chronocast-ws-port"]');

    expect(meta).not.toBeNull();
    expect(meta?.getAttribute('content')).toBe('__CHRONOCAST_WS_PORT__');
  });
});

describe('navigation', () => {
  it('déclare une section par vue connue du routeur', () => {
    for (const view of ADMIN_VIEWS) {
      expect(parsed.querySelector(`#view-${view}`)).not.toBeNull();
    }
  });

  it('ne déclare aucune section hors de la liste close', () => {
    const declared = [...parsed.querySelectorAll('[id^="view-"]')].map((element) =>
      element.id.replace(/^view-/, ''),
    );

    expect(declared.sort()).toEqual([...ADMIN_VIEWS].sort());
  });

  it('ne code en dur aucun lien vers une vue', () => {
    const targets = [...parsed.querySelectorAll('a[href^="#"]')].map((element) =>
      (element.getAttribute('href') ?? '').replace(/^#/, ''),
    );

    for (const target of targets) {
      expect(ADMIN_VIEWS).toContain(target);
    }
  });

  it('réserve au câblage le point d’ancrage de la navigation', () => {
    expect(parsed.querySelector('#nav')?.children).toHaveLength(0);
  });
});

describe('conformité à la CSP', () => {
  it('ne contient aucun script en ligne', () => {
    const inline = [...parsed.querySelectorAll('script')].filter(
      (element) => !element.hasAttribute('src'),
    );

    expect(inline).toHaveLength(0);
  });

  it('ne contient aucun style en ligne', () => {
    expect(parsed.querySelectorAll('style')).toHaveLength(0);
    expect(parsed.querySelectorAll('[style]')).toHaveLength(0);
  });

  it('ne contient aucun gestionnaire d’événement en attribut', () => {
    const withHandlers = [...parsed.querySelectorAll('*')].filter((element) =>
      [...element.attributes].some((attribute) => attribute.name.startsWith('on')),
    );

    expect(withHandlers).toHaveLength(0);
  });

  it('ne contient aucun formulaire soumissible', () => {
    expect(parsed.querySelectorAll('form')).toHaveLength(0);
  });

  it('ne déclare que des boutons inertes', () => {
    const untyped = [...parsed.querySelectorAll('button')].filter(
      (element) => element.getAttribute('type') !== 'button',
    );

    expect(untyped).toHaveLength(0);
  });
});

describe('ressources', () => {
  it('ne charge aucun script ni aucune feuille distante', () => {
    const sources = [...parsed.querySelectorAll('script[src], link[href]')].map(
      (element) => element.getAttribute('src') ?? element.getAttribute('href') ?? '',
    );

    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(source.startsWith('/')).toBe(true);
    }
  });

  it('charge les primitives avant les tokens, et les tokens avant la page', () => {
    const sheets = [...parsed.querySelectorAll('link[rel="stylesheet"]')].map(
      (element) => element.getAttribute('href') ?? '',
    );

    expect(sheets.indexOf('/shared/open-props.css')).toBeLessThan(
      sheets.indexOf('/shared/theme.css'),
    );
    expect(sheets.indexOf('/shared/theme.css')).toBeLessThan(sheets.indexOf('/admin/admin.css'));
  });

  it('charge son module par chemin absolu', () => {
    const script = parsed.querySelector('script[type="module"]');

    expect(script?.getAttribute('src')).toBe('/admin/main.js');
  });

  it('neutralise les liens sortants', () => {
    const external = [...parsed.querySelectorAll('a[href]')].filter((element) =>
      (element.getAttribute('href') ?? '').startsWith('http'),
    );

    for (const link of external) {
      expect(link.getAttribute('rel')).toContain('noreferrer');
      expect(link.getAttribute('href')?.startsWith('https://')).toBe(true);
    }
  });
});

describe('renvoi vers les paramètres de Windows', () => {
  it('offre un bouton inerte, câblé par `main.ts`', () => {
    const button = parsed.querySelector('#open-startup-settings');

    expect(button).not.toBeNull();
    expect(button?.getAttribute('type')).toBe('button');
  });

  it('ne code en dur aucune adresse `ms-settings:`', () => {
    expect(ADMIN_HTML).not.toContain('ms-settings:');
  });
});
