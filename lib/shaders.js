/* 光影包兼容性预检
 * 思路：读 shaderpacks 里每个 zip 的 GLSL `#version` 声明 → 换算成需要的 OpenGL 版本，
 * 再和当前显卡实际提供的 OpenGL 版本（从游戏日志里读）对比，提前标出"能不能跑"。
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* GLSL 版本 → 需要的 OpenGL 版本 */
const GLSL_TO_GL = [
  [120, '2.1'],
  [130, '3.0'],
  [150, '3.2'],
  [330, '3.3'],
  [400, '4.0'],
  [410, '4.1'],
  [420, '4.2'],
  [430, '4.3'],
  [440, '4.4'],
  [450, '4.5'],
  [460, '4.6'],
];

function glslToGL(v) {
  let out = '3.3';
  for (const [g, gl] of GLSL_TO_GL) if (v >= g) out = gl;
  return out;
}

function cmpGL(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 2; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

/* ---------- 极简 zip 读取 ---------- */
function readCentral(buf) {
  const entries = [];
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) return entries;
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && off + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const nlen = buf.readUInt16LE(off + 28);
    const elen = buf.readUInt16LE(off + 30);
    const clen = buf.readUInt16LE(off + 32);
    const lho = buf.readUInt32LE(off + 42);
    const name = buf.slice(off + 46, off + 46 + nlen).toString('utf8');
    entries.push({ name, method, csize, lho });
    off += 46 + nlen + elen + clen;
  }
  return entries;
}

function readEntry(buf, entry) {
  try {
    const lnlen = buf.readUInt16LE(entry.lho + 26);
    const lelen = buf.readUInt16LE(entry.lho + 28);
    const start = entry.lho + 30 + lnlen + lelen;
    const data = buf.slice(start, start + entry.csize);
    return entry.method === 0 ? data : zlib.inflateRawSync(data);
  } catch (e) {
    return null;
  }
}

/** 从 zip 里判断需要的 GLSL 版本 */
function shaderGLSL(file) {
  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch (e) {
    return null;
  }
  const entries = readCentral(buf);
  const shaders = entries.filter((e) => /\.(vsh|fsh|gsh|comp|csh)$/i.test(e.name)).slice(0, 400);
  let max = 0;
  for (const e of shaders) {
    const data = readEntry(buf, e);
    if (!data) continue;
    const head = data.slice(0, 1500).toString('utf8');
    const m = /#version\s+(\d+)/.exec(head);
    if (m) max = Math.max(max, Number(m[1]));
  }
  // 没写 #version 的默认按 120（GL 2.1）算
  return max || 0;
}

/** 当前显卡的 OpenGL 版本：优先读游戏日志，读不到给 3.3 */
function currentGL(gameDir) {
  const log = path.join(gameDir, 'logs', 'latest.log');
  try {
    const txt = fs.readFileSync(log, 'utf8').slice(-300000);
    const m = /OpenGL Version:\s*(\d+)\.(\d+)/.exec(txt);
    if (m) return { version: m[1] + '.' + m[2], renderer: (/OpenGL Renderer:\s*([^\r\n]+)/.exec(txt) || [])[1] || '' };
  } catch (e) {}
  return { version: '3.3', renderer: '', fromLog: false };
}

function scan(gameDir) {
  const dir = path.join(gameDir, 'shaderpacks');
  const gl = currentGL(gameDir);
  const packs = [];
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => /\.zip$/i.test(f));
  } catch (e) {
    return { gl, packs: [] };
  }
  for (const f of files) {
    const full = path.join(dir, f);
    const glsl = shaderGLSL(full);
    const need = glsl ? glslToGL(glsl) : '3.3';
    packs.push({
      file: f,
      name: f.replace(/\.zip$/i, ''),
      glsl: glsl || 0,
      need,
      ok: cmpGL(gl.version, need) >= 0,
      sizeKB: Math.round(fs.statSync(full).size / 1024),
    });
  }
  packs.sort((a, b) => Number(b.ok) - Number(a.ok) || cmpGL(a.need, b.need));
  return { gl, packs };
}

module.exports = { scan, currentGL, shaderGLSL, glslToGL, cmpGL };
