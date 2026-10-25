/* 生成界面里用的鱼形 SVG symbol（#i-fish），与新应用图标同一套造型
 *
 * 新图标是「白色胖鱼 + 青绿背鳍 + 深蓝眼睛 + 两颗气泡」，这里用同一几何关系写成矢量 symbol，
 * 保证标题栏、侧边栏、关于页的鱼和 exe 图标长得一样。
 * 输出：build/fish-symbol.svg（可直接替换 index.html 里的 #i-fish 那一行）
 * 重新生成：node tools/gen-fish-svg.js
 */

const fs = require('fs');
const path = require('path');

const SYMBOL =
  `<symbol id="i-fish" viewBox="0 0 24 24">` +
  `<ellipse cx="11.3" cy="12.3" rx="6.3" ry="3.8" style="fill:#ffffff;stroke:none"/>` +
  `<path d="M5.6 12.3 L1.5 8.85 L2.75 12.3 L1.5 15.75 Z" style="fill:#dbe4ff;stroke:none"/>` +
  `<path d="M8.25 9.25 L9.4 7.05 L11.45 8.95 Z" style="fill:#00c29a;stroke:none"/>` +
  `<circle cx="14.3" cy="11.25" r="0.8" style="fill:#16224f;stroke:none"/>` +
  `<circle cx="18.9" cy="7.6" r="0.62" style="fill:#00c29a;stroke:none"/>` +
  `<circle cx="20.6" cy="9.35" r="0.36" style="fill:#00c29a;stroke:none"/>` +
  `</symbol>`;

const out = path.join(__dirname, '..', 'build', 'fish-symbol.svg');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, SYMBOL + '\n', 'utf8');
console.log('fish symbol ->', out, fs.statSync(out).size, 'bytes');
console.log('提示：index.html 里的 #i-fish 应与该文件内容一致');
