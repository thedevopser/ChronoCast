import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function relativeLinks(markdown: string): string[] {
  const links: string[] = [];

  for (const match of markdown.matchAll(/]\(([^)\s]+)\)/g)) {
    const target = match[1] ?? '';
    if (target.startsWith('http') || target.startsWith('#') || target.startsWith('mailto:')) {
      continue;
    }
    links.push(target.split('#')[0] ?? '');
  }

  return links.filter((link) => link !== '');
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function deliveredDocuments(): Promise<{ path: string; content: string }[]> {
  const names = await readdir(resolve(ROOT, 'docs'));
  const paths = ['README.md', ...names.filter((name) => name.endsWith('.md')).map((n) => `docs/${n}`)];

  return Promise.all(
    paths.map(async (path) => ({ path, content: await readFile(resolve(ROOT, path), 'utf8') })),
  );
}

describe('documentation livrée', () => {
  it('ne laisse aucun lien relatif mort', async () => {
    const documents = await deliveredDocuments();
    const broken: string[] = [];

    for (const document of documents) {
      const base = dirname(resolve(ROOT, document.path));

      for (const link of relativeLinks(document.content)) {
        if (!(await exists(resolve(base, link)))) {
          broken.push(`${document.path} → ${link}`);
        }
      }
    }

    expect(broken).toEqual([]);
  });

  it('livre les neuf documents annoncés par le README', async () => {
    const expected = [
      'ARCHITECTURE.md',
      'BUILD.md',
      'CRASH-RECOVERY.md',
      'DEVELOPER.md',
      'OVERLAY-CUSTOMIZATION.md',
      'RELEASE.md',
      'SECURITY.md',
      'TESTING-TWITCH-CLI.md',
      'USER-GUIDE.md',
    ];

    const present = (await readdir(resolve(ROOT, 'docs'))).sort();

    expect(present).toEqual(expect.arrayContaining(expected));
  });

  it('ne cite aucune commande que `dc.sh` ne connaît plus', async () => {
    const script = await readFile(resolve(ROOT, 'scripts/dc.sh'), 'utf8');
    const documents = await deliveredDocuments();

    const known = new Set(
      [...script.matchAll(/^\s*([a-z:|\s-]+)\)\s*$/gm)].flatMap((match) =>
        (match[1] ?? '').split('|').map((label) => label.trim()),
      ),
    );

    const unknown: string[] = [];
    for (const document of documents) {
      for (const match of document.content.matchAll(/dc\.sh ([a-z:]+)/g)) {
        const command = match[1] ?? '';
        if (!known.has(command)) {
          unknown.push(`${document.path} → ${command}`);
        }
      }
    }

    expect(unknown).toEqual([]);
  });
});
