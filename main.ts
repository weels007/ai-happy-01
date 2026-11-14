// Make the AI judge happy — dusk scene: a whale flying through the evening sky,
// lowering a paper lantern toward the only lit window in the valley.
// Deterministic, no network, standard library only. Writes out/entry.png (RGB 1024x1024).

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const W = 1024;
const H = 1024;

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32)
// ---------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Small math helpers
// ---------------------------------------------------------------------------
function clamp(v: number, lo: number, hi: number): number { return v < lo ? lo : v > hi ? hi : v; }
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}
function lerp3(c1: number[], c2: number[], t: number): number[] {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}
function hypot(x: number, y: number): number { return Math.sqrt(x * x + y * y); }

// Image (RGB)
const img = new Uint8Array(W * H * 3);
function setPix(x: number, y: number, c: number[]): void {
  const i = (y * W + x) * 3;
  img[i] = c[0]; img[i + 1] = c[1]; img[i + 2] = c[2];
}
function blendPix(x: number, y: number, c: number[], a: number): void {
  const i = (y * W + x) * 3;
  const ia = 1 - a;
  img[i] = img[i] * ia + c[0] * a;
  img[i + 1] = img[i + 1] * ia + c[1] * a;
  img[i + 2] = img[i + 2] * ia + c[2] * a;
}

// SDF coverage: given signed distance d (negative inside), anti-aliased alpha.
function cov(d: number): number { return smoothstep(-1, 1, -d); }

// ---------------------------------------------------------------------------
// Shape painting primitives
// ---------------------------------------------------------------------------
type SDF = (x: number, y: number) => number;
type Shade = (x: number, y: number, d: number, a: number) => number[];

function paintShape(bx0: number, by0: number, bx1: number, by1: number, sdf: SDF, shade: Shade): void {
  const x0 = Math.max(0, Math.floor(bx0)), x1 = Math.min(W - 1, Math.ceil(bx1));
  const y0 = Math.max(0, Math.floor(by0)), y1 = Math.min(H - 1, Math.ceil(by1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = sdf(x + 0.5, y + 0.5);
      const a = cov(d);
      if (a <= 0.001) continue;
      const c = shade(x, y, d, a);
      if (a >= 0.999) setPix(x, y, c); else blendPix(x, y, c, a);
    }
  }
}

// Soft glow: additive-ish blend of a color with radial falloff.
function glowShape(cx: number, cy: number, rx: number, ry: number, col: number[], maxA: number, expo: number): void {
  const x0 = Math.max(0, Math.floor(cx - rx)), x1 = Math.min(W - 1, Math.ceil(cx + rx));
  const y0 = Math.max(0, Math.floor(cy - ry)), y1 = Math.min(H - 1, Math.ceil(cy + ry));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry);
      if (d >= 1) continue;
      const a = maxA * Math.pow(1 - d, expo);
      if (a > 0.002) blendPix(x, y, col, a);
    }
  }
}

// Ellipse SDF (axis-aligned in the local frame then rotated by `ang`), returns a
// signed distance measured in pixels.
function ellipseDist(px: number, py: number, cx: number, cy: number, rx: number, ry: number, ang: number): number {
  const dx = px - cx, dy = py - cy;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const qx = dx * ca + dy * sa;
  const qy = -dx * sa + dy * ca;
  const l = hypot(qx / rx, qy / ry);
  return (l - 1) * Math.min(rx, ry);
}

// Box SDF
function sdBox(px: number, py: number, cx: number, cy: number, hw: number, hh: number): number {
  const dx = Math.abs(px - cx) - hw, dy = Math.abs(py - cy) - hh;
  const ox = Math.max(dx, 0), oy = Math.max(dy, 0);
  return hypot(ox, oy) + Math.min(Math.max(dx, dy), 0);
}

function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax, aby = by - ay;
  const L2 = abx * abx + aby * aby;
  const tt = L2 > 0 ? clamp(((px - ax) * abx + (py - ay) * aby) / L2, 0, 1) : 0;
  const ex = px - (ax + abx * tt), ey = py - (ay + aby * tt);
  return ex * ex + ey * ey;
}

