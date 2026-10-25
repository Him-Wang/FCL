/* 生成启动器图标 build/icon.ico + build/icon-preview*.png
 *
 * 设计：深蓝圆角渐变底板（DeepSeek 蓝）+ 一条极简胖鱼（FMCL 吉祥物，朝右游）。
 *       鱼鳍用 WorkBuddy 青绿做点色，圆形气泡呼应 Minecraft 的水泡/方块感。
 * 做法：程序化绘制 + 4× 超采样抗锯齿，按 ICO 规范打包 16/32/48/64/128/256。
 * 重新生成：node tools/gen-icon.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ---------------- 调色 ---------------- */
const TILE_TOP = [104, 132, 255];
const TILE_BOT = [36, 54, 192];
const FISH_TOP = [255, 255, 255];
const FISH_BOT = [201, 216, 255];
const TAIL_TOP = [222, 231, 255];
const TAIL_BOT = [178, 197, 255];
const FIN_A = [46, 222, 180];
const FIN_B = [0, 165, 136];
const EYE = [21, 31, 72];

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (t) => Math.max(0, Math.min(1, t));

/* ---------------- 几何 ---------------- */
function inRoundRect(x, y, r, w, h) {
  const cx = Math.min(Math.max(x, r), w - r);
  const cy = Math.min(Math.max(y, r), h - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function inEllipse(x, y, cx, cy, rx, ry) {
  return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
}

/** 凹多边形（鱼尾的缺口） */
function inPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/* ---------------- 造型（鱼头朝右） ---------------- */
const BODY = { cx: 0.470, cy: 0.512, rx: 0.262, ry: 0.157 };
// 尾巴在左侧，右侧缺口形成分叉
const TAIL = [
  [0.232, 0.512],
  [0.068, 0.372],
  [0.112, 0.512],
  [0.068, 0.652],
];
// 背鳍：斜向后（朝左）的小三角
const FIN = [
  [0.348, 0.382],
  [0.392, 0.298],
  [0.474, 0.372],
];
const EYE_P = { x: 0.598, y: 0.470, r: 0.0305 };
const MOUTH = { x: 0.722, y: 0.532, rx: 0.030, ry: 0.017 };
const BUBBLES = [
  { x: 0.792, y: 0.318, r: 0.0235 },
  { x: 0.856, y: 0.392, r: 0.0145 },
];

/** 在单位坐标（0..1）上取色 */
function shade(u, v) {
  const pad = 0.045;
  const x = u;
  const y = v;
  const inBox =
    x >= pad && x <= 1 - pad && y >= pad && y <= 1 - pad && inRoundRect(x - pad, y - pad, 0.255, 1 - pad * 2, 1 - pad * 2);
  if (!inBox) return [0, 0, 0, 0];

  // 底板：竖向渐变 + 左上柔光 + 边缘内高光
  const base = mix(TILE_TOP, TILE_BOT, clamp01((y - pad) / (1 - 2 * pad)));
  const glow = Math.max(0, 1 - Math.hypot(x - 0.26, y - 0.15) / 0.72);
  let bg = mix(base, [255, 255, 255], glow * 0.24);
  const edge = Math.min(x - pad, 1 - pad - x, y - pad, 1 - pad - y);
  if (edge < 0.011) bg = mix(bg, [255, 255, 255], 0.13 * (1 - edge / 0.011));

  // 鱼身下的柔和落影
  if (inEllipse(x, y, 0.470, 0.712, 0.240, 0.038)) bg = mix(bg, [12, 20, 64], 0.13);

  const body = inEllipse(x, y, BODY.cx, BODY.cy, BODY.rx, BODY.ry);
  const tail = inPolygon(x, y, TAIL);
  const fin = inPolygon(x, y, FIN);

  // 眼睛
  if (body && inEllipse(x, y, EYE_P.x, EYE_P.y, EYE_P.r, EYE_P.r)) {
    if (inEllipse(x, y, EYE_P.x - 0.010, EYE_P.y - 0.011, 0.0095, 0.0095)) return [255, 255, 255, 255];
    return [EYE[0], EYE[1], EYE[2], 255];
  }

  // 嘴：在嘴角轻轻挖一个小口
  if (body && inEllipse(x, y, MOUTH.x, MOUTH.y, MOUTH.rx, MOUTH.ry)) return [bg[0], bg[1], bg[2], 255];

  // 气泡
  for (const b of BUBBLES) {
    if (inEllipse(x, y, b.x, b.y, b.r, b.r)) {
      const t = clamp01((y - b.y + b.r) / (b.r * 2));
      const c = mix(FIN_A, FIN_B, t);
      return [c[0], c[1], c[2], 255];
    }
  }

  // 背鳍
  if (fin) {
    const t = clamp01((y - 0.298) / 0.084);
    const c = mix(FIN_A, FIN_B, t);
    return [c[0], c[1], c[2], 255];
  }

  // 尾巴
  if (tail) {
    const t = clamp01((y - 0.372) / 0.28);
    const c = mix(TAIL_TOP, TAIL_BOT, t);
    return [c[0], c[1], c[2], 255];
  }

  if (body) {
    // 上白下浅蓝的柔和渐变（用更干净的径向高光，不再有灰扑扑的整块压暗）
    const t = clamp01((y - (BODY.cy - BODY.ry)) / (BODY.ry * 2));
    let c = mix(FISH_TOP, FISH_BOT, Math.pow(t, 1.25) * 0.85);
    const hi = Math.max(0, 1 - Math.hypot((x - (BODY.cx - 0.06)) / 0.20, (y - (BODY.cy - 0.06)) / 0.13));
    c = mix(c, [255, 255, 255], Math.min(0.55, hi * 0.75));
    // 下缘一条极细的蓝边，让轮廓干净
    const inner = inEllipse(x, y, BODY.cx, BODY.cy, BODY.rx * 0.955, BODY.ry * 0.93);
    if (!inner && y > BODY.cy) c = mix(c, [156, 180, 244], 0.55);
    // 鳃线
    const gill = Math.abs(Math.hypot(x - 0.560, y - 0.512) - 0.082) < 0.0048 && x > 0.560 && Math.abs(y - 0.512) < 0.13;
    if (gill) c = mix(c, [172, 195, 250], 0.7);
    return [c[0], c[1], c[2], 255];
  }

  return [bg[0], bg[1], bg[2], 255];
}

/** 渲染 size×size RGBA（4× 超采样） */
function render(size) {
  const SS = 4;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = shade((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
          r += c[0] * c[3];
          g += c[1] * c[3];
          b += c[2] * c[3];
          a += c[3];
        }
      }
      const n = SS * SS;
      const o = (y * size + x) * 4;
      const alpha = a / n;
      buf[o] = alpha > 0 ? Math.round(r / a) : 0;
      buf[o + 1] = alpha > 0 ? Math.round(g / a) : 0;
      buf[o + 2] = alpha > 0 ? Math.round(b / a) : 0;
      buf[o + 3] = Math.round(alpha);
    }
  }
  return buf;
}

