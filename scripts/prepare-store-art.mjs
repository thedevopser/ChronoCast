import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodePng, encodePng, over, resize, toSquare } from './lib/png.mjs';
import { posterGeometry } from './lib/poster.mjs';

/**
 * Engendre l'image d'affiche 9:16 réclamée par la fiche Microsoft Store.
 *
 * Les politiques du Store veulent que les visuels promotionnels ne portent
 * aucun texte étranger à la marque : l'affiche ne compose donc qu'un fond et le
 * badge d'`assets/logo.png`, qui porte déjà le mot-marque.
 *
 * Le rendu est volontairement déterministe — aucune source d'aléa — sans quoi le
 * test garde-fou `tests/unit/assets/store-art.test.ts` ne vaudrait rien.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = resolve(REPO_ROOT, 'assets');
const STORE = resolve(ASSETS, 'store');

const POSTERS = [
  { name: 'poster-1440x2160.png', width: 1440, height: 2160 },
  { name: 'poster-720x1080.png', width: 720, height: 1080 },
];

/** Dégradé vertical, dans l'esprit des jetons de `src/web/shared/theme.css`. */
const BACKGROUND = [
  { at: 0, color: [0x0b, 0x0b, 0x0f] },
  { at: 0.38, color: [0x1a, 0x10, 0x30] },
  { at: 0.72, color: [0x12, 0x0c, 0x22] },
  { at: 1, color: [0x0a, 0x0a, 0x0c] },
];

/** `--cc-accent`, en halo derrière le badge. */
const GLOW_COLOR = [0x91, 0x46, 0xff];
const GLOW_RADIUS_FRACTION = 0.55;
const GLOW_PEAK = 0.3;

const VIGNETTE_DEPTH = 0.12;

function gradientAt(ratio) {
  let lower = BACKGROUND[0];

  for (const stop of BACKGROUND) {
    if (stop.at <= ratio) {
      lower = stop;
    }
  }

  const upper = BACKGROUND.find((stop) => stop.at > ratio) ?? lower;
  const span = upper.at - lower.at;
  const progress = span === 0 ? 0 : (ratio - lower.at) / span;

  return lower.color.map((channel, index) => channel + (upper.color[index] - channel) * progress);
}

function paintBackground(width, height, glowCenterX, glowCenterY) {
  const pixels = Buffer.alloc(width * height * 4);
  const glowRadius = width * GLOW_RADIUS_FRACTION;
  const centerX = width / 2;
  const centerY = height / 2;
  const halfDiagonal = Math.hypot(centerX, centerY);

  for (let y = 0; y < height; y += 1) {
    const column = gradientAt(y / (height - 1));

    for (let x = 0; x < width; x += 1) {
      // Halo : décroissance en (1 − t²)², qui s'éteint franchement au bord du
      // rayon plutôt que de baver jusque dans le tiers inférieur.
      const distance = Math.hypot(x - glowCenterX, y - glowCenterY);
      const t = Math.min(1, distance / glowRadius);
      const glow = GLOW_PEAK * (1 - t * t) ** 2;

      // Vignettage : les angles sont assombris, ce qui recentre le regard.
      const shade = 1 - VIGNETTE_DEPTH * (Math.hypot(x - centerX, y - centerY) / halfDiagonal) ** 2;

      const target = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const mixed = column[channel] + (GLOW_COLOR[channel] - column[channel]) * glow;
        pixels[target + channel] = Math.round(Math.max(0, Math.min(255, mixed * shade)));
      }
      pixels[target + 3] = 255;
    }
  }

  return { width, height, pixels };
}

const badge = toSquare(decodePng(readFileSync(resolve(ASSETS, 'logo.png'))));
console.log(`[store] logo.png → ${String(badge.width)}×${String(badge.height)} après mise au carré`);

mkdirSync(STORE, { recursive: true });

for (const poster of POSTERS) {
  const { badgeSize, badgeX, badgeY } = posterGeometry(poster.width, poster.height);
  const canvas = paintBackground(poster.width, poster.height, poster.width / 2, badgeY + badgeSize / 2);

  writeFileSync(
    resolve(STORE, poster.name),
    encodePng(over(canvas, resize(badge, badgeSize), badgeX, badgeY)),
  );
  console.log(
    `[store] assets/store/${poster.name} engendrée en ${String(poster.width)}×${String(poster.height)}, badge de ${String(badgeSize)} px en (${String(badgeX)}, ${String(badgeY)}).`,
  );
}
