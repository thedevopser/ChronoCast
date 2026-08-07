import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { OAUTH_REDIRECT_URI } from '../../src/core/app/application.js';

const SETUP_HTML = readFileSync(resolve(process.cwd(), 'src/web/setup/index.html'), 'utf8');
const parsed = new DOMParser().parseFromString(SETUP_HTML, 'text/html');

describe('jeton CSRF', () => {
  it('porte le marqueur que le serveur substitue', () => {
    const meta = parsed.querySelector('meta[name="chronocast-csrf"]');

    expect(meta).not.toBeNull();
    expect(meta?.getAttribute('content')).toBe('__CHRONOCAST_CSRF__');
  });
});

describe('redirect URI', () => {
  it('affiche exactement celle que le noyau déclare à Twitch', () => {
    const shown = parsed.querySelector('#redirect-uri')?.textContent?.trim();

    expect(shown).toBe(OAUTH_REDIRECT_URI);
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

  it('neutralise les liens sortants', () => {
    const external = [...parsed.querySelectorAll('a[href]')].filter((element) =>
      (element.getAttribute('href') ?? '').startsWith('http'),
    );

    expect(external.length).toBeGreaterThan(0);
    for (const link of external) {
      expect(link.getAttribute('rel')).toContain('noreferrer');
      expect(link.getAttribute('href')?.startsWith('https://')).toBe(true);
    }
  });
});
