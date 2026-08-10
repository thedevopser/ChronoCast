/**
 * ChronoCast ne prend en charge aucune plateforme de dons monétaires : il ne
 * crédite que ce que Twitch lui rapporte. Deux dérives sont possibles, et ce
 * fichier les ferme toutes les deux.
 *
 * La première est un mot. Le panneau désigne les gift subs par le libellé
 * « Dons », qui fait croire à un don d'argent. Un diffuseur qui lit « Dons »
 * dans le barème peut légitimement penser qu'un virement Streamlabs ajoutera
 * du temps — et découvrir le contraire en plein subathon.
 *
 * La seconde est le silence. Si aucun document ne dit que ces plateformes sont
 * hors périmètre, l'absence se lit comme un oubli à combler plutôt que comme
 * une décision.
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const ANNONCE_ABSENCE_DE_DONS = 'Les dons hors Twitch';

function read(path: string): Promise<string> {
  return readFile(resolve(ROOT, path), 'utf8');
}

describe('les dons monétaires sont hors périmètre', () => {
  const SOURCES_DU_PANNEAU = [
    'src/web/admin/index.html',
    'src/web/admin/dashboard-model.ts',
    'src/web/admin/fields.ts',
  ];

  it('n’emploie jamais « Dons » comme libellé du panneau', async () => {
    const sources = await Promise.all(
      SOURCES_DU_PANNEAU.map(async (path) => ({ path, content: await read(path) })),
    );

    const fautifs = sources
      .filter((source) => /\bDons\b/u.test(source.content))
      .map((source) => source.path);

    expect(fautifs).toEqual([]);
  });

  it('annonce l’absence de plateforme de dons dans la documentation publique', async () => {
    const documents = await Promise.all(
      ['README.md', 'docs/USER-GUIDE.md'].map(async (path) => ({
        path,
        content: await read(path),
      })),
    );

    const muets = documents
      .filter((document) => !document.content.includes(ANNONCE_ABSENCE_DE_DONS))
      .map((document) => document.path);

    expect(muets).toEqual([]);
  });
});
