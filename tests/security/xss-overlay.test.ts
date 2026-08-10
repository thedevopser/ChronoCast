import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { sanitizeText, setText } from '../../src/web/shared/safe-dom.js';

const OVERLAY_HTML = readFileSync(
  resolve(process.cwd(), 'src/web/overlay/index.html'),
  'utf8',
);

const HOSTILE_PAYLOADS: readonly string[] = [
  '<img src=x onerror=alert(1)>',
  '<script>alert(document.cookie)</' + 'script>',
  '<svg onload=alert(1)>',
  '<iframe src="javascript:alert(1)"></iframe>',
  '"><script>alert(1)</' + 'script>',
  "'><img src=x onerror=alert(1)>",
  '<body onload=alert(1)>',
  '<a href="javascript:alert(1)">clic</a>',
  '<style>*{display:none}</' + 'style>',
  '<link rel=stylesheet href="http://exemple.invalide/a.css">',
  '<object data="data:text/html,<script>alert(1)</' + 'script>"></object>',
  '&lt;img src=x onerror=alert(1)&gt;',
  '<<SCRIPT>alert(1);//<</SCRIPT>',
];

describe('pseudonyme hostile écrit dans l’overlay', () => {
  it.each(HOSTILE_PAYLOADS)('ne crée aucun élément à partir de %j', (payload) => {
    const target = document.createElement('div');

    setText(target, payload);

    expect(target.children).toHaveLength(0);
    expect(target.querySelectorAll('*')).toHaveLength(0);
  });

  it.each(HOSTILE_PAYLOADS)('n’ajoute qu’un nœud de texte pour %j', (payload) => {
    const target = document.createElement('div');

    setText(target, payload);

    expect(target.childNodes).toHaveLength(1);
    expect(target.childNodes[0]?.nodeType).toBe(3 /* Node.TEXT_NODE */);
  });

  it('ne laisse aucun script apparaître dans le document', () => {
    const target = document.createElement('div');
    document.body.append(target);

    for (const payload of HOSTILE_PAYLOADS) {
      setText(target, payload);
    }

    expect(document.querySelectorAll('script')).toHaveLength(0);
    expect(document.querySelectorAll('img')).toHaveLength(0);
    expect(document.querySelectorAll('iframe')).toHaveLength(0);

    target.remove();
  });

  it('borne la longueur affichée quelle que soit la charge utile', () => {
    const target = document.createElement('div');

    setText(target, '<img src=x onerror=alert(1)>'.repeat(1_000));

    expect(sanitizeText(target.textContent ?? '', 64)).toBe(target.textContent);
    expect((target.textContent ?? '').length).toBeLessThanOrEqual(65);
  });
});

describe('gabarit de l’overlay', () => {
  const parsed = new DOMParser().parseFromString(OVERLAY_HTML, 'text/html');

  it('ne porte pas le marqueur de jeton CSRF', () => {
    expect(OVERLAY_HTML).not.toContain('__CHRONOCAST_CSRF__');
    expect(parsed.querySelector('meta[name="chronocast-csrf"]')).toBeNull();
  });

  it('ne contient aucun script en ligne', () => {
    const inlineScripts = [...parsed.querySelectorAll('script')].filter(
      (element) => !element.hasAttribute('src'),
    );

    expect(inlineScripts).toHaveLength(0);
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

  it('ne référence aucune ressource distante', () => {
    const references = [...parsed.querySelectorAll('[src], [href]')].map(
      (element) => element.getAttribute('src') ?? element.getAttribute('href') ?? '',
    );

    expect(references.length).toBeGreaterThan(0);
    for (const reference of references) {
      expect(reference.startsWith('/')).toBe(true);
    }
  });
});
