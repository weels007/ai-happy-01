// main.ts — ai-happy-01 entry.
//
// A whale drifts through the dusk sky and lowers one small lantern toward the
// only lit window in the valley. The whole image is drawn here from arithmetic:
// a dusk gradient, stars, two hill silhouettes, a cottage with a warm window,
// the whale, and the lantern's halo. No assets, no network, no clock, and no
// randomness that is not seeded: every run writes the same bytes.
//
// Node 22+, standard library only. Outside the grader:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const W = 1024;
const H = 1024;

type RGB = [number, number, number];
type Pt = [number, number];

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const mixc = (a: RGB, b: RGB, t: number): RGB => [
  mix(a[0], b[0], t),
  mix(a[1], b[1], t),
  mix(a[2], b[2], t),
];
const smooth = (e0: number, e1: number, x: number): number => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const hex = (s: string): RGB => [
  parseInt(s.slice(1, 3), 16),
  parseInt(s.slice(3, 5), 16),
  parseInt(s.slice(5, 7), 16),
];

// ---------------------------------------------------------------- the canvas

const buf = new Float32Array(W * H * 3);

const inBounds = (x: number, y: number): boolean => x >= 0 && x < W && y >= 0 && y < H;

const blendPx = (x: number, y: number, c: RGB, cov: number): void => {
  if (cov <= 0 || !inBounds(x, y)) return;
  const i = (y * W + x) * 3;
  buf[i] = mix(buf[i], c[0], cov);
  buf[i + 1] = mix(buf[i + 1], c[1], cov);
  buf[i + 2] = mix(buf[i + 2], c[2], cov);
};

const addGlow = (
  cx: number,
  cy: number,
  r: number,
  c: RGB,
  power: number,
  gain: number,
): void => {
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(W - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(H - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - cx, y - cy) / r;
      if (d >= 1) continue;
      const a = Math.pow(1 - d, power) * gain;
      const i = (y * W + x) * 3;
      buf[i] += c[0] * a;
      buf[i + 1] += c[1] * a;
      buf[i + 2] += c[2] * a;
    }
  }
};

const stroke = (pts: Pt[], radius: number, c: RGB, alpha: number): void => {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const [px, py] of pts) {
    x0 = Math.min(x0, px);
    x1 = Math.max(x1, px);
    y0 = Math.min(y0, py);
    y1 = Math.max(y1, py);
  }
  const pad = radius + 2;
  for (let y = Math.floor(y0 - pad); y <= Math.ceil(y1 + pad); y++) {
    for (let x = Math.floor(x0 - pad); x <= Math.ceil(x1 + pad); x++) {
      let d = Infinity;
      for (let i = 0; i < pts.length - 1; i++) {
        const ax = pts[i][0];
        const ay = pts[i][1];
        const bx = pts[i + 1][0];
        const by = pts[i + 1][1];
        const vx = bx - ax;
        const vy = by - ay;
        const t = clamp01(((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1));
        d = Math.min(d, Math.hypot(x - (ax + vx * t), y - (ay + vy * t)));
      }
      const cov = smooth(radius + 0.9, radius - 0.9, d) * alpha;
      blendPx(x, y, c, cov);
    }
  }
};

// ------------------------------------------------------------------- the sky

const HORIZON = 812;

const skyAt = (y: number): RGB => {
  const t = clamp01(y / HORIZON);
  const stops: Array<[number, RGB]> = [
    [0.0, hex('#070b1e')],
    [0.3, hex('#121434')],
    [0.55, hex('#2a2352')],
    [0.74, hex('#5b3a5f')],
    [0.87, hex('#a95e55')],
    [1.0, hex('#e79a63')],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [p0, c0] = stops[i];
    const [p1, c1] = stops[i + 1];
    if (t <= p1) return mixc(c0, c1, smooth(p0, p1, t));
  }
  return stops[stops.length - 1][1];
};

for (let y = 0; y < H; y++) {
  const base = skyAt(y);
  for (let x = 0; x < W; x++) blendPx(x, y, base, 1);
}

// the last of the sun, low behind the hills on the right
addGlow(742, 806, 560, hex('#ff9c52'), 2.1, 0.5);
addGlow(742, 812, 240, hex('#ffd08a'), 2.4, 0.4);