// Triangle SDF: negative inside regardless of winding.
function sdTriangle(px: number, py: number, ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  const d0 = segDist2(px, py, ax, ay, bx, by);
  const d1 = segDist2(px, py, bx, by, cx, cy);
  const d2 = segDist2(px, py, cx, cy, ax, ay);
  const un = Math.sqrt(Math.min(d0, Math.min(d1, d2)));
  const c0 = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  const c1 = (cx - bx) * (py - by) - (cy - by) * (px - bx);
  const c2 = (ax - cx) * (py - cy) - (ay - cy) * (px - cx);
  const inside = (c0 >= 0 && c1 >= 0 && c2 >= 0) || (c0 <= 0 && c1 <= 0 && c2 <= 0);
  return inside ? -un : un;
}

// ---------------------------------------------------------------------------
// Scene construction
// ---------------------------------------------------------------------------

// 1. Sky + sun glow ----------------------------------------------------------
function skyColor(x: number, y: number): number[] {
  // vertical gradient stops
  const stops: Array<[number, number[]]> = [
    [0, [7, 11, 30]],
    [360, [42, 35, 82]],
    [800, [148, 84, 80]],
    [880, [231, 154, 99]],
  ];
  let col: number[] = stops[0][1];
  for (let i = 0; i < stops.length - 1; i++) {
    const [y0, c0] = stops[i], [y1, c1] = stops[i + 1];
    if (y <= y1) { col = lerp3(c0, c1, (y - y0) / (y1 - y0)); break; }
    if (i === stops.length - 2) col = c1;
  }
  // warm last-sun glow, low and slightly right of centre
  const gx = 640, gy = 690, gr = 420;
  const d = hypot(x - gx, y - gy) / gr;
  const ga = Math.pow(1 - clamp(d, 0, 1), 2.6);
  col = lerp3(col, [255, 156, 82], ga * 0.92);
  return col;
}

// 2. Hills (drawn later, but define height functions) -------------------------
const HORIZON = 815;
function farTop(x: number): number {
  return 800 + 16 * Math.sin(x * 0.0045) + 11 * Math.sin(x * 0.0016 + 1.3) + 6 * Math.sin(x * 0.011 + 0.6);
}
function nearTop(x: number): number {
  return 858 + 24 * Math.sin(x * 0.0038 + 2.0) + 17 * Math.sin(x * 0.015 + 0.4);
}

// Hill rendering helper
function paintHill(weight: 'far' | 'near'): void {
  const top = weight === 'far' ? farTop : nearTop;
  const base: number[] = weight === 'far' ? [43, 35, 80] : [16, 12, 31];
  paintShape(-10, 620, W + 10, H + 10,
    // sdf negative inside the hill (below its top silhouette)
    (x, y) => top(x) - y,
    (x, y, d) => {
      // warm light catching the crest: distance below the top is -d
      const depth = Math.max(0, -d);
      const rim = weight === 'far'
        ? Math.exp(-depth / 26) * 0.55
        : Math.exp(-depth / 34) * 0.16;
      return lerp3(base, [235, 178, 128], clamp(rim, 0, 1));
    });
}

