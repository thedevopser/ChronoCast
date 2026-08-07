import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const WEB_DIR = fileURLToPath(new URL('../../../src/web', import.meta.url));

const VENDORED = 'shared/open-props.css';

async function collectStylesheets(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const collected: string[] = [];

  for (const entry of entries) {
    const entryPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      collected.push(...(await collectStylesheets(entryPath)));
      continue;
    }

    if (entry.isFile() && extname(entry.name).toLowerCase() === '.css') {
      collected.push(entryPath);
    }
  }

  return collected;
}

async function authoredStylesheets(): Promise<{ name: string; source: string }[]> {
  const paths = await collectStylesheets(WEB_DIR);
  const authored = paths
    .map((path) => relative(WEB_DIR, path).split('\\').join('/'))
    .filter((name) => name !== VENDORED)
    .sort();

  return Promise.all(
    authored.map(async (name) => ({
      name,
      source: await readFile(join(WEB_DIR, name), 'utf8'),
    })),
  );
}

function stripCommentsAndStrings(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''");
}

function braceDepths(css: string): { line: number; text: string; depth: number }[] {
  let depth = 0;

  return css.split('\n').map((text, index) => {
    const before = depth;
    depth += (text.match(/\{/g) ?? []).length - (text.match(/\}/g) ?? []).length;
    return { line: index + 1, text, depth: before };
  });
}

function matchingBrace(css: string, open: number): number {
  let depth = 0;

  for (let index = open; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    if (css[index] === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

function topLevelRules(css: string): { selector: string; declarations: string }[] {
  const rules: { selector: string; declarations: string }[] = [];
  let index = 0;

  while (index < css.length) {
    const open = css.indexOf('{', index);
    if (open < 0) break;

    const close = matchingBrace(css, open);
    if (close < 0) break;

    rules.push({
      selector: css.slice(index, open).trim(),
      declarations: css.slice(open + 1, close),
    });
    index = close + 1;
  }

  return rules;
}

describe('feuilles de style de src/web', () => {
  it('en découvre au moins une, hors vendor', async () => {
    const sheets = await authoredStylesheets();

    expect(sheets.map((sheet) => sheet.name)).toContain('shared/theme.css');
    expect(sheets.map((sheet) => sheet.name)).not.toContain(VENDORED);
  });

  it('équilibre ses accolades', async () => {
    for (const { name, source } of await authoredStylesheets()) {
      const lines = braceDepths(stripCommentsAndStrings(source));
      const negative = lines.filter((line) => line.depth < 0);
      const last = lines.at(-1);

      expect(`${name} : ${negative.map((line) => `l.${String(line.line)}`).join(', ')}`).toBe(
        `${name} : `,
      );
      expect(`${name} : profondeur finale ${String((last?.depth ?? 0) + 0)}`).toBe(
        `${name} : profondeur finale 0`,
      );
    }
  });

  it('ne laisse aucune déclaration hors d’un bloc', async () => {
    for (const { name, source } of await authoredStylesheets()) {
      const orphans = braceDepths(stripCommentsAndStrings(source))
        .filter((line) => line.depth === 0 && /^\s*[a-z-]+\s*:[^;{}]*;\s*$/i.test(line.text))
        .map((line) => `l.${String(line.line)} « ${line.text.trim()} »`);

      expect(`${name} : ${orphans.join(', ')}`).toBe(`${name} : `);
    }
  });
});

describe('feuille de tokens partagée', () => {
  const themeCss = (): Promise<string> =>
    readFile(join(WEB_DIR, 'shared/theme.css'), 'utf8');

  it('attache le reset de boîte à un sélecteur universel', async () => {
    const rules = topLevelRules(stripCommentsAndStrings(await themeCss()));
    const reset = rules.find((rule) => /box-sizing\s*:\s*border-box/.test(rule.declarations));

    expect(reset?.selector).toBe('*,\n*::before,\n*::after');
  });

  it('porte une règle body qui pose la couleur et le fond', async () => {
    const rules = topLevelRules(stripCommentsAndStrings(await themeCss()));
    const body = rules.find((rule) => rule.selector === 'body');

    expect(body?.declarations).toMatch(/(^|;)\s*color\s*:/);
    expect(body?.declarations).toMatch(/(^|;)\s*background\s*:/);
  });
});
