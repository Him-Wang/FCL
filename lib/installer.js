/* 版本安装：官方 / Fabric / Forge
 * 数据来源：Mojang 官方清单、Fabric Meta、Forge Maven，
 * 国内加速走开源镜像 BMCLAPI（bmclapi2.bangbang93.com）
 * 版本解析与依赖解析复用开源库 @xmcl/core
 */

const fs = require('fs');
const path = require('path');
const fsp = fs.promises;
const { Version } = require('@xmcl/core');
const { getJSON, getText, download, request, pool, ensureDir } = require('./net');

const BMCL = 'https://bmclapi2.bangbang93.com';
const OFFICIAL = 'https://piston-meta.mojang.com';
const BMCL_HOST = new URL(BMCL).host;

const MANIFEST = [
  `${BMCL}/mc/game/version_manifest_v2.json`,
  `${OFFICIAL}/mc/game/version_manifest_v2.json`
];

/** 把官方地址改写为 BMCLAPI 镜像地址 */
function mirror(url) {
  if (!url) return url;
  if (url.startsWith('https://libraries.minecraft.net/')) return url.replace('https://libraries.minecraft.net/', `${BMCL}/maven/`);
  if (url.startsWith('https://resources.download.minecraft.net/')) return url.replace('https://resources.download.minecraft.net/', `${BMCL}/assets/`);
  if (url.startsWith('https://launcher.mojang.com/')) return url.replace('https://launcher.mojang.com/', `${BMCL}/`);
  return url;
}

/* ---------------- 镜像可用性 ----------------
 * BMCLAPI 对每个文件都会 302 到自家的 CDN 节点，而不同路径落到不同后端：
 *   /maven/  → 中科大 CERNET 镜像（可用）
 *   /mc/、/assets/ → sakura 节点（本机 TCP 能连、TLS 永不完成 → 会白等到超时）
 * 所以按“源类型”分别做健康探测/降级：
 *   - 元数据与资源文件：安装前探一次 /mc/，探不通就整轮只用官方源
 *   - Maven 依赖：阿里云 → BMCL → 原始地址 → 腾讯云，逐个快速失败（阿里云 404 只要几十毫秒）
 * 任何一次镜像失败都会立刻把对应通道降级，后续文件不再重试。
 */
let mojangMirrorOk = null;
let mavenMirrorOk = null;

const ALIYUN = 'https://maven.aliyun.com/repository/public/';
const TENCENT = 'https://mirrors.cloud.tencent.com/nexus/repository/maven-public/';
const MAVEN_HOSTS = /^https:\/\/(libraries\.minecraft\.net|maven\.fabricmc\.net|maven\.minecraftforge\.net|files\.minecraftforge\.net|repo1\.maven\.org|repo\.maven\.apache\.org)\//;

async function probeMirror() {
  if (mojangMirrorOk !== null) return mojangMirrorOk;
  try {
    const res = await request(`${BMCL}/mc/game/version_manifest_v2.json`, { timeout: 4000 });
    res.resume();
    mojangMirrorOk = (res.statusCode || 0) < 400;
  } catch (e) {
    mojangMirrorOk = false;
  }
  return mojangMirrorOk;
}

function mavenPath(url) {
  const m = /^https:\/\/[^/]+\/(.+)$/.exec(url);
  return m ? m[1] : null;
}

/** 返回按优先级排好的候选地址 */
function urls(url) {
  const p = MAVEN_HOSTS.test(url) ? mavenPath(url) : null;
  if (p) {
    // fabric / forge 的产物在阿里云、腾讯云上稳定 404，所以只用 BMCL + 官方，且 BMCL 优先
    if (/maven\.fabricmc\.net|maven\.minecraftforge\.net|files\.minecraftforge\.net/.test(url)) {
      const list = [];
      if (mavenMirrorOk !== false) list.push(`${BMCL}/maven/${p}`);
      list.push(url);
      return list.filter((u, i) => list.indexOf(u) === i);
    }
    // Maven 依赖：国内镜像优先，官方兜底
    const list = [ALIYUN + p];
    if (mavenMirrorOk !== false) list.push(`${BMCL}/maven/${p}`);
    list.push(url, TENCENT + p);
    return list.filter((u, i) => list.indexOf(u) === i);
  }
  const m = mirror(url);
  if (m === url) return [url];
  return mojangMirrorOk === false ? [url] : [m, url];
}

/** 下载并感知镜像失败（失败后对应通道整轮降级） */
function dl(list, dest, onProgress, opt) {
  return download(
    list,
    dest,
    onProgress,
    Object.assign(
      {
        onAttemptFail: (u) => {
          if (u.indexOf(BMCL_HOST) < 0) return;
          if (u.indexOf('/maven/') >= 0) mavenMirrorOk = false;
          else mojangMirrorOk = false;
        },
      },
      opt || {},
    ),
  );
}

