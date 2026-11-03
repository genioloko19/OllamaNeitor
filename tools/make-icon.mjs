#!/usr/bin/env node
/** Genera build/icon.png (256×256) sin dependencias externas. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SIZE = 256;
const RADIUS = 58;

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let k = 0; k < 8; k += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function insideRounded(x, y, size, radius) {
  const inX = x >= radius && x <= size - radius;
  const inY = y >= radius && y <= size - radius;
  if (inX || inY) {
    return x >= 0 && y >= 0 && x <= size && y <= size;
  }
  const cx = x < radius ? radius : size - radius;
  const cy = y < radius ? radius : size - radius;
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

function insidePolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

const bolt = [
  [0.57, 0.1], [0.28, 0.56], [0.46, 0.56], [0.39, 0.9], [0.72, 0.42], [0.52, 0.42], [0.62, 0.1]
];

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
let offset = 0;

for (let y = 0; y < SIZE; y += 1) {
  raw[offset] = 0;
  offset += 1;
  for (let x = 0; x < SIZE; x += 1) {
    const nx = x / SIZE;
    const ny = y / SIZE;
    const t = Math.min(1, Math.max(0, (nx + ny) / 2));
    const r = Math.round(59 + (168 - 59) * t);
    const g = Math.round(130 + (85 - 130) * t);
    const b = Math.round(246 + (247 - 246) * t);
    const glow = Math.max(0, 1 - Math.hypot(nx - 0.34, ny - 0.26) * 1.6);
    const alpha = insideRounded(x + 0.5, y + 0.5, SIZE, RADIUS) ? 255 : 0;
    const isBolt = insidePolygon(nx, ny, bolt);
    raw[offset] = Math.min(255, r + glow * 32);
    raw[offset + 1] = Math.min(255, g + glow * 28);
    raw[offset + 2] = Math.min(255, b + glow * 20);
    raw[offset + 3] = alpha;
    if (isBolt && alpha > 0) {
      raw[offset] = 255;
      raw[offset + 1] = 255;
      raw[offset + 2] = 255;
    }
    offset += 4;
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;
ihdr[9] = 6;
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
]);

mkdirSync(resolve(ROOT, 'build'), { recursive: true });
writeFileSync(resolve(ROOT, 'build', 'icon.png'), png);
console.log(`✔ build/icon.png generado (${png.length} bytes)`);
