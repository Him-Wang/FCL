/* 离线账号换肤：CustomSkinLoader（CSL）本地皮肤集成
 *
 * 原理：CSL 会从 CustomSkinLoader/LocalSkin/skins/<玩家名>.png 读本地皮肤，
 * 但要求 CustomSkinLoader.json 的 loadlist 里 "LocalSkin" 排在 "Mojang" 前面。
 * 这里做三件事：装 CSL 模组（走 Modrinth，无需 key）→ 写皮肤文件 → 把 LocalSkin 提到最前。
 *
 * 注意：配置文件由 CSL 首次运行游戏时生成，所以第一次启用后需要启动一次游戏，
 * 我们的 launch 钩子会在每次启动前自动修正顺序。
 */

const fs = require('fs');
const path = require('path');
const fsp = fs.promises;
const modstore = require('./modstore');

const PROJECT = 'customskinloader'; // Modrinth slug
const ROOT = 'CustomSkinLoader';
const CONFIG = 'CustomSkinLoader.json';

function paths(gameDir) {
  const root = path.join(gameDir, ROOT);
  return {
    root,
    config: path.join(root, CONFIG),
    skins: path.join(root, 'LocalSkin', 'skins'),
    capes: path.join(root, 'LocalSkin', 'capes'),
  };
}

async function readConfig(gameDir) {
  try {
    return JSON.parse(await fsp.readFile(paths(gameDir).config, 'utf8'));
  } catch (e) {
    return null;
  }
}

const isLocalEntry = (e) => !!e && (/local/i.test(String(e.name || '')) || /local/i.test(String(e.type || '')));

function localIndex(cfg) {
  const list = Array.isArray(cfg && cfg.loadlist) ? cfg.loadlist : [];
  return list.findIndex(isLocalEntry);
}

/** 把 LocalSkin 提到 loadlist 最前，并确保本地皮肤开关是开的 */
async function patchConfig(gameDir) {
  const p = paths(gameDir);
  const cfg = await readConfig(gameDir);
  if (!cfg) return { ok: false, reason: 'missing' };
  if (!Array.isArray(cfg.loadlist)) return { ok: false, reason: 'no-loadlist' };

  let changed = false;
  const idx = localIndex(cfg);
  if (idx > 0) {
    const [entry] = cfg.loadlist.splice(idx, 1);
    cfg.loadlist.unshift(entry);
    changed = true;
  }
  if (cfg.enableLocalSkin === false) {
    cfg.enableLocalSkin = true;
    changed = true;
  }
  if (changed) {
    try {
      if (!fs.existsSync(p.config + '.bak')) await fsp.copyFile(p.config, p.config + '.bak');
    } catch (e) {}
    await fsp.writeFile(p.config, JSON.stringify(cfg, null, 2), 'utf8');
  }
  return { ok: idx >= 0, changed, reason: idx >= 0 ? '' : 'no-local-entry', entry: idx >= 0 ? cfg.loadlist[0].name || cfg.loadlist[0].type : '' };
}

/** 写本地皮肤文件（文件名 = 玩家名，CSL 按名字匹配） */
async function writeSkin(gameDir, playerName, dataUrl) {
  const name = String(playerName || '').trim();
  if (!/^[A-Za-z0-9_]{1,32}$/.test(name)) throw new Error('玩家名不合法，无法生成皮肤文件名');
  if (!/^data:image\/png;base64,/.test(String(dataUrl || ''))) throw new Error('皮肤数据无效');
  const p = paths(gameDir);
  await fsp.mkdir(p.skins, { recursive: true });
  await fsp.mkdir(p.capes, { recursive: true });
  const file = path.join(p.skins, name + '.png');
  await fsp.writeFile(file, Buffer.from(String(dataUrl).replace(/^data:image\/png;base64,/, ''), 'base64'));
  return file;
}

/** 装 CSL 模组（按当前 MC 版本 / 加载器挑兼容版本） */
/* ---------- 自带的 CustomSkinLoader 构建（assets/csl） ---------- */
function bundledManifest() {
  try {
    const f = path.join(__dirname, '..', 'assets', 'csl', 'manifest.json');
    if (!fs.existsSync(f)) return [];
    return (JSON.parse(fs.readFileSync(f, 'utf8')).items || []).map((it) => ({
      ...it,
      full: path.join(__dirname, '..', 'assets', 'csl', it.file),
    }));
  } catch (e) {
    return [];
  }
}

/** 版本号比较：把 1.20.1 / 26.1.2 拆成数字数组 */
function verParts(v) {
  return String(v || '')
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((n) => parseInt(n, 10));
}

/** 在自带构建里挑一个和 (loader, mc) 最接近的 */
function pickBundled(loader, mc) {
  const want = String(loader || '').toLowerCase();
  if (!want) return null;
  const items = bundledManifest().filter((it) => (it.loaders || []).map((l) => l.toLowerCase()).includes(want));
  if (!items.length) return null;

  // 1) 精确命中
  const exact = items.find((it) => (it.games || []).includes(String(mc)));
  if (exact) return exact;

  // 2) 按版本距离找最近的
  const target = verParts(mc);
  const dist = (it) => {
    let best = Infinity;
    for (const g of it.games || []) {
      const p = verParts(g);
      if (!p.length || !target.length) continue;
      const len = Math.max(p.length, target.length);
      let d = 0;
      for (let i = 0; i < len; i++) d += Math.abs((p[i] || 0) - (target[i] || 0)) * Math.pow(1000, len - i - 1);
      if (d < best) best = d;
    }
    return best;
  };
  items.sort((a, b) => dist(a) - dist(b));
  return items[0] || null;
}

async function installMod(gameDir, mc, loader, onProgress) {
  if (!loader) throw new Error('CustomSkinLoader 是 mod，需要 Fabric / Forge / NeoForge 版本才能用');

  // 优先用启动器自带的构建：秒装、不联网
  const hit = pickBundled(loader, mc);
  if (hit && fs.existsSync(hit.full)) {
    const modsDir = path.join(gameDir, 'mods');
    await fsp.mkdir(modsDir, { recursive: true });
    const dest = path.join(modsDir, hit.file);
    await fsp.copyFile(hit.full, dest);
    if (onProgress) onProgress({ phase: '安装 CustomSkinLoader（自带）', done: 1, total: 1, percent: 100 });
    return { file: hit.file, from: 'bundled', version: hit.version };
  }

  const r = await modstore.install({ id: PROJECT, type: 'mod', mc, loader, gameDir }, onProgress);
  return r;
}

function modFile(gameDir) {
  try {
    return fs.readdirSync(path.join(gameDir, 'mods')).find((f) => /customskinloader/i.test(f) && f.endsWith('.jar')) || '';
  } catch (e) {
    return '';
  }
}

async function status(gameDir, playerName) {
  const p = paths(gameDir);
  const cfg = await readConfig(gameDir);
  const skinFile = playerName ? path.join(p.skins, String(playerName) + '.png') : '';
  return {
    mod: modFile(gameDir),
    modInstalled: !!modFile(gameDir),
    configExists: !!cfg,
    localFirst: cfg ? localIndex(cfg) === 0 : false,
    hasLocalEntry: cfg ? localIndex(cfg) >= 0 : false,
    skinFile,
    skinExists: skinFile ? fs.existsSync(skinFile) : false,
  };
}

/** 启动前静默修正（已经装过 CSL 且配置存在时才会真正改动） */
async function syncOnLaunch(gameDir) {
  try {
    return await patchConfig(gameDir);
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

module.exports = { status, patchConfig, writeSkin, installMod, syncOnLaunch, paths, PROJECT, pickBundled };
