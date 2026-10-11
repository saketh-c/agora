/**
 * Generate PWA icons (PNG) without any image library: the Agora mark (a stoa with a
 * speaker at the podium, head lit Go green) in white on Ink, rendered with 4x
 * supersampling and encoded with Node's zlib. The geometry matches
 * packages/web/public/favicon.svg and the header mark exactly.
 *
 * Usage: node scripts/make-icons.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '..', 'packages', 'web', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const INK = [21, 24, 43]; // #15182B
const CARD = [255, 255, 255];
const GO = [30, 210, 138]; // #1ED28A

function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  let c;
  const table = [];
  for (let n = 0; n < 256; n += 1) {
    c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * The mark, in the favicon's 28 unit grid (packages/web/src/components/shell/Brand.jsx):
 * an architrave, two columns and a base (Card white on Ink), and a speaker at the podium
 * between the columns whose head is the Go light.
 */
const R = (x, y, w, h, r) => ({ kind: 'rect', x, y, w, h, r });
const STRUCTURE = [R(2, 2.5, 24, 4.5, 1.6), R(3.5, 9, 4.2, 15, 1.2), R(20.3, 9, 4.2, 15, 1.2), R(1.5, 24.6, 25, 2, 1)];
const PODIUM = [
  [9.6, 16.2],
  [18.4, 16.2],
  [17.25, 24],
  [10.75, 24],
];
const HEAD = { cx: 14, cy: 11.6, r: 3.1 };

function inRoundRect(x, y, { x: rx, y: ry, w, h, r }) {
  if (x < rx || y < ry || x > rx + w || y > ry + h) return false;
  const cx = Math.min(Math.max(x, rx + r), rx + w - r);
  const cy = Math.min(Math.max(y, ry + r), ry + h - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function inPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Color of the mark at (x, y) in its 28 unit grid, or null for background. */
function markAt(x, y) {
  if ((x - HEAD.cx) ** 2 + (y - HEAD.cy) ** 2 <= HEAD.r ** 2) return GO;
  if (inPolygon(x, y, PODIUM) || STRUCTURE.some((r) => inRoundRect(x, y, r))) return CARD;
  return null;
}

function render(size, { maskable = false } = {}) {
  const ss = 4;
  const rgba = Buffer.alloc(size * size * 4);
  // A maskable icon has to survive a circular crop, so the glyph is inset further.
  const pad = maskable ? 0.24 : 0.16;
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < ss; sy += 1) {
        for (let sx = 0; sx < ss; sx += 1) {
          const x = (px + (sx + 0.5) / ss) / size;
          const y = (py + (sy + 0.5) / ss) / size;
          const gx = ((x - pad) / (1 - 2 * pad)) * 28;
          const gy = ((y - pad) / (1 - 2 * pad)) * 28;
          const color = (gx >= 0 && gx < 28 && gy >= 0 && gy < 28 && markAt(gx, gy)) || INK;
          acc[0] += color[0];
          acc[1] += color[1];
          acc[2] += color[2];
          acc[3] += 255;
        }
      }
      const n = ss * ss;
      const i = (py * size + px) * 4;
      rgba[i] = Math.round(acc[0] / n);
      rgba[i + 1] = Math.round(acc[1] / n);
      rgba[i + 2] = Math.round(acc[2] / n);
      rgba[i + 3] = Math.round(acc[3] / n);
    }
  }
  return encodePng(size, size, rgba);
}

writeFileSync(path.join(outDir, 'icon-192.png'), render(192));
writeFileSync(path.join(outDir, 'icon-512.png'), render(512));
writeFileSync(path.join(outDir, 'maskable-512.png'), render(512, { maskable: true }));
console.log(`Wrote icons to ${outDir}`);