/* ---------------- 输出 ---------------- */
function pngEncode(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const table = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })();
  const crc32 = (buf) => {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function dibEncode(size, rgba) {
  const rowSize = size * 4;
  const maskRow = ((size + 31) >> 5) * 4;
  const dib = Buffer.alloc(40 + rowSize * size + maskRow * size);
  dib.writeUInt32LE(40, 0);
  dib.writeInt32LE(size, 4);
  dib.writeInt32LE(size * 2, 8);
  dib.writeUInt16LE(1, 12);
  dib.writeUInt16LE(32, 14);
  dib.writeUInt32LE(0, 16);
  dib.writeUInt32LE(rowSize * size, 20);
  for (let y = 0; y < size; y++) {
    const srcY = size - 1 - y;
    for (let x = 0; x < size; x++) {
      const s = (srcY * size + x) * 4;
      const o = 40 + y * rowSize + x * 4;
      dib[o] = rgba[s + 2];
      dib[o + 1] = rgba[s + 1];
      dib[o + 2] = rgba[s];
      dib[o + 3] = rgba[s + 3];
      if (rgba[s + 3] < 8) {
        const mo = 40 + rowSize * size + y * maskRow + (x >> 3);
        dib[mo] |= 0x80 >> (x & 7);
      }
    }
  }
  return dib;
}

const SIZES = [16, 32, 48, 64, 128, 256];
const build = path.join(__dirname, '..', 'build');
fs.mkdirSync(build, { recursive: true });

const images = SIZES.map((s) => ({ size: s, rgba: render(s) }));
const dibs = images.map((i) => dibEncode(i.size, i.rgba));

const head = Buffer.alloc(6);
head.writeUInt16LE(0, 0);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(SIZES.length, 4);

let offset = 6 + 16 * SIZES.length;
const dirs = SIZES.map((s, i) => {
  const d = Buffer.alloc(16);
  d[0] = s === 256 ? 0 : s;
  d[1] = s === 256 ? 0 : s;
  d.writeUInt16LE(1, 4);
  d.writeUInt16LE(32, 6);
  d.writeUInt32LE(dibs[i].length, 8);
  d.writeUInt32LE(offset, 12);
  offset += dibs[i].length;
  return d;
});

const icoPath = path.join(build, 'icon.ico');
fs.writeFileSync(icoPath, Buffer.concat([head, ...dirs, ...dibs]));

const big = images[images.length - 1];
fs.writeFileSync(path.join(build, 'icon-preview.png'), pngEncode(big.size, big.rgba));
for (const s of [16, 32, 48]) {
  const img = images.find((i) => i.size === s);
  if (img) fs.writeFileSync(path.join(build, `icon-preview-${s}.png`), pngEncode(s, img.rgba));
}

console.log('icon ->', icoPath, fs.statSync(icoPath).size, 'bytes, sizes:', SIZES.join('/'));