// ------------------------------------------------------------------- stars

let seed = 20261114;
const rnd = (): number => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

for (let i = 0; i < 190; i++) {
  const x = rnd() * W;
  const y = rnd() * 560;
  const fade = 1 - smooth(300, 620, y);
  if (fade <= 0.02) continue;
  const r = 0.7 + rnd() * 1.5;
  const bright = (0.35 + rnd() * 0.65) * fade;
  addGlow(x, y, r * 5, hex('#dfe8ff'), 2.2, bright * 0.9);
  addGlow(x, y, r * 1.8, hex('#ffffff'), 2.6, bright * 0.7);
}

// ------------------------------------------------------------------- hills

const farHill = (x: number): number =>
  748 + 22 * Math.sin(x / 253 + 0.4) + 11 * Math.sin(x / 91 + 2.2);

const nearHill = (x: number): number =>
  832 + 20 * Math.sin(x / 337 + 2.05) + 9 * Math.sin(x / 127 + 0.7);

for (let x = 0; x < W; x++) {
  const top = farHill(x);
  for (let y = Math.max(0, Math.floor(top) - 1); y < H; y++) {
    const cov = smooth(-0.9, 0.9, y - top);
    if (cov <= 0) continue;
    const lit = smooth(60, 0, y - top) * 0.35;
    blendPx(x, y, mixc(hex('#2b2350'), hex('#6b3a52'), lit), cov);
  }
}

for (let x = 0; x < W; x++) {
  const top = nearHill(x);
  for (let y = Math.max(0, Math.floor(top) - 1); y < H; y++) {
    const cov = smooth(-0.9, 0.9, y - top);
    if (cov <= 0) continue;
    blendPx(x, y, hex('#100c1f'), cov);
  }
}

// ------------------------------------------------------------------ cottage

const HOUSE_X = 800;
const HOUSE_BASE = nearHill(HOUSE_X) + 6;
const WALL_W = 120;
const WALL_H = 76;
const ROOF_H = 52;
const HALF_BASE = WALL_W / 2 + 10;
const wallTop = HOUSE_BASE - WALL_H;
const roofApex = wallTop - ROOF_H;

const WIN_W = 32;
const WIN_H = 38;
const WIN_X = HOUSE_X - WIN_W / 2;
const WIN_Y = wallTop + 22;

const sdRect = (
  x: number,
  y: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
): number => {
  const dx = Math.max(x0 - x, x - (x0 + w));
  const dy = Math.max(y0 - y, y - (y0 + h));
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);
};

// walls and a proper gable roof: a triangle bounded by three half-planes
{
  const scale = ROOF_H / Math.hypot(HALF_BASE, ROOF_H);

  for (let y = Math.floor(roofApex) - 2; y < Math.ceil(HOUSE_BASE) + 2; y++) {
    for (let x = HOUSE_X - HALF_BASE - 2; x < HOUSE_X + HALF_BASE + 2; x++) {
      const roofApexD = roofApex - y; // inside when below the apex
      const eaveD = y - wallTop; // inside when above the eaves
      const wall = sdRect(x, y, HOUSE_X - WALL_W / 2, wallTop, WALL_W, WALL_H);
      const sideD =
        (Math.abs(x - HOUSE_X) - (HALF_BASE * (y - roofApex)) / ROOF_H) * scale;
      const roof = Math.max(roofApexD, eaveD, sideD);
      const d = Math.min(wall, roof);
      blendPx(x, y, hex('#0c0918'), smooth(0.9, -0.9, d));
    }
  }
}

// the warm light the window throws across the hillside
addGlow(WIN_X + WIN_W / 2, WIN_Y + WIN_H / 2, 210, hex('#ffb155'), 2.6, 0.45);
addGlow(WIN_X + WIN_W / 2, HOUSE_BASE + 26, 130, hex('#ff9f45'), 2.4, 0.32);

