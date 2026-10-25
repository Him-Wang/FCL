/* 像素风格头像生成（8x8 网格放大绘制） */

const SKIN_GRID = {
  steve: [
    'HHHHHHHH', 'HHHHHHHH', 'HHHHHHHH', 'HSSSSSSH',
    'SSESSESS', 'SSSSSSSS', 'SSSMMSSS', 'SSSSSSSS'
  ],
  alex: [
    'HHHHHHHH', 'HHHHHHHH', 'HHHHHHHH', 'HSSSSSSH',
    'HSSSSSSH', 'SSESSESS', 'SSSSSSSS', 'SSSMMSSS'
  ]
};

const HAIR_COLORS = ['#3f3124', '#5a3a1e', '#1f1a17', '#8a5a2b', '#b5651d', '#2b2b2b', '#6b4423', '#a0522d'];
const SKIN_COLORS = ['#c69b77', '#b58867', '#e0ac69', '#a8794f', '#f0c8a0', '#8d5524'];
const EYE_COLORS = ['#4c8bf5', '#3f7f3f', '#6b4fa0', '#8b5a2b'];
const MOUTH = '#8a5f45';

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** 生成头像 dataURL；style: 'steve' | 'alex' | 'random' */
function makeAvatar(seed, style, scale) {
  scale = scale || 8;
  const grid = SKIN_GRID[style] || (hashStr(seed) % 2 ? SKIN_GRID.steve : SKIN_GRID.alex);
  const h = hashStr(seed || 'player');
  const pal = {
    H: HAIR_COLORS[h % HAIR_COLORS.length],
    S: SKIN_COLORS[(h >> 3) % SKIN_COLORS.length],
    E: EYE_COLORS[(h >> 7) % EYE_COLORS.length],
    M: MOUTH
  };

  const c = document.createElement('canvas');
  c.width = c.height = 8 * scale;
  const ctx = c.getContext('2d');
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      ctx.fillStyle = pal[grid[y][x]] || '#c69b77';
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
  return c.toDataURL();
}

function uuidFromName(name) {
  const h = hashStr(name).toString(16).padStart(8, '0');
  return `${h}-${(hashStr(name + 'a') % 0xffff).toString(16).padStart(4, '0')}-4${(hashStr(name + 'b') % 0xfff).toString(16).padStart(3, '0')}`.toUpperCase();
}
