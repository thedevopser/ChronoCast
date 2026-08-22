import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const adminHtml = (): Promise<string> => readFile(resolve(ROOT, 'src/web/admin/index.html'), 'utf8');
const adminCss = (): Promise<string> => readFile(resolve(ROOT, 'src/web/admin/admin.css'), 'utf8');

/** Les blocs de premier niveau de chaque vue, dans l'ordre, hors en-tête. */
function stackedBlocks(html: string): Map<string, string[]> {
  const views = new Map<string, string[]>();

  for (const opening of html.matchAll(/<section class="view" id="view-([a-z-]+)"/g)) {
    const start = opening.index;
    const end = html.indexOf('</section>', start);
    const body = html.slice(start, end);

    const blocks = [...body.matchAll(/\n {10}<\w+ class="([^"]*)"/g)]
      .map((match) => (match[1] ?? '').split(' ')[0] ?? '')
      .filter((className) => className !== 'view__head');

    views.set(opening[1] ?? '', blocks);
  }

  return views;
}

function rulesOf(css: string): { selector: string; declarations: string }[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: (match[1] ?? '').trim(),
    declarations: match[2] ?? '',
  }));
}

describe('mise en page du panneau', () => {
  it('découvre bien les blocs empilés de chaque vue', async () => {
    const views = stackedBlocks(await adminHtml());

    expect(views.get('goals')).toContain('card');
    expect(views.get('appearance')).toContain('workbench');
  });

  /**
   * Le défaut réel : `.fields` et `.actions` portent leurs propres marges, `.board` porte un `gap`,
   * mais une `.card` posée directement dans une vue n'a que du padding. Trois vues en empilent
   * plusieurs, et sans cette règle elles se touchent bord à bord.
   */
  it('espace les cartes qu’une vue empile hors grille', async () => {
    const stacked = [...stackedBlocks(await adminHtml())].filter(([, blocks]) =>
      blocks.some((block, index) => block === 'card' && blocks[index + 1] !== undefined),
    );

    expect(stacked.length).toBeGreaterThan(0);

    const spacing = rulesOf(await adminCss()).filter(
      (rule) => /\.card\s*\+|\+\s*\.card/.test(rule.selector) && /margin-top\s*:/.test(rule.declarations),
    );

    expect(
      `vues empilant des cartes : ${stacked.map(([name]) => name).join(', ')} — règles d’espacement : ${String(spacing.length)}`,
    ).toBe(
      `vues empilant des cartes : ${stacked.map(([name]) => name).join(', ')} — règles d’espacement : ${String(spacing.length || 'aucune')}`,
    );

    expect(spacing.length).toBeGreaterThan(0);
  });

  it('n’espace jamais par une marge nulle', async () => {
    const spacing = rulesOf(await adminCss()).filter((rule) =>
      /\.card\s*\+|\+\s*\.card/.test(rule.selector),
    );

    for (const rule of spacing) {
      expect(rule.declarations, rule.selector).not.toMatch(/margin-top\s*:\s*0\s*(;|$)/);
    }
  });
});