async function getManifest() {
  const m = await getJSON(MANIFEST);
  return m.versions || [];
}

async function writeVersionJson(gameDir, id, json) {
  const dir = path.join(gameDir, 'versions', id);
  await ensureDir(dir);
  await fsp.writeFile(path.join(dir, `${id}.json`), JSON.stringify(json, null, 2));
}

async function installRuntime(gameDir, id, onProgress, withAssets) {
  await probeMirror();

  // 清掉上次中断留下的 .part（否则会被当成"已下载一半"反复失败）
  try {
    const cleanDir = (d) => {
      for (const f of fs.readdirSync(d)) {
        const full = path.join(d, f);
        const st = fs.statSync(full);
        if (st.isDirectory()) cleanDir(full);
        else if (/\.part$/.test(f)) fs.rmSync(full, { force: true });
      }
    };
    const libDir = path.join(gameDir, 'libraries');
    if (fs.existsSync(libDir)) cleanDir(libDir);
  } catch (e) {}

  // client jar
  const v = await Version.parse(gameDir, id);
  const client = v.downloads && v.downloads.client;
  if (client) {
    await downloadOrSkip(gameDir, path.join(gameDir, 'versions', id, `${id}.jar`), client, 
      (d, t) => onProgress && onProgress({ phase: '下载客户端', name: `${id}.jar`, done: d, total: t, current: 0, count: 1 }));
  }

  // libraries
  const libs = v.libraries.filter((l) => l.download && l.download.url);
  let n = 0;
  await pool(libs.map((l) => async () => {
    const dest = path.join(gameDir, 'libraries', l.download.path);
    if (!(await needsDownload(dest, l.download))) {
      n++;
      return;
    }
    await dl(urls(l.download.url), dest, null, { sha1: l.download.sha1 });
    n++;
    onProgress && onProgress({ phase: '下载依赖库', name: path.basename(l.download.path), done: n, total: libs.length, current: n, count: libs.length });
  }), 4);

  // assets
  if (withAssets && v.assetIndex) {
    const idxPath = path.join(gameDir, 'assets', 'indexes', `${v.assetIndex.id}.json`);
    if (await needsDownload(idxPath, v.assetIndex)) {
      await dl(urls(v.assetIndex.url), idxPath, null, { sha1: v.assetIndex.sha1 });
    }
    const idx = JSON.parse(await fsp.readFile(idxPath, 'utf8'));
    const entries = Object.values(idx.objects || {});
    let a = 0;
    await pool(entries.map((o) => async () => {
      const dest = path.join(gameDir, 'assets', 'objects', o.hash.slice(0, 2), o.hash);
      if (!(await needsDownload(dest, { size: o.size }))) {
        a++;
        return;
      }
      await dl(urls(`https://resources.download.minecraft.net/${o.hash.slice(0, 2)}/${o.hash}`), dest, null, { sha1: o.hash });
      a++;
      onProgress && onProgress({ phase: '下载资源文件', name: o.hash.slice(0, 8), done: a, total: entries.length, current: a, count: entries.length });
    }), 16);
  }
  return id;
}

/** 目标文件是否缺失或大小不符 */
async function needsDownload(dest, meta) {
  try {
    const st = await fsp.stat(dest);
    if (st.size > 0 && (!meta || !meta.size || st.size === meta.size)) return false;
    return true;
  } catch (e) {
    return true;
  }
}

async function downloadOrSkip(gameDir, dest, meta, onProgress) {
  if (!(await needsDownload(dest, meta))) return dest;
  return dl(urls(meta.url), dest, onProgress, { sha1: meta.sha1 });
}

/* ---------------- 官方版本 ---------------- */
async function installVanilla(id, gameDir, onProgress, withAssets) {
  const list = await getManifest();
  const meta = list.find((v) => v.id === id);
  if (!meta) throw new Error(`版本清单中找不到 ${id}`);

  const json = await getJSON(urls(meta.url).concat([`${BMCL}/version/${id}/json`]));
  await writeVersionJson(gameDir, id, json);
  return installRuntime(gameDir, id, onProgress, withAssets);
}

/** 启动前自检：补齐缺失/损坏的 jar、依赖库、资源文件（已存在且大小正确的直接跳过）
 *  上次自检通过会写一个标记文件；标记与当前资源索引一致时跳过 5000+ 个资源文件的 stat，
 *  让第二次之后的启动快很多（中断的下载没有标记，仍会完整补齐）。 */