// 3. Procedure: paint everything -------------------------------------------
function render(): void {
  // sky
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) setPix(x, y, skyColor(x, y));
  }

  // stars (upper sky, seeded, fading toward horizon)
  const rng = mulberry32(0x9E3779B9);
  const stars: Array<[number, number, number, number[]]> = [];
  for (let i = 0; i < 190; i++) {
    const x = rng() * W;
    const y = 15 + Math.pow(rng(), 0.8) * 650;
    const r = 0.5 + rng() * rng() * 1.6;
    const pick = rng();
    const col = pick < 0.7 ? [255, 255, 255] : pick < 0.85 ? [200, 215, 255] : [255, 218, 200];
    stars.push([x, y, r, col]);
  }
  // sort by y so lower stars render on top (irrelevant, but deterministic)
  stars.sort((a, b) => a[1] - b[1]);
  for (const [sx, sy, r, col] of stars) {
    const fade = clamp(1 - sy / 760, 0, 1);
    glowShape(sx, sy, r * 3.2, r * 3.2, col, 0.9 * fade, 2.2);
  }

  // sun glow (behind hills) already baked into sky; reinforce a broad warm pool
  glowShape(600, 760, 480, 190, [255, 156, 82], 0.35, 2.8);

  // hills
  paintHill('far');
  paintHill('near');

  // cottage on the near ridge -------------------------------------------------
  const cb = nearTop(798); // base y of the cottage (bottom of walls)
  const cxm = 798;
  const wallTop = cb - 76;
  const wL = cxm - 60, wR = cxm + 60;
  const dark: number[] = [12, 9, 24];

  // walls
  paintShape(wL - 2, wallTop - 2, wR + 2, cb + 2,
    (x, y) => sdBox(x, y, cxm, wallTop + 38, 60, 38),
    () => dark);

  // gable roof (solid filled triangle), overhangs walls a touch
  const roofTip = wallTop - 52;
  paintShape(wL - 16, roofTip - 4, wR + 16, wallTop + 2,
    (x, y) => sdTriangle(x, y, wL - 14, wallTop, wR + 14, wallTop, cxm, roofTip),
    () => [18, 14, 32]);

  // window
  const winCx = cxm + 8, winCy = wallTop + 37; // centre of window
  const whw = 16, whh = 19;
  paintShape(winCx - whw, winCy - whh, winCx + whw, winCy + whh,
    (x, y) => sdBox(x, y, winCx, winCy, whw, whh),
    (x, y) => lerp3([255, 190, 92], [255, 251, 230], (y - (winCy - whh)) / (2 * whh)));

  // two thin vertical mullions + one horizontal
  const mullCol: number[] = dark;
  for (const mx of [winCx - 11, winCx + 5]) {
    paintShape(mx - 1.2, winCy - whh, mx + 1.2, winCy + whh,
      (x, y) => sdBox(x, y, mx, winCy, 1.2, whh), () => mullCol);
  }
  paintShape(winCx - whw, winCy - 1.2, winCx + whw, winCy + 1.2,
    (x, y) => sdBox(x, y, winCx, winCy, whw, 1.2), () => mullCol);

  // warm glow pooling on the grass below
  glowShape(winCx, cb + 34, 170, 62, [255, 178, 96], 0.5, 2.2);

  // whale ----------------------------------------------------------------------
  // WS scales the whole whale up so it dominates the frame (R1); WX/WY recentre it
  // so the empty upper-right sky is filled rather than a vacant quarter.
  const WX = 600, WY = 405, WS = 1.4, WA = 0.12; // ~7 deg tilt, head down toward cottage
  function localize(wx: number, wy: number): [number, number] {
    const dx = wx - WX, dy = wy - WY;
    const ca = Math.cos(WA), sa = Math.sin(WA);
    const lx = dx * ca + dy * sa, ly = -dx * sa + dy * ca;
    return [lx / WS, ly / WS];
  }
  function toWorld(lx: number, ly: number): [number, number] {
    const ca = Math.cos(WA), sa = Math.sin(WA);
    const rx = lx * WS, ry = ly * WS;
    return [WX + (rx * ca - ry * sa), WY + (rx * sa + ry * ca)];
  }

  function whaleSDF(x: number, y: number): number {
    const [lx, ly] = localize(x, y);
    let d = Infinity;
    // body (long) + fuller head
    d = Math.min(d, ellipseDist(lx, ly, 0, 8, 150, 54, 0));
    d = Math.min(d, ellipseDist(lx, ly, 90, 22, 58, 52, 0.03));
    // tail base narrowing cleanly out of the body, then a thick peduncle
    d = Math.min(d, ellipseDist(lx, ly, -110, -2, 95, 38, 0));
    d = Math.min(d, ellipseDist(lx, ly, -205, -1, 80, 20, 0));
    // fluke: a broad swept blade with a pointed tip, flaring well behind the body
    // so the tail reads unmistakably as a whale's at small scale (R3)
    d = Math.min(d, ellipseDist(lx, ly, -250, -36, 60, 36, 0.4));
    d = Math.min(d, sdTriangle(lx, ly, -215, 6, -215, -78, -440, -140));
    // dorsal fin: small, low on the hind back, swept back toward the tail
    d = Math.min(d, ellipseDist(lx, ly, -70, -44, 15, 16, -0.7));
    // pectoral fin: long, thick, angled down-right so its solid tip reaches the lantern
    // and the cord visibly leaves the whale's silhouette
    d = Math.min(d, ellipseDist(lx, ly, 50, 40, 19, 74, -0.6));
    return d;
  }

  function whaleShade(x: number, y: number, d: number): number[] {
    const [lx, ly] = localize(x, y);
    const n = clamp(ly / 58, -1, 1);
    let col = lerp3([149, 170, 230], [78, 91, 147], (n + 1) / 2); // periwinkle top -> deeper below
    // pale belly
    col = lerp3(col, [207, 218, 248], smoothstep(0.1, 0.7, n) * 0.75);
    // warm rim light on the lower-right side facing the lantern
    const lowerR = smoothstep(0, 55, ly) * smoothstep(-40, 80, lx);
    const edgeNear = Math.exp(-Math.max(0, -d) / 18);
    col = lerp3(col, [255, 194, 130], lowerR * edgeNear * 0.6);
    return col;
  }

  paintShape(140, 290, 850, 640, whaleSDF, (x, y, d) => whaleShade(x, y, d));

  // eye: big, set low on the head below its midline so the forehead stays high (R2),
  // with a large dark pupil and one bright catchlight
  {
    const [ex, ey] = toWorld(98, 30);
    const eyeX = ex, eyeY = ey, eyeR = 5.0 * WS; // world radius -> diameter ~9-10% of head height
    paintShape(eyeX - eyeR - 2, eyeY - eyeR - 2, eyeX + eyeR + 2, eyeY + eyeR + 2,
      (x, y) => hypot(x + 0.5 - eyeX, y + 0.5 - eyeY) - eyeR, () => [14, 11, 26]);
    // single bright white catchlight, placed high toward the sky side of the pupil
    paintShape(eyeX - eyeR * 0.7, eyeY - eyeR * 0.8, eyeX + eyeR * 0.5, eyeY + eyeR * 0.3,
      (x, y) => hypot(x + 0.5 - (eyeX - eyeR * 0.15), y + 0.5 - (eyeY - eyeR * 0.25)) - eyeR * 0.4,
      () => [255, 252, 255]);
  }

  // gentle curved mouth line (thin quadratic-bezier stroke), scaled with the whale
  {
    const P0: [number, number] = [90, 40], P1: [number, number] = [116, 52], P2: [number, number] = [138, 40];
    const segs: Array<[number, number, number, number]> = [];
    for (let i = 0; i < 24; i++) {
      const t0 = i / 24, t1 = (i + 1) / 24;
      const bz = (t: number): [number, number] => [
        (1 - t) * (1 - t) * P0[0] + 2 * (1 - t) * t * P1[0] + t * t * P2[0],
        (1 - t) * (1 - t) * P0[1] + 2 * (1 - t) * t * P1[1] + t * t * P2[1],
      ];
      const a = bz(t0), b = bz(t1);
      const wa = toWorld(a[0], a[1]);
      const wb = toWorld(b[0], b[1]);
      segs.push([wa[0], wa[1], wb[0], wb[1]]);
    }
    paintShape(700, 458, 805, 505,
      (x, y) => {
        let best = Infinity;
        for (const s of segs) best = Math.min(best, segDist2(x, y, s[0], s[1], s[2], s[3]));
        return Math.sqrt(best) - 1.5;
      },
      () => [30, 26, 48]);
  }

  // lantern cord + lantern -----------------------------------------------------
  const lanX = 707, lanY = 602, lanR = 22;
  // cord starts inside the pectoral fin's scaled solid tip (so it visibly leaves the whale),
  // then drops to the top of the lantern
  let cordA: [number, number] = [504, 468];
  {
    const fl = toWorld(50 + 74 * Math.sin(0.6), 40 + 74 * Math.cos(0.6));
    cordA = [fl[0], fl[1] - 6];
  }
  const cordB: [number, number] = [lanX, lanY - lanR + 4];

  // big warm halo of the lantern lighting the whale's underside + hills.
  // Drawn BEFORE the cord so the cord stays visible on top of the glow.
  glowShape(lanX, lanY + 40, 230, 150, [255, 176, 104], 0.65, 2.0);

  // lantern body: warm paper, bright core
  paintShape(lanX - lanR - 2, lanY - lanR - 2, lanX + lanR + 2, lanY + lanR + 2,
    (x, y) => hypot(x + 0.5 - lanX, y + 0.5 - lanY) - lanR,
    (x, y) => {
      const t = clamp(hypot(x - lanX, y - lanY) / lanR, 0, 1);
      return lerp3([255, 251, 232], [255, 176, 79], Math.pow(t, 1.4));
    });

  // lantern cap + glow hotspot
  paintShape(lanX - 8, lanY - lanR - 7, lanX + 8, lanY - lanR + 2,
    (x, y) => sdBox(x, y, lanX, lanY - lanR - 2, 8, 5), () => [120, 66, 44]);
  glowShape(lanX, lanY - 4, lanR * 2.4, lanR * 2.2, [255, 224, 170], 0.5, 2.0);

  // cord: drawn last (on top of halo and lantern glow) so it stays a crisp dark
  // line from inside the fin's body, down to the top of the lantern
  {
    const sdf = (x: number, y: number): number =>
      Math.sqrt(segDist2(x, y, cordA[0], cordA[1], cordB[0], cordB[1])) - 1.5;
    paintShape(cordA[0] - 4, cordA[1] - 3, cordB[0] + 4, cordB[1] + 3, sdf, () => [44, 40, 62]);
  }

  // vignette: darken the corners, keep the eye on the lantern ------------------
  const vxC = 690, vyC = 590, vR = 800;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = hypot(x - vxC, y - vyC) / vR;
      const f = 1 - 0.22 * smoothstep(0.4, 1.15, d);
      const i = (y * W + x) * 3;
      img[i] = img[i] * f; img[i + 1] = img[i + 1] * f; img[i + 2] = img[i + 2] * f;
    }
  }
}

