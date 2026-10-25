/* 把 build/fish-symbol.svg 写进 index.html 的 #i-fish symbol */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'build', 'fish-symbol.svg'), 'utf8').trim();
const file = path.join(root, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const re = /<symbol id="i-fish"[\s\S]*?<\/symbol>/;
if (!re.test(html)) {
  console.error('没有找到 #i-fish symbol');
  process.exit(1);
}
fs.writeFileSync(file, html.replace(re, svg), 'utf8');
console.log('index.html 的 #i-fish 已更新，长度', svg.length);
