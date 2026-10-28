/* 模组依赖自检与自动修复
 *
 * 场景：Fabric 报 "Incompatible mods found! ... 需要 fabric-api 但没有安装"
 * 做法：
 *   1. 读 mods 目录里每个 jar 的元数据（fabric.mod.json / quilt.mod.json / META-INF/mods.toml）
 *   2. 汇总「谁提供了什么 id」与「谁依赖什么 id」
 *   3. 找出没被满足的依赖（跳过 minecraft / java / fabricloader 这类内置）
 *   4. 用 Modrinth 把缺的依赖装上（按 mod id 搜项目，再选匹配 MC + 加载器的版本）
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ---------- 极简 zip 读取（只取小文本文件） ---------- */
function readZipEntry(buf, name) {
  let i = buf.length - 22;
  while (i >= 0 && buf.readUInt32LE(i) !== 0x06054b50) i--;
  if (i < 0) return null;
  const count = buf.readUInt16LE(i + 10);
  let off = buf.readUInt32LE(i + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const nlen = buf.readUInt16LE(off + 28);
    const elen = buf.readUInt16LE(off + 30);
    const clen = buf.readUInt16LE(off + 32);
    const lho = buf.readUInt32LE(off + 42);
    const fname = buf.slice(off + 46, off + 46 + nlen).toString('utf8');
    if (fname === name) {
      const lnlen = buf.readUInt16LE(lho + 26);
      const lelen = buf.readUInt16LE(lho + 28);
      const start = lho + 30 + lnlen + lelen;
      const data = buf.slice(start, start + csize);
      try {
        return method === 0 ? data : zlib.inflateRawSync(data);
      } catch (e) {
        return null;
      }
    }
    off += 46 + nlen + elen + clen;
  }
  return null;
}

/* ---------- 依赖 id 归一化 ---------- */
const BUILTIN = new Set([
  'minecraft', 'java', 'fabricloader', 'fabric-loader', 'fabric_loader',
  'quilt_loader', 'quiltloader', 'forge', 'neoforge', 'neoforged',
  'fabric-api-base', 'fabric_api_base',
]);

/* 常见的"模组 id ≠ Modrinth slug"映射 */
const SLUG_ALIAS = {
  'fabric-api': 'fabric-api',
  fabric_api: 'fabric-api',
  'cloth-config': 'cloth-config',
  clothconfig: 'cloth-config',
  'architectury-api': 'architectury-api',
  architectury: 'architectury-api',
  'geckolib': 'geckolib',
  'playeranimator': 'player-animator',
  'midnightlib': 'midnightlib',
  'yacl': 'yacl',
  'modmenu': 'modmenu',
  'indium': 'indium',
  'sodium': 'sodium',
  'lithium': 'lithium',
};

function normId(id) {
  return String(id || '').trim().toLowerCase().replace(/_/g, '-');
}