// the window: a warm pane with mullions, drawn over the silhouette
{
  for (let y = WIN_Y - 3; y < WIN_Y + WIN_H + 3; y++) {
    for (let x = WIN_X - 3; x < WIN_X + WIN_W + 3; x++) {
      const d = sdRect(x, y, WIN_X, WIN_Y, WIN_W, WIN_H);
      const cov = smooth(1.1, -1.1, d);
      if (cov <= 0) continue;
      const gx = (x - WIN_X) / WIN_W;
      const gy = (y - WIN_Y) / WIN_H;
      const warm = 1 - clamp01(Math.hypot(gx - 0.45, gy - 0.4) * 1.15);
      const c = mixc(hex('#ffbe5c'), hex('#fffbe6'), Math.pow(clamp01(warm), 1.25) * 0.95);
      blendPx(x, y, c, cov);
      // mullions
      const barH = Math.abs(y - (WIN_Y + WIN_H / 2)) < 1.4;
      const barV = Math.abs(x - (WIN_X + WIN_W / 2)) < 1.4;
      if (barH || barV) blendPx(x, y, hex('#7a4a1e'), cov * 0.55);
    }
  }
  // the panes bleed a little light past their frame
  addGlow(WIN_X + WIN_W / 2, WIN_Y + WIN_H / 2, 78, hex('#ffca7a'), 2.6, 0.22);
}

// -------------------------------------------------------------- the lantern

const LANTERN_X = 552;
const LANTERN_Y = 548;

addGlow(LANTERN_X, LANTERN_Y, 340, hex('#ff9d4a'), 2.3, 0.4);
addGlow(LANTERN_X, LANTERN_Y, 150, hex('#ffc978'), 2.5, 0.45);

// ----------------------------------------------------------------- the whale

const WHALE_A = (7 * Math.PI) / 180;
const WHALE_X = 430;
const WHALE_Y = 360;
const COS_A = Math.cos(WHALE_A);
const SIN_A = Math.sin(WHALE_A);

const toCanvas = (lx: number, ly: number): Pt => [
  WHALE_X + lx * COS_A - ly * SIN_A,
  WHALE_Y + lx * SIN_A + ly * COS_A,
];

const sdEllipse = (
  lx: number,
  ly: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rot: number,
): number => {
  const c = Math.cos(-rot);
  const s = Math.sin(-rot);
  const dx = lx - cx;
  const dy = ly - cy;
  const px = dx * c - dy * s;
  const py = dx * s + dy * c;
  return (Math.hypot(px / rx, py / ry) - 1) * Math.min(rx, ry);
};

const smin = (a: number, b: number, k: number): number => {
  const h = clamp01(0.5 + (0.5 * (b - a)) / k);
  return mix(b, a, h) - k * h * (1 - h);
};

const whaleSdf = (lx: number, ly: number): number => {
  // the body, fuller at the head where it leans toward the cottage
  let d = smin(sdEllipse(lx, ly, 0, 0, 196, 88, 0), sdEllipse(lx, ly, 118, 14, 78, 78, 0), 40);
  // the tail stock narrowing behind
  d = smin(d, sdEllipse(lx, ly, -172, 10, 68, 36, 0.12), 44);
  // one swept blade of a fluke, and a small lower one: a side-on whale tail
  d = smin(d, sdEllipse(lx, ly, -226, -28, 66, 25, -0.44), 22);
  d = smin(d, sdEllipse(lx, ly, -212, 32, 44, 17, 0.3), 22);
  // the pectoral fin, reaching down toward the valley
  d = smin(d, sdEllipse(lx, ly, 86, 96, 64, 22, 0.62), 18);
  // a small dorsal fin
  d = smin(d, sdEllipse(lx, ly, -46, -78, 34, 17, 0.34), 18);
  return d;
};

