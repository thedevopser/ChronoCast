/**
 * Engendre l'icône provisoire de la zone de notification.
 *
 * L'icône est un livrable visuel, et l'identité de ChronoCast n'est pas encore
 * arrêtée : celle-ci est un **placeholder assumé**, à remplacer avant la
 * première release. Elle est engendrée par ce script plutôt que déposée telle
 * quelle pour la même raison qui fait vérifier le condensat d'Open Props : un
 * binaire versionné sans provenance est un binaire que personne ne peut
 * reconstituer ni auditer.
 *
 * Aucune dépendance : le PNG est écrit à la main — signature, IHDR, IDAT
 * compressé par `zlib`, IEND — parce qu'ajouter une bibliothèque d'images à
 * l'arbre de production pour dessiner un disque violet serait absurde, et
 * qu'`npm audit --audit-level=high` a un droit de veto sur chaque PR.
 *
 *   node scripts/generate-placeholder-icon.mjs
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 32;

/** Accent Twitch, déjà employé par le panneau d'administration. */
const ACCENT = [0x91, 0x46, 0xff];
const WHITE = [0xff, 0xff, 0xff];

/** Table CRC-32, telle que la spécification PNG la décrit. */
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

/** Un chunk PNG : longueur, type, données, CRC du type et des données. */
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);

  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));

  return Buffer.concat([length, typed, crc]);
}

/**
 * Dessine le pixel (x, y) : un disque à l'accent, deux aiguilles blanches.
 *
 * L'anticrénelage est une simple atténuation de l'alpha sur le dernier pixel du
 * bord — suffisant à cette taille, et sans quoi le disque aurait l'air d'un
 * escalier dans la barre des tâches.
 */
function pixelAt(x, y) {
  const center = (SIZE - 1) / 2;
  const dx = x - center;
  const dy = y - center;
  const distance = Math.hypot(dx, dy);
  const radius = center - 0.5;

  if (distance > radius) {
    return [0, 0, 0, 0];
  }

  const alpha = Math.round(255 * Math.min(1, radius - distance + 1));

  // Aiguilles : une verticale vers le haut, une horizontale vers la droite.
  const onVertical = Math.abs(dx) <= 1 && dy <= 0 && dy >= -radius * 0.62;
  const onHorizontal = Math.abs(dy) <= 1 && dx >= 0 && dx <= radius * 0.46;

  const colour = onVertical || onHorizontal ? WHITE : ACCENT;
  return [...colour, alpha];
}

function renderPng() {
  // Une ligne = un octet de filtre (0 : aucun) suivi des pixels RGBA.
  const raw = Buffer.alloc(SIZE * (1 + SIZE * 4));
  let offset = 0;

  for (let y = 0; y < SIZE; y += 1) {
    raw[offset] = 0;
    offset += 1;
    for (let x = 0; x < SIZE; x += 1) {
      const [r, g, b, a] = pixelAt(x, y);
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
      offset += 4;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header[8] = 8; // profondeur : 8 bits par canal
  header[9] = 6; // type couleur : RGBA
  header[10] = 0; // compression : deflate, seule valeur admise
  header[11] = 0; // filtrage : adaptatif, seule valeur admise
  header[12] = 0; // entrelacement : aucun

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const target = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'tray.png');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, renderPng());

console.log(`[icon] ${target} engendrée (${String(SIZE)}×${String(SIZE)}).`);