/** 解析单个 jar 的元数据 */
function parseJar(file) {
  const buf = fs.readFileSync(file);
  const out = { file: path.basename(file), id: '', version: '', provides: [], depends: {}, loader: '' };

  // Fabric
  const fab = readZipEntry(buf, 'fabric.mod.json');
  if (fab) {
    try {
      const j = JSON.parse(fab.toString('utf8'));
      out.loader = 'fabric';
      out.id = normId(j.id);
      out.version = String(j.version || '');
      out.provides = [out.id, ...(j.provides || []).map(normId)];
      const dep = j.depends || {};
      for (const k of Object.keys(dep)) out.depends[normId(k)] = String(dep[k]);
      return out;
    } catch (e) {}
  }

  // Quilt
  const quilt = readZipEntry(buf, 'quilt.mod.json');
  if (quilt) {
    try {
      const j = JSON.parse(quilt.toString('utf8'));
      const q = j.quilt_loader || {};
      out.loader = 'quilt';
      out.id = normId(q.id);
      out.version = String(q.version || '');
      out.provides = [out.id];
      const dep = (q.metadata && q.metadata.depends) || q.depends || [];
      const list = Array.isArray(dep) ? dep : Object.keys(dep).map((k) => ({ id: k, versions: dep[k] }));
      for (const d of list) {
        if (typeof d === 'string') out.depends[normId(d)] = '*';
        else if (d && d.id) out.depends[normId(d.id)] = String(d.versions || '*');
      }
      return out;
    } catch (e) {}
  }

  // Forge / NeoForge
  const toml = readZipEntry(buf, 'META-INF/mods.toml') || readZipEntry(buf, 'META-INF/neoforge.mods.toml');
  if (toml) {
    try {
      const t = toml.toString('utf8');
      const modId = (t.match(/^\s*modId\s*=\s*"([^"]+)"/m) || [])[1] || '';
      const ver = (t.match(/^\s*version\s*=\s*"([^"]+)"/m) || [])[1] || '';
      out.loader = /neoforge/i.test(t) ? 'neoforge' : 'forge';
      out.id = normId(modId);
      out.version = ver;
      out.provides = [out.id];
      const blocks = t.split(/\[\[dependencies/).slice(1);
      for (const b of blocks) {
        const depId = (b.match(/modId\s*=\s*"([^"]+)"/) || [])[1];
        const range = (b.match(/versionRange\s*=\s*"([^"]*)"/) || [])[1] || '*';
        const mandatory = !/mandatory\s*=\s*false/.test(b);
        if (depId && mandatory) out.depends[normId(depId)] = range.trim() || '*';
      }
      return out;
    } catch (e) {}
  }

  return out;
}

/** 找出版本对应的 mods 目录（支持版本隔离） */
function modsDirFor(gameDir, version) {
  const iso = version ? path.join(gameDir, 'versions', version, 'mods') : '';
  if (iso && fs.existsSync(iso)) return iso;
  return path.join(gameDir, 'mods');
}

/**
 * 检查依赖
 * @returns {{ok:boolean, missing:Array<{id:string, range:string, by:string[]}>, mods:Array, dir:string}}
 */
function check({ gameDir, version }) {
  const globalDir = path.join(gameDir, 'mods');
  const isoDir = version ? path.join(gameDir, 'versions', version, 'mods') : '';
  const dirs = [];
  if (fs.existsSync(globalDir)) dirs.push(globalDir);
  if (isoDir && fs.existsSync(isoDir) && path.resolve(isoDir) !== path.resolve(globalDir)) dirs.push(isoDir);
  const dir = dirs[0] || globalDir;
  if (!dirs.length) {
    return { ok: true, missing: [], mods: [], dir, reason: '没有 mods 目录' };
  }
  const mods = [];
  const seen = new Set();
  for (const d of dirs) {
    const files = fs.readdirSync(d).filter((f) => /\.jar$/i.test(f) && !/\.disabled$/i.test(f));
    for (const f of files) {
      const full = path.join(d, f);
      if (seen.has(full)) continue;
      seen.add(full);
      try {
        const m = parseJar(full);
        if (m && m.id) mods.push(m);
      } catch (e) {}
    }
  }
  const provided = new Set();
  for (const m of mods) for (const p of m.provides) if (p) provided.add(p);

  const missingMap = new Map();
  for (const m of mods) {
    for (const [depId, range] of Object.entries(m.depends || {})) {
      if (!depId || BUILTIN.has(depId)) continue;
      if (provided.has(depId)) continue;
      // 有些模组会把依赖写成自己的 provided 变体，宽松匹配一次
      const alt = [...provided].some((p) => p.startsWith(depId) || depId.startsWith(p));
      if (alt) continue;
      const item = missingMap.get(depId) || { id: depId, range, by: [] };
      if (!item.by.includes(m.id)) item.by.push(m.id);
      missingMap.set(depId, item);
    }
  }
  const missing = [...missingMap.values()];
  return { ok: missing.length === 0, missing, mods, dir };
}

/** 把缺失的依赖 id 映射成 Modrinth 项目 slug（去重） */
function slugsFor(missing) {
  const out = [];
  const push = (s) => {
    const slug = String(s || '').trim().toLowerCase();
    if (slug && !out.includes(slug)) out.push(slug);
  };
  for (const m of missing || []) {
    const id = normId(m.id);
    if (SLUG_ALIAS[id]) { push(SLUG_ALIAS[id]); continue; }
    // Fabric API 的各个子模块：装 fabric-api 就全有了
    if (/^fabric-/.test(id) || id === 'fabric-api' || id === 'fabric') { push('fabric-api'); continue; }
    if (id === 'mixinextras') { push('mixinextras'); continue; }
    push(id);
  }
  return out;
}

module.exports = { check, parseJar, modsDirFor, normId, slugsFor, SLUG_ALIAS };
