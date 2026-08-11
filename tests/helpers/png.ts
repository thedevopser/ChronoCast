import { inflateSync } from 'node:zlib';

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface DecodedPng {
  readonly width: number;
  readonly height: number;
  /** Quatre octets par pixel, RGBA, ligne par ligne. */
  readonly pixels: Buffer;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);

  if (pa <= pb && pa <= pc) {
    return a;
  }
  return pb <= pc ? b : c;
}

/**
 * Décodeur minimal, restreint au 8 bits RGBA non entrelacé : c'est tout ce que
 * `scripts/lib/png.mjs` sait produire, et le seul format que les visuels
 * engendrés du dépôt emploient.
 */
export function decodePng(file: Buffer): DecodedPng {
  if (!file.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('ce fichier n’est pas un PNG');
  }

  let offset = 8;
  let header: { width: number; height: number; depth: number; colorType: number } | null = null;
  const parts: Buffer[] = [];

  while (offset < file.byteLength) {
    const length = file.readUInt32BE(offset);
    const type = file.toString('ascii', offset + 4, offset + 8);
    const data = file.subarray(offset + 8, offset + 8 + length);

    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8]!,
        colorType: data[9]!,
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
  if (header.depth !== 8 || header.colorType !== 6) {
    throw new Error('PNG non pris en charge : seul le 8 bits RGBA est décodé ici');
  }

  const { width, height } = header;
  const raw = inflateSync(Buffer.concat(parts));
  const bpp = 4;
  const stride = width * bpp;
  const pixels = Buffer.alloc(height * stride);

  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));

    for (let x = 0; x < stride; x += 1) {
      const left = x >= bpp ? pixels[y * stride + x - bpp]! : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x]! : 0;
      const upLeft = x >= bpp && y > 0 ? pixels[(y - 1) * stride + x - bpp]! : 0;

      let value = line[x]!;
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

/** Luminance perçue (Rec. 709), sur 0…255. */
export function luminance(image: DecodedPng, x: number, y: number): number {
  const index = (y * image.width + x) * 4;

  return 0.2126 * image.pixels[index]! + 0.7152 * image.pixels[index + 1]! + 0.0722 * image.pixels[index + 2]!;
}