{
  for (let y = 120; y <= 640; y++) {
    for (let x = 100; x <= 780; x++) {
      const dx = x - WHALE_X;
      const dy = y - WHALE_Y;
      const lx = dx * COS_A + dy * SIN_A;
      const ly = -dx * SIN_A + dy * COS_A;
      const d = whaleSdf(lx, ly);
      if (d > 2) continue;
      const cov = smooth(1.2, -1.2, d);
      if (cov <= 0) continue;

      // dim sky above, deeper below, a pale belly, a warm rim from the lantern
      const t = smooth(-84, 92, ly);
      let c = mixc(hex('#95aae6'), hex('#4e5b93'), t);
      c = mixc(c, hex('#cfdaf8'), smooth(6, 58, ly) * 0.72);
      c = mixc(c, hex('#b9c9f6'), smooth(-140, -30, ly) * 0.3);

      const dl = Math.hypot(x - LANTERN_X, y - LANTERN_Y);
      c = mixc(c, hex('#ffcf8e'), Math.pow(clamp01(1 - dl / 320), 2.2) * 0.8);

      blendPx(x, y, c, cov);
    }
  }
}

// the eye, its catchlight, and the crease of a patient smile
{
  const eye = toCanvas(152, -6);
  for (let y = Math.floor(eye[1]) - 12; y <= Math.ceil(eye[1]) + 12; y++) {
    for (let x = Math.floor(eye[0]) - 12; x <= Math.ceil(eye[0]) + 12; x++) {
      const d = Math.hypot(x - eye[0], y - eye[1]) - 6.6;
      blendPx(x, y, hex('#1b1633'), smooth(1.0, -1.0, d));
    }
  }
  addGlow(eye[0] - 2.2, eye[1] - 2.4, 6, hex('#ffffff'), 2.0, 0.9);

  const mouth: Pt[] = [];
  for (let i = 0; i <= 22; i++) {
    const t = i / 22;
    const lx = mix(140, 190, t);
    const ly = 34 + Math.sin(Math.PI * t) * 16;
    mouth.push(toCanvas(lx, ly));
  }
  stroke(mouth, 2.1, hex('#2a2450'), 0.85);
}

// the cord and the lantern hanging from the fin's tip
{
  const tip = toCanvas(140, 138);
  const pts: Pt[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    pts.push([mix(tip[0], LANTERN_X, t), mix(tip[1], LANTERN_Y - 20, t)]);
  }
  stroke(pts, 1.6, hex('#241c3a'), 0.9);
}

{
  for (let y = LANTERN_Y - 34; y <= LANTERN_Y + 30; y++) {
    for (let x = LANTERN_X - 26; x <= LANTERN_X + 26; x++) {
      const dBody = sdEllipse(x, y, LANTERN_X, LANTERN_Y, 15, 18, 0);
      const dCap = sdRect(x, y, LANTERN_X - 10, LANTERN_Y - 26, 20, 7);
      const dRing = sdRect(x, y, LANTERN_X - 8, LANTERN_Y + 15, 16, 5);
      const d = Math.min(dBody, dCap, dRing);
      const cov = smooth(1.0, -1.0, d);
      if (cov <= 0) continue;
      const glow = 1 - clamp01(Math.hypot(x - LANTERN_X, y - LANTERN_Y) / 23);
      const c = mixc(hex('#ffb04f'), hex('#fffbe8'), Math.pow(glow, 1.3) * 0.95);
      blendPx(x, y, c, cov);
    }
  }
  addGlow(LANTERN_X, LANTERN_Y, 96, hex('#ffe7b4'), 2.4, 0.55);
}

// -------------------------------------------------------------------- finish

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const dx = (x - W / 2) / (W / 2);
    const dy = (y - H / 2) / (H / 2);
    const v = 1 - 0.28 * Math.pow(clamp01(Math.hypot(dx, dy) / 1.42), 2.2);
    const i = (y * W + x) * 3;
    buf[i] *= v;
    buf[i + 1] *= v;
    buf[i + 2] *= v;
  }
}

// ------------------------------------------------------------------- the PNG

const crcTable: number[] = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}

const crc32 = (b: Buffer): number => {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type: string, data: Buffer): Buffer => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
};

const raw = Buffer.alloc(H * (1 + W * 3));
let o = 0;
for (let y = 0; y < H; y++) {
  raw[o++] = 0; // filter: none
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    raw[o++] = Math.round(clamp01(buf[i] / 255) * 255);
    raw[o++] = Math.round(clamp01(buf[i + 1] / 255) * 255);
    raw[o++] = Math.round(clamp01(buf[i + 2] / 255) * 255);
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // colour type: truecolour
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'entry.png'), png);