// ---------------------------------------------------------------------------
// PNG writer (RGB, color type 2)
// ---------------------------------------------------------------------------
let CRC_TABLE: Int32Array | null = null;
function makeCrcTable(): Int32Array {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xEDB88320 ^ (c >>> 1)) : c >>> 1;
    t[n] = c;
  }
  return t;
}
function crc32(buf: Buffer | Uint8Array, start: number, len: number): number {
  if (!CRC_TABLE) CRC_TABLE = makeCrcTable();
  let c = -1;
  for (let i = 0; i < len; i++) c = (CRC_TABLE[(c ^ buf[start + i]) & 0xff] ^ (c >>> 8)) | 0;
  return (c ^ -1) >>> 0;
}
function chunk(type: string, data: Buffer | Uint8Array | null): Buffer {
  const len = data ? data.length : 0;
  const buf = Buffer.alloc(8 + len + 4);
  buf.writeUInt32BE(len, 0);
  buf.write(type, 4, 'ascii');
  if (data) Buffer.from(data).copy(buf, 8);
  const crc = crc32(buf, 4, 4 + len);
  buf.writeUInt32BE(crc, 8 + len);
  return buf;
}
function buildPNG(): Buffer {
  const stride = W * 3;
  const raw = Buffer.alloc(H * (1 + stride));
  for (let y = 0; y < H; y++) {
    const ro = y * (1 + stride);
    raw[ro] = 0; // filter: none
    for (let x = 0; x < stride; x++) raw[ro + 1 + x] = img[y * stride + x];
  }
  const idat = deflateSync(raw, { level: 6 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // colour type: RGB
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', null)]);
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------
render();
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const png = buildPNG();
writeFileSync(join(outDir, 'entry.png'), png);
const sha = createHash('sha256').update(png).digest('hex');
console.log(`wrote ${png.length} bytes -> ${join(outDir, 'entry.png')}`);
console.log(`sha256=${sha}`);