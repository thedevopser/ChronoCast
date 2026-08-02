/**
 * Intégrité de la primitive CSS vendorée.
 *
 * Open Props est recopié dans le dépôt plutôt qu'installé : c'est la même
 * discipline que le twitch-cli figé de la Phase 0. Un fichier vendoré n'a
 * d'intérêt que si l'on peut affirmer qu'il est bien celui qu'on croit — sans
 * quoi on a simplement une dépendance de plus, sans registre, sans somme de
 * contrôle et sans audit.
 *
 * Ce test rejoue la vérification à chaque exécution de la suite : il recalcule
 * le condensat du contenu et le compare à celui déclaré dans l'en-tête. Une
 * modification, même d'un octet, fait donc échouer la suite — c'est exactement
 * ce qu'on attend d'un fichier réputé non modifié.
 *
 * Il vit dans le projet `node` et non sous `tests/unit/web/` : il lit un
 * fichier sur le disque, il n'a aucun DOM à observer.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const VENDORED = fileURLToPath(
  new URL('../../../src/web/shared/open-props.css', import.meta.url),
);

/**
 * Sépare l'en-tête ajouté du contenu d'origine.
 *
 * L'en-tête est le premier commentaire de bloc, terminateur et saut de ligne
 * compris. Tout ce qui suit doit être identique, octet pour octet, à ce que
 * `npm pack` a livré.
 */
function splitHeader(source: string): { header: string; body: string } {
  const marker = source.indexOf('*/\n');
  if (!source.startsWith('/*') || marker < 0) {
    throw new Error('en-tête de vendorisation absent : le fichier doit commencer par un commentaire de bloc');
  }

  const end = marker + '*/\n'.length;
  return { header: source.slice(0, end), body: source.slice(end) };
}

/** Lit un champ `nom: valeur` de l'en-tête. */
function field(header: string, name: string): string {
  const match = new RegExp(`^\\s*\\*\\s*${name}:\\s*(.+?)\\s*$`, 'm').exec(header);
  if (match === null) {
    throw new Error(`champ « ${name} » absent de l'en-tête de vendorisation`);
  }
  return match[1] ?? '';
}

describe('open-props vendoré', () => {
  it('déclare une provenance complète', async () => {
    const { header } = splitHeader(await readFile(VENDORED, 'utf8'));

    expect(field(header, 'vendor-name')).toBe('open-props');
    // Version exacte : une plage laisserait le fichier changer sous nos pieds.
    expect(field(header, 'vendor-version')).toMatch(/^\d+\.\d+\.\d+$/);
    expect(field(header, 'vendor-license')).toBe('MIT');
    expect(field(header, 'vendor-sha256')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('correspond au condensat déclaré', async () => {
    const source = await readFile(VENDORED, 'utf8');
    const { header, body } = splitHeader(source);

    const digest = createHash('sha256').update(body, 'utf8').digest('hex');

    // Si ce test échoue, le fichier a été édité à la main ou remplacé par une
    // autre version : reprendre `npm pack` et mettre l'en-tête à jour, ne
    // jamais recopier le condensat calculé pour faire taire l'échec.
    expect(digest).toBe(field(header, 'vendor-sha256'));
  });

  it('ne référence aucune ressource externe', async () => {
    const { body } = splitHeader(await readFile(VENDORED, 'utf8'));

    // La CSP n'autorise que `'self'` : un `@import` ou une `url()` distante
    // serait bloquée en silence, et le défaut ne se verrait qu'à l'écran.
    expect(body).not.toMatch(/@import/);
    expect(body).not.toMatch(/url\(\s*['"]?https?:/);
  });

  it('ne contient que des déclarations de variables', async () => {
    const { body } = splitHeader(await readFile(VENDORED, 'utf8'));

    // Open Props est une bibliothèque de primitives : aucune classe, aucun
    // composant. Le vérifier interdit de glisser un jour un fichier qui
    // imposerait des règles à nos propres composants.
    expect(body).not.toMatch(/^\s*\.[a-zA-Z]/m);
  });
});
