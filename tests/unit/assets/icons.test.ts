import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ASSETS = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'assets');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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
    const { width, height } = readPngHeader(await readFile(resolve(ASSETS, 'tray.png')));

    expect(width).toBe(32);
    expect(height).toBe(32);
  });

  it('conserve un canal alpha', async () => {
    const { colorType } = readPngHeader(await readFile(resolve(ASSETS, 'tray.png')));

    expect(colorType).toBe(6);
  });
});

describe('assets/icon.ico', () => {
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
    await expect(readFile(resolve(ASSETS, 'logo.png'))).resolves.toBeDefined();
    await expect(readFile(resolve(ASSETS, 'tray-icon.png'))).resolves.toBeDefined();
  });
});

describe('assets/appx', () => {
  const LOGOS = [
    { name: 'Square44x44Logo.png', width: 44, height: 44 },
    { name: 'Square150x150Logo.png', width: 150, height: 150 },
    { name: 'StoreLogo.png', width: 50, height: 50 },
    { name: 'Wide310x150Logo.png', width: 310, height: 150 },
    { name: 'SmallTile.png', width: 71, height: 71 },
    { name: 'LargeTile.png', width: 300, height: 300 },
    { name: 'SplashScreen.png', width: 620, height: 300 },
  ] as const;

  it.each(LOGOS)('$name est un PNG aux dimensions exigées', async ({ name, width, height }) => {
    const file = await readFile(resolve(ASSETS, 'appx', name));

    expect(file.subarray(0, 8)).toEqual(PNG_SIGNATURE);

    const header = readPngHeader(file);
    expect(header.width).toBe(width);
    expect(header.height).toBe(height);
  });

  it.each(LOGOS)('$name conserve un canal alpha', async ({ name }) => {
    const { colorType } = readPngHeader(await readFile(resolve(ASSETS, 'appx', name)));

    expect(colorType).toBe(6);
  });

  it('compose les formats larges sans les étirer', async () => {
    const file = await readFile(resolve(ASSETS, 'appx', 'Wide310x150Logo.png'));
    const { width, height } = readPngHeader(file);

    expect(width / height).toBeCloseTo(310 / 150, 5);
  });
});
