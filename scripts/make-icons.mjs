/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Generates the extension icons from the Tabstack brand mark.
//
// The mark is four offset bars on a 2×4 grid, taken from the wordmark SVG used
// on tabstack.ai (rect geometry: 108.932 × 42.3624 units per bar, mark bounds
// 217.803 × 169.449). Proportions match the official icon-512x512.png: ink
// #101018 on white, mark 70% of the tile width, optically centred.
//
// Drawn on integer pixel boundaries at every size instead of downscaling the
// 512px PNG, so the bars stay crisp at 16px. Run: node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const SIZES = [16, 32, 48, 96, 128, 256];
const INK = [16, 16, 24, 255];
const PAPER = [255, 255, 255, 255];

/** Bar cells as [column, row] on the 2-wide, 4-tall grid, top to bottom. */
const CELLS = [
  [1, 0],
  [0, 1],
  [1, 2],
  [0, 3],
];

const MARK_WIDTH_RATIO = 0.7; // 358 / 512 in the official icon
const BAR_ASPECT = 42.3624 / 108.932; // bar height / bar width

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
  const barWidth = Math.max(1, Math.round((size * MARK_WIDTH_RATIO) / 2));
  const barHeight = Math.max(1, Math.round(barWidth * BAR_ASPECT));
  const left = Math.round((size - barWidth * 2) / 2);
  const top = Math.round((size - barHeight * 4) / 2);

  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) {
      const column = Math.floor((x - left) / barWidth);
      const rowIndex = Math.floor((y - top) / barHeight);
      const inMark =
        x >= left &&
        x < left + barWidth * 2 &&
        y >= top &&
        y < top + barHeight * 4 &&
        CELLS.some(([c, r]) => c === column && r === rowIndex);
      row.set(inMark ? INK : PAPER, 1 + x * 4);
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

/** Same mark as vector, for docs and store listings. */
function svg() {
  const bars = CELLS.map(
    ([c, r]) =>
      `  <rect x="${(c * 108.932).toFixed(3)}" y="${(r * 42.3624).toFixed(4)}" ` +
      `width="108.932" height="42.3624" fill="#101018" />`,
  ).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 217.803 169.449" width="217.803" height="169.449">\n${bars}\n</svg>\n`;
}

/** Chrome Web Store promo tile: the mark centred on the brand's paper white. */
function promoTile(width, height) {
  const barWidth = Math.round((width * 0.22) / 2);
  const barHeight = Math.round(barWidth * BAR_ASPECT);
  const left = Math.round((width - barWidth * 2) / 2);
  const top = Math.round((height - barHeight * 4) / 2);

  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 4);
    for (let x = 0; x < width; x++) {
      const column = Math.floor((x - left) / barWidth);
      const rowIndex = Math.floor((y - top) / barHeight);
      const inMark =
        x >= left &&
        x < left + barWidth * 2 &&
        y >= top &&
        y < top + barHeight * 4 &&
        CELLS.some(([c, r]) => c === column && r === rowIndex);
      row.set(inMark ? INK : PAPER, 1 + x * 4);
    }
    rows.push(row);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(new URL('../public/icon/', import.meta.url), { recursive: true });
for (const size of SIZES) {
  writeFileSync(new URL(`../public/icon/${size}.png`, import.meta.url), png(size));
  console.log(`wrote public/icon/${size}.png`);
}
writeFileSync(new URL('../public/icon/mark.svg', import.meta.url), svg());
console.log('wrote public/icon/mark.svg');

mkdirSync(new URL('../store/', import.meta.url), { recursive: true });
writeFileSync(
  new URL('../store/promo-tile-440x280.png', import.meta.url),
  promoTile(440, 280),
);
console.log('wrote store/promo-tile-440x280.png');