async function verify(id, gameDir, onProgress, withAssets) {
  const jsonPath = path.join(gameDir, 'versions', id, `${id}.json`);
  if (!fs.existsSync(jsonPath)) {
    const list = await getManifest().catch(() => []);
    const meta = list.find((v) => v.id === id);
    if (!meta) throw new Error(`缺少版本文件：${id}.json`);
    await writeVersionJson(gameDir, id, await getJSON(urls(meta.url)));
  }

  const markerPath = path.join(gameDir, 'versions', id, '.dsl-verified.json');
  let marker = null;
  try {
    marker = JSON.parse(await fsp.readFile(markerPath, 'utf8'));
  } catch (e) {}

  let assetId = null;
  try {
    const v = await Version.parse(gameDir, id);
    assetId = v.assetIndex && v.assetIndex.id;
  } catch (e) {}

  const trusted = !!(withAssets && marker && assetId && marker.assetIndex === assetId);
  if (trusted && onProgress) onProgress({ phase: '文件已校验（跳过）', done: 1, total: 1, current: 1, count: 1 });

  const r = await installRuntime(gameDir, id, onProgress, withAssets && !trusted);
  if (withAssets) {
    try {
      await fsp.writeFile(markerPath, JSON.stringify({ assetIndex: assetId, at: Date.now() }));
    } catch (e) {}
  }
  return r;
}

/* ---------------- Fabric（开源项目 fabricmc.net） ---------------- */
async function fabricLoaders(mc) {
  const all = await getJSON([`https://meta.fabricmc.net/v2/versions/loader/${mc}`, `${BMCL}/fabric-meta/v2/versions/loader/${mc}`]);
  return (all || []).filter((x) => x.loader && x.loader.stable).slice(0, 10);
}

async function installFabric(mc, loader, gameDir, onProgress, withAssets) {
  const id = `fabric-loader-${loader}-${mc}`;
  const json = await getJSON([
    `https://meta.fabricmc.net/v2/versions/loader/${mc}/${loader}/profile/json`,
    `${BMCL}/fabric-meta/v2/versions/loader/${mc}/${loader}/profile/json`
  ]);
  await writeVersionJson(gameDir, id, json);
  return installRuntime(gameDir, id, onProgress, withAssets);
}

/* ---------------- Forge（maven.minecraftforge.net） ---------------- */
async function forgeVersions(mc) {
  // 1) 先问官方 promotions（体积小、带 recommended/latest）
  const out = [];
  try {
    const promo = await getJSON([
      'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json',
      `${BMCL}/forge/promotions_slim.json`,
    ], 12000);
    const p = promo && promo.promos ? promo.promos : {};
    for (const key of [`${mc}-recommended`, `${mc}-latest`]) {
      if (p[key] && !out.includes(`${mc}-${p[key]}`)) out.push(`${mc}-${p[key]}`);
    }
  } catch (e) {}
  // 2) 再用 maven-metadata 补齐（有些版本没有 promotions 条目）
  try {
    const xml = await getText([
      'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml',
      `${BMCL}/maven/net/minecraftforge/forge/maven-metadata.xml`,
    ], 20000);
    const all = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]);
    for (const v of all.filter((x) => x.startsWith(mc + '-')).reverse()) {
      if (!out.includes(v)) out.push(v);
    }
  } catch (e) {}
  return out.slice(0, 10);
}

async function installForge(mc, forgeVer, gameDir, javaPath, onProgress) {
  if (!forgeVer || !/^\d/.test(String(forgeVer))) {
    throw new Error('没有解析到 Forge 版本号：先点「刷新」重新获取列表；如果列表是空的，说明 Forge 还没有发布 ' + mc + ' 的安装包');
  }
  await probeMirror();
  const name = `forge-${forgeVer}`;
  const jarName = `forge-${forgeVer}-installer.jar`;
  const jarPath = path.join(gameDir, 'temp', jarName);
  await dl([
    `${BMCL}/maven/net/minecraftforge/forge/${forgeVer}/${jarName}`,
    `https://maven.minecraftforge.net/net/minecraftforge/forge/${forgeVer}/${jarName}`
  ], jarPath, (d, t) => onProgress && onProgress({ phase: '下载 Forge 安装器', name: jarName, done: d, total: t, current: 0, count: 1 }));

  onProgress && onProgress({ phase: '执行 Forge 安装', name: 'java -jar installer', done: 1, total: 2, current: 1, count: 2 });
  await new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    const p = spawn(javaPath, ['-jar', jarPath, '--installClient', gameDir], { windowsHide: true });
    let out = '';
    p.stdout.on('data', (b) => { out += b.toString(); });
    p.stderr.on('data', (b) => { out += b.toString(); });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`Forge 安装失败(${code})：${out.slice(-300)}`))));
  });
  onProgress && onProgress({ phase: '执行 Forge 安装', name: '完成', done: 2, total: 2, current: 2, count: 2 });
  return name;
}

module.exports = { getManifest, installVanilla, installFabric, fabricLoaders, forgeVersions, installForge, verify, mirror };
