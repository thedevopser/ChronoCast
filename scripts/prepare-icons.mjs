import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodePng, encodeIco, encodePng, letterbox, resize, toSquare } from './lib/png.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = resolve(REPO_ROOT, 'assets');

const WEB_SHARED = resolve(REPO_ROOT, 'src', 'web', 'shared');

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

const TRAY_SIZE = 32;

const APPX_LOGOS = [
  { name: 'Square44x44Logo.png', width: 44, height: 44 },
  { name: 'Square150x150Logo.png', width: 150, height: 150 },
  { name: 'StoreLogo.png', width: 50, height: 50 },
  { name: 'Wide310x150Logo.png', width: 310, height: 150 },
  { name: 'SmallTile.png', width: 71, height: 71 },
  { name: 'LargeTile.png', width: 300, height: 300 },
  { name: 'SplashScreen.png', width: 620, height: 300 },
];

const WEB_LOGO_SIZE = 128;

function load(name) {
  const image = toSquare(decodePng(readFileSync(resolve(ASSETS, name))));
  console.log(`[icons] ${name} → ${String(image.width)}×${String(image.height)} après mise au carré`);
  return image;
}

const tray = load('tray-icon.png');
const trayTarget = resolve(ASSETS, 'tray.png');
writeFileSync(trayTarget, encodePng(resize(tray, TRAY_SIZE)));
console.log(`[icons] assets/tray.png engendrée en ${String(TRAY_SIZE)}×${String(TRAY_SIZE)}.`);

const logo = load('logo.png');
const icoTarget = resolve(ASSETS, 'icon.ico');
writeFileSync(icoTarget, encodeIco(ICO_SIZES.map((size) => resize(logo, size))));
console.log(`[icons] assets/icon.ico engendrée : ${ICO_SIZES.join(', ')}.`);

const appxDirectory = resolve(ASSETS, 'appx');
mkdirSync(appxDirectory, { recursive: true });
for (const format of APPX_LOGOS) {
  writeFileSync(
    resolve(appxDirectory, format.name),
    encodePng(letterbox(logo, format.width, format.height)),
  );
  console.log(
    `[icons] assets/appx/${format.name} engendrée en ${String(format.width)}×${String(format.height)}.`,
  );
}

const webLogoTarget = resolve(WEB_SHARED, 'logo.png');
writeFileSync(webLogoTarget, encodePng(resize(logo, WEB_LOGO_SIZE)));
console.log(`[icons] src/web/shared/logo.png engendré en ${String(WEB_LOGO_SIZE)}×${String(WEB_LOGO_SIZE)}.`);
