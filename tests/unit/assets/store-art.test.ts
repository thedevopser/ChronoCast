import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { decodePng, luminance, PNG_SIGNATURE, type DecodedPng } from '../../helpers/png.js';

import { posterGeometry } from '../../../scripts/lib/poster.mjs';

const STORE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'assets', 'store');

const POSTERS = [
  { name: 'poster-1440x2160.png', width: 1440, height: 2160 },
  { name: 'poster-720x1080.png', width: 720, height: 1080 },
] as const;

/** Le fond est nuit : au-delà, c'est du badge, donc une zone qui n'est plus libre. */
const DARK_LIMIT = 40;

async function load(name: string): Promise<DecodedPng> {
  return decodePng(await readFile(resolve(STORE, name)));
}

function brightest(image: DecodedPng, region: {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}): number {
  let maximum = 0;

  for (let y = region.y0; y < region.y1; y += 1) {
    for (let x = region.x0; x < region.x1; x += 1) {
      maximum = Math.max(maximum, luminance(image, x, y));
    }
  }

  return maximum;
}

describe('posterGeometry', () => {
  it.each(POSTERS)('centre le badge horizontalement en $width × $height', ({ width, height }) => {
    const { badgeSize, badgeX } = posterGeometry(width, height);

    expect(badgeX * 2 + badgeSize).toBe(width);
  });

  it.each(POSTERS)('laisse le tiers inférieur libre en $width × $height', ({ width, height }) => {
    const { badgeSize, badgeY } = posterGeometry(width, height);

    expect(badgeY + badgeSize).toBeLessThan((height * 2) / 3);
  });

  it.each(POSTERS)('garde une marge de sécurité en $width × $height', ({ width, height }) => {
    const { badgeX, badgeY } = posterGeometry(width, height);

    expect(badgeX).toBeGreaterThanOrEqual(width * 0.1);
    expect(badgeY).toBeGreaterThanOrEqual(height * 0.1);
  });

  it('rend la même composition aux deux tailles, à l’échelle près', () => {
    const grande = posterGeometry(1440, 2160);
    const petite = posterGeometry(720, 1080);

    expect(grande.badgeSize / 1440).toBeCloseTo(petite.badgeSize / 720, 3);
    expect(grande.badgeY / 2160).toBeCloseTo(petite.badgeY / 1080, 3);
  });
});

describe('assets/store', () => {
  it.each(POSTERS)('$name est un PNG aux dimensions exigées', async ({ name, width, height }) => {
    const file = await readFile(resolve(STORE, name));

    expect(file.subarray(0, 8)).toEqual(PNG_SIGNATURE);

    const image = decodePng(file);
    expect(image.width).toBe(width);
    expect(image.height).toBe(height);
  });

  // Partner Center étiquette ce visuel « 9:16 » mais en réclame les dimensions
  // en 720 × 1080 et 1440 × 2160, qui sont en 2:3. Ce sont les pixels qui font
  // foi à la certification, pas l'étiquette.
  it.each(POSTERS)('$name respecte le rapport des dimensions exigées', ({ width, height }) => {
    expect(width * 3).toBe(height * 2);
  });

  it.each(POSTERS)('$name est en 8 bits RGBA', async ({ name }) => {
    const file = await readFile(resolve(STORE, name));

    expect(file[24]).toBe(8);
    expect(file[25]).toBe(6);
  });

  it('est entièrement opaque : le Store n’aplatit aucune transparence', async () => {
    const image = await load('poster-720x1080.png');

    let opaque = true;
    for (let index = 3; index < image.pixels.byteLength; index += 4) {
      opaque &&= image.pixels[index] === 255;
    }

    expect(opaque).toBe(true);
  });

  it('porte bien le badge, et non un fond nu', async () => {
    const image = await load('poster-720x1080.png');
    const { badgeSize, badgeX, badgeY } = posterGeometry(image.width, image.height);

    expect(
      brightest(image, { x0: badgeX, y0: badgeY, x1: badgeX + badgeSize, y1: badgeY + badgeSize }),
    ).toBeGreaterThan(200);
  });

  it('laisse le tiers inférieur sombre, là où le Store surimprime son texte', async () => {
    const image = await load('poster-720x1080.png');

    expect(
      brightest(image, {
        x0: 0,
        y0: Math.floor((image.height * 2) / 3),
        x1: image.width,
        y1: image.height,
      }),
    ).toBeLessThan(DARK_LIMIT);
  });

  it('garde les bords libres, à l’abri d’un rognage du Store', async () => {
    const image = await load('poster-720x1080.png');
    const marginX = Math.floor(image.width * 0.05);
    const marginY = Math.floor(image.height * 0.05);

    const bords = [
      { x0: 0, y0: 0, x1: marginX, y1: image.height },
      { x0: image.width - marginX, y0: 0, x1: image.width, y1: image.height },
      { x0: 0, y0: 0, x1: image.width, y1: marginY },
    ];

    for (const bord of bords) {
      expect(brightest(image, bord)).toBeLessThan(DARK_LIMIT);
    }
  });
});
