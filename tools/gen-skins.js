/* 生成几套内置经典皮肤（64×64 PNG），输出到 assets/skins/
 * 采用标准皮肤 UV 布局，保证游戏内和启动器 2D 预览都正确。
 * 运行：node tools/gen-skins.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ---------- 64×64 画布 ---------- */
function canvas(w, h) {
  const px = Buffer.alloc(w * h * 4);
  const set = (x, y, c) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4;
    px[i] = c[0];
    px[i + 1] = c[1];
    px[i + 2] = c[2];
    px[i + 3] = c.length > 3 ? c[3] : 255;
  };
  const rect = (x, y, rw, rh, c) => {
    for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) set(x + i, y + j, c);
  };
  return { px, set, rect, w, h };
}

const C = (hex) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const shade = (c, k) => [Math.round(c[0] * k), Math.round(c[1] * k), Math.round(c[2] * k)];

/* ---------- 皮肤各部件布局（标准 64×64） ---------- */
function paint(cv, part, colors) {
  const { base, alt } = colors || {};
  if (part === 'head') {
    cv.rect(0, 0, 32, 16, base); // 头顶/底/侧/前/后
    if (alt && alt.top) cv.rect(8, 0, 8, 8, alt.top);
  }
  if (part === 'body') cv.rect(16, 16, 24, 16, base);
  if (part === 'armR') cv.rect(40, 16, 16, 16, base);
  if (part === 'armL') cv.rect(32, 48, 16, 16, base);
  if (part === 'legR') cv.rect(0, 16, 16, 16, base);
  if (part === 'legL') cv.rect(16, 48, 16, 16, base);
}

function baseSkin(o) {
  const cv = canvas(64, 64);
  const skin = C(o.skin);
  const hair = C(o.hair);
  const shirt = C(o.shirt);
  const pants = C(o.pants);
  const shoe = C(o.shoe || '#3a3f47');

  // 头
  paint(cv, 'head', { base: skin });
  // 头发：顶、后、两侧 + 前额刘海
  cv.rect(8, 0, 8, 8, hair);
  cv.rect(0, 8, 8, 8, hair);
  cv.rect(24, 8, 8, 8, hair);
  cv.rect(8, 8, 8, 2, hair);
  cv.rect(8, 0, 8, 8, hair);
  // 脸（正面 8,8 ~ 16,16）
  cv.rect(8, 10, 8, 6, skin);
  if (o.hat) {
    const hat = C(o.hat);
    cv.rect(8, 8, 8, 2, hat);
    cv.rect(8, 0, 8, 8, hat);
    cv.rect(0, 8, 8, 8, hat);
    cv.rect(24, 8, 8, 8, hat);
  }
  // 眼睛
  const eye = C(o.eye || '#2b2b2b');
  cv.rect(10, 11, 1, 1, eye);
  cv.rect(13, 11, 1, 1, eye);
  // 嘴
  cv.rect(11, 14, 2, 1, shade(skin, 0.72));
  // 身体（含领口、腰带）
  paint(cv, 'body', { base: shirt });
  cv.rect(20, 20, 8, 2, shade(shirt, 0.86));
  cv.rect(20, 30, 8, 2, shade(pants, 1.05));
  // 手臂：袖子 + 手
  paint(cv, 'armR', { base: shirt });
  paint(cv, 'armL', { base: shirt });
  for (const [ax, ay] of [[44, 20], [36, 52]]) cv.rect(ax, ay + 8, 4, 4, skin);
  // 腿：裤子 + 鞋
  paint(cv, 'legR', { base: pants });
  paint(cv, 'legL', { base: pants });
  for (const [lx, ly] of [[4, 20], [20, 52]]) cv.rect(lx, ly + 9, 4, 3, shoe);
  return cv;
}

/* ---------- 六套皮肤 ---------- */
const SKINS = [
  {
    file: '01-steve-blue.png',
    spec: { skin: '#c69263', hair: '#3a2a1e', shirt: '#2e8fbd', pants: '#3b3f9e', shoe: '#4a4f57' },
  },
  {
    file: '02-alex-orange.png',
    spec: { skin: '#d7ab7e', hair: '#c8762f', shirt: '#5f9e4a', pants: '#8b6b4a', shoe: '#5b4a38' },
  },
  {
    file: '03-green-hoodie.png',
    spec: { skin: '#e0b48f', hair: '#4a3b2a', shirt: '#2e7d5b', pants: '#2f3440', shoe: '#20262e', hat: '#3fbf8f' },
  },
  {
    file: '04-red-hoodie.png',
    spec: { skin: '#f0c9a0', hair: '#2b2b2b', shirt: '#c0392b', pants: '#2b2f38', shoe: '#1f232a' },
  },
  {
    file: '05-gold-knight.png',
    spec: { skin: '#d9b08c', hair: '#8a6a2f', shirt: '#c9a227', pants: '#5a5347', shoe: '#3f3a33', hat: '#d4af37' },
  },
  {
    file: '06-fatfish.png',
    spec: { skin: '#f2f6ff', hair: '#00c29a', shirt: '#4d6bfe', pants: '#1f2440', shoe: '#141a2e', eye: '#1b2340' },
  },
];

/* ---------- PNG 编码 ---------- */
function pngEncode(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const table = (() => {
    const t = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c;
    }
    return t;
  })();
  const crc32 = (b) => {
    let c = -1;
    for (let i = 0; i < b.length; i++) c = table[(c ^ b[i]) & 0xff] ^ (c >>> 8);
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
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, '..', 'assets', 'skins');
fs.mkdirSync(outDir, { recursive: true });
for (const s of SKINS) {
  const cv = baseSkin(s.spec);
  const file = path.join(outDir, s.file);
  fs.writeFileSync(file, pngEncode(64, 64, cv.px));
  console.log('skin ->', s.file, fs.statSync(file).size, 'bytes');
}
