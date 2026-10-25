/* 读取用户提供的像素鱼 PNG，检测像素块大小、裁切、并输出到 build/fish-sprite.png
 * 用法：node tools/extract-sprite.js <源 png>
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG');
  let off = 8;
  let w = 0, h = 0, depth = 0, colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      depth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (depth !== 8) throw new Error('只支持 8bit');
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(w * h * 4);
  const prev = Buffer.alloc(stride);
  const cur = Buffer.alloc(stride);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[pos++];
    raw.copy(cur, 0, pos, pos + stride);
    pos += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = cur[i];
      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + b) & 0xff;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
      cur[i] = v;
    }
    for (let x = 0; x < w; x++) {
      const s = x * bpp;
      const d = (y * w + x) * 4;
      if (bpp >= 3) {
        out[d] = cur[s];
        out[d + 1] = cur[s + 1];
        out[d + 2] = cur[s + 2];
        out[d + 3] = bpp === 4 ? cur[s + 3] : 255;
      } else {
        out[d] = out[d + 1] = out[d + 2] = cur[s];
        out[d + 3] = bpp === 2 ? cur[s + 1] : 255;
      }
    }
    cur.copy(prev);
  }
  return { w, h, rgba: out };
}

/** 找最大像素块（原图多半是整数倍放大的像素画） */
function detectScale(img) {
  for (let n = 16; n >= 2; n--) {
    if (img.w % n || img.h % n) continue;
    const bw = img.w / n;
    const bh = img.h / n;
    let ok = true;
    for (let by = 0; by < bh && ok; by++) {
      for (let bx = 0; bx < bw && ok; bx++) {
        const i0 = ((by * n) * img.w + bx * n) * 4;
        const r0 = img.rgba[i0], g0 = img.rgba[i0 + 1], b0 = img.rgba[i0 + 2], a0 = img.rgba[i0 + 3];
        for (let y = 0; y < n && ok; y++) {
          for (let x = 0; x < n; x++) {
            const i = (((by * n + y) * img.w) + (bx * n + x)) * 4;
            if (
              Math.abs(img.rgba[i] - r0) > 6 ||
              Math.abs(img.rgba[i + 1] - g0) > 6 ||
              Math.abs(img.rgba[i + 2] - b0) > 6 ||
              Math.abs(img.rgba[i + 3] - a0) > 6
            ) { ok = false; break; }
          }
        }
      }
    }
    if (ok) return { n, bw, bh };
  }
  return { n: 1, bw: img.w, bh: img.h };
}

const src = process.argv[2];
const buf = fs.readFileSync(src);
const img = decodePng(buf);
const { n, bw, bh } = detectScale(img);
console.log('image', img.w + 'x' + img.h, '→ 像素块倍数', n, '→ sprite', bw + 'x' + bh);

// 取每个块左上角，得到 sprite
const sprite = Buffer.alloc(bw * bh * 4);
for (let y = 0; y < bh; y++) {
  for (let x = 0; x < bw; x++) {
    const si = ((y * n) * img.w + x * n) * 4;
    const di = (y * bw + x) * 4;
    sprite[di] = img.rgba[si];
    sprite[di + 1] = img.rgba[si + 1];
    sprite[di + 2] = img.rgba[si + 2];
    sprite[di + 3] = img.rgba[si + 3];
  }
}

// 角点透明度与 bbox
console.log('corner alpha:', [0, bw - 1].map((x) => [0, bh - 1].map((y) => sprite[(y * bw + x) * 4 + 3])));
let minX = bw, minY = bh, maxX = -1, maxY = -1;
for (let y = 0; y < bh; y++) {
  for (let x = 0; x < bw; x++) {
    if (sprite[(y * bw + x) * 4 + 3] > 8) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
}
console.log('bbox:', { minX, minY, maxX, maxY, w: maxX - minX + 1, h: maxY - minY + 1 });

// 裁切后的 sprite
const cw = maxX - minX + 1;
const ch = maxY - minY + 1;
const cropped = Buffer.alloc(cw * ch * 4);
for (let y = 0; y < ch; y++) sprite.copy(cropped, y * cw * 4, ((minY + y) * bw + minX) * 4, ((minY + y) * bw + minX + cw) * 4);

// 简单 PNG 编码（RGBA）
function pngEncode(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const table = (() => {
    const t = new Int32Array(256);
    for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[i] = c; }
    return t;
  })();
  const crc32 = (b) => { let c = -1; for (let i = 0; i < b.length; i++) c = table[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, '..', 'build');
fs.writeFileSync(path.join(outDir, 'fish-sprite.png'), pngEncode(cw, ch, cropped));
console.log('sprite saved:', path.join(outDir, 'fish-sprite.png'), cw + 'x' + ch);
