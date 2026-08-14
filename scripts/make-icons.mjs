// Generates the placeholder extension icons: an indigo tile with a white
// bookmark glyph. Run with `node scripts/make-icons.mjs`.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const SIZES = [16, 32, 48, 96, 128];
const BG = [79, 70, 229, 255];
const FG = [255, 255, 255, 255];

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size) {
  const rows = [];
  const inset = Math.max(2, Math.round(size * 0.28));
  const notch = Math.round(size * 0.18);

  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) {
      // Bookmark glyph: vertical band with a notch cut out of the bottom.
      const inBand = x >= inset && x < size - inset && y >= inset && y < size - inset;
      const inNotch =
        y > size - inset - notch &&
        Math.abs(x - (size - 1) / 2) < notch - (size - inset - y);
      const color = inBand && !inNotch ? FG : BG;
      row.set(color, 1 + x * 4);
    }
    rows.push(row);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(new URL('../public/icon/', import.meta.url), { recursive: true });
for (const size of SIZES) {
  const out = new URL(`../public/icon/${size}.png`, import.meta.url);
  writeFileSync(out, png(size));
  console.log(`wrote public/icon/${size}.png`);
}
