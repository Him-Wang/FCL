/* 用用户提供的像素鱼生成应用图标（build/icon.ico + 预览 + 界面用 SVG symbol）
 *
 * 流程：解码 PNG → 按 alpha 裁切 → 圆角渐变底板（可换配色）→ 柔和落影 → 高质量缩放贴图
 * 用法：node tools/make-icon.js [teal|mint|slate]
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ---------------- PNG 解码 / 编码 ---------------- */
function decodePng(buf) {
  let off = 8, w = 0, h = 0, ct = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : 1;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(w * h * 4);
  const prev = Buffer.alloc(stride), cur = Buffer.alloc(stride);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[pos++];
    raw.copy(cur, 0, pos, pos + stride); pos += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = cur[i];
      if (f === 1) v = (v + a) & 255; else if (f === 2) v = (v + b) & 255;
      else if (f === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255; }
      cur[i] = v;
    }
    for (let x = 0; x < w; x++) {
      const s = x * bpp, d = (y * w + x) * 4;
      out[d] = cur[s]; out[d + 1] = cur[s + 1]; out[d + 2] = cur[s + 2];
      out[d + 3] = bpp === 4 ? cur[s + 3] : 255;
    }
    cur.copy(prev);
  }
  return { w, h, rgba: out };
}

function pngEncode(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const t = (() => { const a = new Int32Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; a[i] = c; } return a; })();
  const crc = (b) => { let c = -1; for (let i = 0; i < b.length; i++) c = t[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------- 配色方案 ---------------- */
const THEMES = {
  teal: { top: [30, 82, 80], bot: [8, 34, 38], glow: [90, 190, 170], rim: [170, 235, 215] },   // 深青绿
  mint: { top: [252, 254, 253], bot: [176, 214, 201], glow: [255, 255, 255], rim: [255, 255, 255] }, // 浅薄荷（默认）
  slate: { top: [64, 88, 108], bot: [24, 38, 50], glow: [140, 190, 220], rim: [200, 225, 245] },  // 深板岩蓝
};
const themeName = process.argv[2] && THEMES[process.argv[2]] ? process.argv[2] : 'mint';
const T = THEMES[themeName];
const DARK = themeName !== 'mint';

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (t) => Math.max(0, Math.min(1, t));

/* ---------------- 读入并裁切鱼 ---------------- */
const build = path.join(__dirname, '..', 'build');
const spritePath = path.join(build, 'fish-sprite.png');
const sprite = decodePng(fs.readFileSync(spritePath));

let minX = sprite.w, minY = sprite.h, maxX = -1, maxY = -1;
for (let y = 0; y < sprite.h; y++) {
  for (let x = 0; x < sprite.w; x++) {
    if (sprite.rgba[(y * sprite.w + x) * 4 + 3] > 128) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
}
const cw = maxX - minX + 1;
const ch = maxY - minY + 1;
const fish = Buffer.alloc(cw * ch * 4);
for (let y = 0; y < ch; y++) {
  sprite.rgba.copy(fish, y * cw * 4, ((minY + y) * sprite.w + minX) * 4, ((minY + y) * sprite.w + minX + cw) * 4);
}
console.log('主题', themeName, '| 裁切后鱼尺寸', cw + 'x' + ch);

/** 双线性采样（预乘 alpha，避免边缘发灰） */
function sample(w, h, data, fx, fy) {
  if (fx < 0 || fy < 0 || fx >= w - 1 || fy >= h - 1) {
    const x = Math.max(0, Math.min(w - 1, Math.round(fx)));
    const y = Math.max(0, Math.min(h - 1, Math.round(fy)));
    const i = (y * w + x) * 4;
    const a = data[i + 3] / 255;
    return [data[i] * a, data[i + 1] * a, data[i + 2] * a, a];
  }
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const dx = fx - x0, dy = fy - y0;
  const idx = (xx, yy) => (yy * w + xx) * 4;
  const get = (xx, yy) => { const i = idx(xx, yy); const a = data[i + 3] / 255; return [data[i] * a, data[i + 1] * a, data[i + 2] * a, a]; };
  const c00 = get(x0, y0), c10 = get(x0 + 1, y0), c01 = get(x0, y0 + 1), c11 = get(x0 + 1, y0 + 1);
  const out = [0, 0, 0, 0];
  for (let k = 0; k < 4; k++) {
    const top = c00[k] * (1 - dx) + c10[k] * dx;
    const bot = c01[k] * (1 - dx) + c11[k] * dx;
    out[k] = top * (1 - dy) + bot * dy;
  }
  return out;
}

/** 画一个 size 的图标（RGBA） */
function render(size) {
  const buf = Buffer.alloc(size * size * 4);
  const pad = size * 0.045;
  const radius = size * 0.255;

  // 鱼在底板里的占比与位置
  const fit = size * 0.70;
  const scale = Math.min(fit / cw, fit / ch);
  const dw = cw * scale;
  const dh = ch * scale;
  const dx = (size - dw) / 2;
  const dy = (size - dh) / 2 - size * 0.008;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = px + 0.5;
      const y = py + 0.5;

      // 圆角底板（3× 超采样只为了圆角边缘）
      let inside = 0;
      for (let sy = 0; sy < 3; sy++) {
        for (let sx = 0; sx < 3; sx++) {
          const ux = px + (sx + 0.5) / 3;
          const uy = py + (sy + 0.5) / 3;
          const cx = Math.min(Math.max(ux, pad + radius), size - pad - radius);
          const cy = Math.min(Math.max(uy, pad + radius), size - pad - radius);
          const inRect = ux >= pad && ux <= size - pad && uy >= pad && uy <= size - pad;
          if (inRect && (ux - cx) ** 2 + (uy - cy) ** 2 <= radius * radius) inside++;
        }
      }
      if (!inside) continue;
      const alphaCover = inside / 9;

      // 渐变 + 左上柔光
      const t = clamp01((y - pad) / (size - 2 * pad));
      let c = mix(T.top, T.bot, Math.pow(t, 1.15));
      const glow = Math.max(0, 1 - Math.hypot(x - size * 0.28, y - size * 0.2) / (size * 0.75));
      c = mix(c, T.glow, glow * (DARK ? 0.18 : 0.55));
      // 内高光
      const edge = Math.min(x - pad, size - pad - x, y - pad, size - pad - y);
      if (edge < size * 0.012) c = mix(c, T.rim, 0.22 * (1 - edge / (size * 0.012)));

      // 鱼身后方一团柔光，让主体和底板分离（不再画硬边阴影）
      const bgx = (x - (dx + dw / 2)) / (dw * 0.62);
      const bgy = (y - (dy + dh / 2)) / (dh * 0.62);
      const halo = Math.max(0, 1 - Math.hypot(bgx, bgy));
      if (halo > 0) c = mix(c, DARK ? [255, 255, 255] : [255, 255, 255], halo * (DARK ? 0.12 : 0.45));

      // 贴鱼
      const fx = (x - dx) / scale;
      const fy = (y - dy) / scale;
      if (fx >= 0 && fy >= 0 && fx < cw - 1 && fy < ch - 1) {
        const s = sample(cw, ch, fish, fx, fy);
        const a = s[3];
        if (a > 0) {
          const inv = 1 / Math.max(a, 1e-6);
          c = [c[0] * (1 - a) + s[0] * inv * a, c[1] * (1 - a) + s[1] * inv * a, c[2] * (1 - a) + s[2] * inv * a];
        }
      }

      const o = (py * size + px) * 4;
      buf[o] = Math.round(c[0]);
      buf[o + 1] = Math.round(c[1]);
      buf[o + 2] = Math.round(c[2]);
      buf[o + 3] = Math.round(alphaCover * 255);
    }
  }
  return buf;
}

/* ---------------- ICO ---------------- */
function dibEncode(size, rgba) {
  const rowSize = size * 4;
  const maskRow = ((size + 31) >> 5) * 4;
  const dib = Buffer.alloc(40 + rowSize * size + maskRow * size);
  dib.writeUInt32LE(40, 0);
  dib.writeInt32LE(size, 4);
  dib.writeInt32LE(size * 2, 8);
  dib.writeUInt16LE(1, 12);
  dib.writeUInt16LE(32, 14);
  dib.writeUInt32LE(rowSize * size, 20);
  for (let y = 0; y < size; y++) {
    const sy = size - 1 - y;
    for (let x = 0; x < size; x++) {
      const s = (sy * size + x) * 4;
      const o = 40 + y * rowSize + x * 4;
      dib[o] = rgba[s + 2];
      dib[o + 1] = rgba[s + 1];
      dib[o + 2] = rgba[s];
      dib[o + 3] = rgba[s + 3];
      if (rgba[s + 3] < 8) dib[40 + rowSize * size + y * maskRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return dib;
}

const SIZES = [16, 32, 48, 64, 128, 256];
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

fs.writeFileSync(path.join(build, 'icon.ico'), Buffer.concat([head, ...dirs, ...dibs]));
const big = images.find((i) => i.size === 256);
fs.writeFileSync(path.join(build, 'icon-preview.png'), pngEncode(256, 256, big.rgba));
for (const s of [16, 32, 48, 64]) {
  const img = images.find((i) => i.size === s);
  fs.writeFileSync(path.join(build, `icon-preview-${s}.png`), pngEncode(s, s, img.rgba));
}

/* ---------------- 界面里的 SVG symbol（内嵌 64px PNG） ---------------- */
const svg64 = images.find((i) => i.size === 64);
const b64 = pngEncode(64, 64, svg64.rgba).toString('base64');
const symbol =
  `<symbol id="i-fish" viewBox="0 0 64 64">` +
  `<image width="64" height="64" href="data:image/png;base64,${b64}"/>` +
  `</symbol>`;
fs.writeFileSync(path.join(build, 'fish-symbol.svg'), symbol + '\n', 'utf8');

console.log('icon ->', path.join(build, 'icon.ico'), fs.statSync(path.join(build, 'icon.ico')).size, 'bytes');
console.log('preview ->', path.join(build, 'icon-preview.png'));
