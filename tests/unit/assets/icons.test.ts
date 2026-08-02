import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Icônes livrées avec l'application.
 *
 * Elles sont **engendrées** depuis deux visuels sources par
 * `scripts/prepare-icons.mjs`, et non déposées à la main. Ce test vérifie le
 * produit, parce que les défauts qu'il attrape ne se voient jamais au moment
 * où on les commet :
 *
 *   - une icône de tray **non carrée** est déformée par Windows, et l'aperçu
 *     dans l'éditeur ne le montre pas ;
 *   - un `.ico` auquel il manque une taille fait afficher à l'explorateur une
 *     mise à l'échelle floue d'une autre, sans le moindre message ;
 *   - un `.ico` mal formé n'est refusé qu'au moment du packaging, c'est-à-dire
 *     à la toute fin.
 *
 * C'est la même logique que le condensat d'Open Props : un binaire versionné
 * doit être vérifiable, faute de quoi personne ne saura jamais qu'il a changé.
 */

const ASSETS = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'assets');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Dimensions et type de couleur lus dans le chunk IHDR, toujours en tête. */
function readPngHeader(file: Buffer): {
  readonly width: number;
  readonly height: number;
  readonly colorType: number;
} {
  return {
    width: file.readUInt32BE(16),
    height: file.readUInt32BE(20),
    colorType: file[25]!,
  };
}

describe('assets/tray.png', () => {
  it('est un PNG', async () => {
    const file = await readFile(resolve(ASSETS, 'tray.png'));

    expect(file.subarray(0, 8)).toEqual(PNG_SIGNATURE);
  });

  it('est carré, en 32 × 32', async () => {
    // Le visuel source ne l'est pas : c'est le préparateur qui le met au carré
    // en le centrant sur un canevas transparent. Sans quoi Windows étire
    // l'icône dans la barre des tâches.
    const { width, height } = readPngHeader(await readFile(resolve(ASSETS, 'tray.png')));

    expect(width).toBe(32);
    expect(height).toBe(32);
  });

  it('conserve un canal alpha', async () => {
    // Type 6 : RGBA. Un tray sans transparence apparaît comme un rectangle
    // plein sur la barre des tâches, quelle que soit la couleur de celle-ci.
    const { colorType } = readPngHeader(await readFile(resolve(ASSETS, 'tray.png')));

    expect(colorType).toBe(6);
  });
});

describe('assets/icon.ico', () => {
  /** En-tête ICONDIR : réservé, type, nombre d'images. */
  async function readIco(): Promise<{
    readonly file: Buffer;
    readonly count: number;
    readonly entries: readonly { size: number; offset: number; bytes: number }[];
  }> {
    const file = await readFile(resolve(ASSETS, 'icon.ico'));
    const count = file.readUInt16LE(4);

    const entries = Array.from({ length: count }, (_, index) => {
      const start = 6 + index * 16;
      return {
        // 0 encode 256 : le champ ne tient que sur un octet.
        size: file[start] === 0 ? 256 : file[start]!,
        bytes: file.readUInt32LE(start + 8),
        offset: file.readUInt32LE(start + 12),
      };
    });

    return { file, count, entries };
  }

  it('porte un en-tête ICONDIR valide', async () => {
    const file = await readFile(resolve(ASSETS, 'icon.ico'));

    expect(file.readUInt16LE(0)).toBe(0); // réservé
    expect(file.readUInt16LE(2)).toBe(1); // type : icône, et non curseur
  });

  it('couvre les tailles attendues par Windows', async () => {
    // 16 pour la barre des tâches, 32 pour le bureau, 48 et 256 pour
    // l'explorateur en grandes icônes. En omettre une fait afficher une mise à
    // l'échelle floue d'une autre.
    const { entries } = await readIco();

    expect(entries.map((entry) => entry.size)).toEqual([16, 24, 32, 48, 64, 128, 256]);
  });

  it('n’enferme que des images carrées', async () => {
    const { file, count } = await readIco();

    for (let index = 0; index < count; index += 1) {
      const start = 6 + index * 16;
      expect(file[start]).toBe(file[start + 1]);
    }
  });

  it('pointe sur des données présentes et complètes', async () => {
    // Un décalage qui déborde du fichier est le défaut classique d'un `.ico`
    // écrit à la main : il ne se voit qu'au chargement, sur le poste cible.
    const { file, entries } = await readIco();

    for (const entry of entries) {
      expect(entry.offset).toBeGreaterThan(0);
      expect(entry.offset + entry.bytes).toBeLessThanOrEqual(file.byteLength);
    }
  });

  it('enferme des PNG, tels que Windows Vista et suivants les acceptent', async () => {
    const { file, entries } = await readIco();

    for (const entry of entries) {
      expect(file.subarray(entry.offset, entry.offset + 8)).toEqual(PNG_SIGNATURE);
    }
  });
});

describe('visuels sources', () => {
  it('sont versionnés à côté des icônes engendrées', async () => {
    // Ils sont la source de vérité : sans eux, régénérer les icônes après un
    // changement de taille demandé par electron-builder serait impossible.
    await expect(readFile(resolve(ASSETS, 'logo.png'))).resolves.toBeDefined();
    await expect(readFile(resolve(ASSETS, 'tray-icon.png'))).resolves.toBeDefined();
  });
});
