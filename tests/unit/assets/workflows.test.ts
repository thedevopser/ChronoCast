import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const WORKFLOWS = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.github', 'workflows');

async function workflows(): Promise<{ name: string; content: string }[]> {
  const names = (await readdir(WORKFLOWS)).filter((name) => name.endsWith('.yml'));
  return Promise.all(
    names.map(async (name) => ({ name, content: await readFile(resolve(WORKFLOWS, name), 'utf8') })),
  );
}

describe('workflows GitHub', () => {
  it('épinglent chaque action sur un commit, qu’un tag déplacé ne peut pas remplacer', async () => {
    const unpinned = (await workflows()).flatMap(({ name, content }) =>
      [...content.matchAll(/uses:\s*(\S+)/g)]
        .map((match) => match[1] ?? '')
        .filter((action) => !/@[0-9a-f]{40}$/.test(action))
        .map((action) => `${name} → ${action}`),
    );

    expect(unpinned).toEqual([]);
  });

  it('auditent les dépendances avant de produire le paquet publié', async () => {
    const release = await readFile(resolve(WORKFLOWS, 'release.yml'), 'utf8');

    expect(release).toContain('npm audit --audit-level=high');
  });
});
