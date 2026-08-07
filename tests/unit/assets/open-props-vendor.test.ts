import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const VENDORED = fileURLToPath(
  new URL('../../../src/web/shared/open-props.css', import.meta.url),
);

function splitHeader(source: string): { header: string; body: string } {
  const marker = source.indexOf('*/\n');
  if (!source.startsWith('/*') || marker < 0) {
    throw new Error('en-tête de vendorisation absent : le fichier doit commencer par un commentaire de bloc');
  }

  const end = marker + '*/\n'.length;
  return { header: source.slice(0, end), body: source.slice(end) };
}

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
    expect(field(header, 'vendor-version')).toMatch(/^\d+\.\d+\.\d+$/);
    expect(field(header, 'vendor-license')).toBe('MIT');
    expect(field(header, 'vendor-sha256')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('correspond au condensat déclaré', async () => {
    const source = await readFile(VENDORED, 'utf8');
    const { header, body } = splitHeader(source);

    const digest = createHash('sha256').update(body, 'utf8').digest('hex');

    expect(digest).toBe(field(header, 'vendor-sha256'));
  });

  it('ne référence aucune ressource externe', async () => {
    const { body } = splitHeader(await readFile(VENDORED, 'utf8'));

    expect(body).not.toMatch(/@import/);
    expect(body).not.toMatch(/url\(\s*['"]?https?:/);
  });

  it('ne contient que des déclarations de variables', async () => {
    const { body } = splitHeader(await readFile(VENDORED, 'utf8'));

    expect(body).not.toMatch(/^\s*\.[a-zA-Z]/m);
  });
});
