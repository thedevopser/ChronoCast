import { deflateSync, inflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);

  if (pa <= pb && pa <= pc) {
    return a;
  }
  return pb <= pc ? b : c;
}

function decodePng(file) {
  if (!file.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('ce fichier n’est pas un PNG');
  }

  let offset = 8;
  let header = null;
  const parts = [];

  while (offset < file.byteLength) {
    const length = file.readUInt32BE(offset);
    const type = file.toString('ascii', offset + 4, offset + 8);
    const data = file.subarray(offset + 8, offset + 8 + length);

    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === 'IDAT') {
      parts.push(data);
    } else if (type === 'IEND') {
      break;
    }

    offset += 12 + length;
  }

  if (header === null) {
    throw new Error('PNG sans IHDR');
  }
  if (header.depth !== 8 || header.colorType !== 6 || header.interlace !== 0) {
    throw new Error(
      `PNG non pris en charge (profondeur ${String(header.depth)}, type ${String(header.colorType)}, entrelacement ${String(header.interlace)}) : ce préparateur ne traite que le 8 bits RGBA non entrelacé`,
    );
  }

  const { width, height } = header;
  const raw = inflateSync(Buffer.concat(parts));
  const bpp = 4;
  const stride = width * bpp;
  const pixels = Buffer.alloc(height * stride);

  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));

    for (let x = 0; x < stride; x += 1) {
      const left = x >= bpp ? pixels[y * stride + x - bpp] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upLeft = x >= bpp && y > 0 ? pixels[(y - 1) * stride + x - bpp] : 0;

      let value = line[x];
      switch (filter) {
        case 0:
          break;
        case 1:
          value += left;
          break;
        case 2:
          value += up;
          break;
        case 3:
          value += (left + up) >> 1;
          break;
        case 4:
          value += paeth(left, up, upLeft);
          break;
        default:
          throw new Error(`filtre PNG inconnu : ${String(filter)}`);
      }

      pixels[y * stride + x] = value & 0xff;
    }
  }

  return { width, height, pixels };
}

function toSquare(image) {
  const side = Math.max(image.width, image.height);
  if (side === image.width && side === image.height) {
    return image;
  }

  const pixels = Buffer.alloc(side * side * 4);
  const offsetX = Math.floor((side - image.width) / 2);
  const offsetY = Math.floor((side - image.height) / 2);

  for (let y = 0; y < image.height; y += 1) {
    image.pixels.copy(
      pixels,
      ((y + offsetY) * side + offsetX) * 4,
      y * image.width * 4,
      (y + 1) * image.width * 4,
    );
  }

  return { width: side, height: side, pixels };
}

function resize(image, size) {
  const pixels = Buffer.alloc(size * size * 4);
  const ratio = image.width / size;

  for (let y = 0; y < size; y += 1) {
    const y0 = Math.floor(y * ratio);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * ratio));

    for (let x = 0; x < size; x += 1) {
      const x0 = Math.floor(x * ratio);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * ratio));

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;

      for (let sy = y0; sy < y1 && sy < image.height; sy += 1) {
        for (let sx = x0; sx < x1 && sx < image.width; sx += 1) {
          const source = (sy * image.width + sx) * 4;
          const alpha = image.pixels[source + 3];

          r += image.pixels[source] * alpha;
          g += image.pixels[source + 1] * alpha;
          b += image.pixels[source + 2] * alpha;
          a += alpha;
          count += 1;
        }
      }

      const target = (y * size + x) * 4;
      const meanAlpha = a / count;

      pixels[target] = a === 0 ? 0 : Math.round(r / a);
      pixels[target + 1] = a === 0 ? 0 : Math.round(g / a);
      pixels[target + 2] = a === 0 ? 0 : Math.round(b / a);
      pixels[target + 3] = Math.round(meanAlpha);
    }
  }

  return { width: size, height: size, pixels };
}

function letterbox(image, width, height) {
  const side = Math.min(width, height);
  const scaled = resize(image, side);

  if (width === height) {
    return scaled;
  }

  const pixels = Buffer.alloc(width * height * 4);
  const offsetX = Math.floor((width - side) / 2);
  const offsetY = Math.floor((height - side) / 2);

  for (let y = 0; y < side; y += 1) {
    scaled.pixels.copy(
      pixels,
      ((y + offsetY) * width + offsetX) * 4,
      y * side * 4,
      (y + 1) * side * 4,
    );
  }

  return { width, height, pixels };
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);

  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));

  return Buffer.concat([length, typed, crc]);
}

function encodePng(image) {
  const stride = image.width * 4;
  const raw = Buffer.alloc(image.height * (stride + 1));

  for (let y = 0; y < image.height; y += 1) {
    raw[y * (stride + 1)] = 0;
    image.pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header[8] = 8; // profondeur : 8 bits par canal
  header[9] = 6; // type couleur : RGBA
  header[10] = 0; // compression : deflate
  header[11] = 0; // filtrage : adaptatif
  header[12] = 0; // entrelacement : aucun

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function encodeIco(images) {
  const encoded = images.map((image) => encodePng(image));

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // réservé
  header.writeUInt16LE(1, 2); // type : icône
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(images.length * 16);
  let offset = header.byteLength + directory.byteLength;

  images.forEach((image, index) => {
    const start = index * 16;
    directory[start] = image.width === 256 ? 0 : image.width;
    directory[start + 1] = image.height === 256 ? 0 : image.height;
    directory[start + 2] = 0; // palette : sans objet en couleurs vraies
    directory[start + 3] = 0; // réservé
    directory.writeUInt16LE(1, start + 4); // plans
    directory.writeUInt16LE(32, start + 6); // bits par pixel
    directory.writeUInt32LE(encoded[index].byteLength, start + 8);
    directory.writeUInt32LE(offset, start + 12);

    offset += encoded[index].byteLength;
  });

  return Buffer.concat([header, directory, ...encoded]);
}

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
