import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Cohérence de la documentation livrée.
 *
 * Le `README.md` référençait ses neuf documents **avant** qu'ils existent : les
 * liens étaient morts, et rien ne le signalait. C'est le défaut typique de la
 * documentation — elle ne s'exécute pas, donc elle pourrit sans bruit, et on ne
 * s'en aperçoit qu'en la lisant, c'est-à-dire au pire moment : celui où
 * quelqu'un en avait besoin.
 *
 * Ce fichier ne juge pas le contenu, qui n'est pas vérifiable mécaniquement. Il
 * tient les deux choses qui le sont :
 *
 *   - **tout lien relatif mène quelque part**, dans le README comme entre les
 *     documents eux-mêmes ;
 *   - **aucun document ne cite une commande que `dc.sh` ne connaît plus**, ce
 *     qui est arrivé pour de vrai au retrait de `build:win`.
 *
 * Les liens externes ne sont pas suivis : une suite de tests qui dépend du
 * réseau échoue pour des raisons qui ne la regardent pas.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Liens relatifs d'un document Markdown, hors ancres et URL absolues. */
function relativeLinks(markdown: string): string[] {
  const links: string[] = [];

  for (const match of markdown.matchAll(/]\(([^)\s]+)\)/g)) {
    const target = match[1] ?? '';
    if (target.startsWith('http') || target.startsWith('#') || target.startsWith('mailto:')) {
      continue;
    }
    // L'ancre n'est pas vérifiée : seul le fichier pointé nous intéresse.
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

/** Tous les Markdown du dépôt qui sont livrés : le README et `docs/`. */
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
    // Le README est la porte d'entrée : un document manquant s'y voit avant de
    // se voir ailleurs.
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
    // `build:win` a disparu avec le service Wine. Une documentation qui le
    // mentionne encore envoie le lecteur sur une commande qui échoue, et c'est
    // ce genre de détail qui fait douter de tout le reste.
    const script = await readFile(resolve(ROOT, 'scripts/dc.sh'), 'utf8');
    const documents = await deliveredDocuments();

    // Étiquettes de l'aiguillage `case`, alternatives comprises : la ligne
    // `help | --help | -h)` en déclare trois. Les lire là où elles sont écrites
    // évite d'entretenir une seconde liste qui divergerait.
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
