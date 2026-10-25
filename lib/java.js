/* Java 运行时：探测 + 一键部署
 *
 * 探测优先级：用户手动指定 → 启动器自己部署过的 → 系统已安装的 JDK → PATH 里的 java
 * 部署优先级：清华 Adoptium 镜像（JRE，约 50 MB）→ 华为云 OpenJDK（JDK，约 200 MB）→ Adoptium 官方 API
 * 部署位置：<userData>/runtime/jdk-<major>/home，解压用系统自带 tar.exe（bsdtar，Win10 1803+）
 */

const fs = require('fs');

const IS_WIN = process.platform === 'win32';
const JAVA_UI = IS_WIN ? 'javaw.exe' : 'java';   // 启动游戏用（Windows 下不弹黑框）
const JAVA_CLI = IS_WIN ? 'java.exe' : 'java';   // 探测版本用
const path = require('path');
const { execFile } = require('child_process');
const fsp = fs.promises;
const { download, getText, ensureDir } = require('./net');

let runtimeRoot = null;

function init(userDataDir) {
  runtimeRoot = path.join(userDataDir, 'runtime');
  return runtimeRoot;
}

function homeFor(major) {
  return path.join(runtimeRoot, `jdk-${major}`, 'home');
}

/** 统一成 javaw.exe 路径（启动游戏用它，不弹黑框） */
function normalizeJavaPath(p) {
  if (!p) return '';
  try {
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      const w = path.join(p, 'bin', JAVA_UI);
      const j = path.join(p, 'bin', JAVA_CLI);
      if (fs.existsSync(w)) return w;
      if (fs.existsSync(j)) return j;
      return '';
    }
  } catch (e) {
    return '';
  }
  if (/java\.exe$/i.test(p)) {
    const w = p;
    return fs.existsSync(w) ? w : p;
  }
  return fs.existsSync(p) ? p : '';
}

/** javaw.exe 不写标准输出，探测版本要用同目录的 java.exe */
function probeVersion(javawPath) {
  const exe = String(javawPath || '').replace(/javaw\.exe$/i, JAVA_CLI);
  if (!exe || !fs.existsSync(exe)) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(exe, ['-version'], { windowsHide: true, timeout: 8000 }, (err, stdout, stderr) => {
      const m = (String(stderr || '') + String(stdout || '')).match(/version\s+"([^"]+)"/);
      resolve(m ? m[1] : null);
    });
  });
}

function bundledHomes() {
  if (!runtimeRoot || !fs.existsSync(runtimeRoot)) return [];
  try {
    return fs
      .readdirSync(runtimeRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(runtimeRoot, d.name, 'home'))
      .filter((h) => fs.existsSync(path.join(h, 'bin', JAVA_UI)));
  } catch (e) {
    return [];
  }
}

const SYSTEM_ROOTS = [
  'C:\\Program Files\\Java',
  'C:\\Program Files\\Eclipse Adoptium',
  'C:\\Program Files\\BellSoft',
  'C:\\Program Files\\Zulu',
  'C:\\Program Files\\Microsoft',
  'C:\\Program Files\\Amazon Corretto',
  'C:\\Program Files (x86)\\Java',
];

/** 探测本机可用 Java：返回 { path, version, source } */
async function detect(custom) {
  // 改名迁移：老路径指向历史应用目录时，改指向新目录（FCL）下的同名运行时
  let customPath = custom;
  if (customPath && runtimeRoot) {
    const appDir = path.dirname(runtimeRoot);
    for (const legacy of ['FMCL', '大肥鱼启动器', '肥鱼启动器']) {
      const re = new RegExp('[\\\\/]' + legacy + '[\\\\/]');
      if (!re.test(customPath)) continue;
      try {
        const rel = customPath.split(re)[1];
        const migrated = path.join(appDir, rel);
        if (fs.existsSync(migrated)) customPath = migrated;
      } catch (e) {}
      break;
    }
  }
  const hit = normalizeJavaPath(customPath);
  if (hit) {
    const inRuntime = runtimeRoot && path.resolve(hit).toLowerCase().startsWith(path.resolve(runtimeRoot).toLowerCase());
    return { path: hit, version: await probeVersion(hit), source: inRuntime ? 'bundled' : 'custom' };
  }

  for (const home of bundledHomes()) {
    const exe = path.join(home, 'bin', JAVA_UI);
    return { path: exe, version: await probeVersion(exe), source: 'bundled' };
  }

  const roots = [];
  if (process.env.LOCALAPPDATA) roots.push(path.join(process.env.LOCALAPPDATA, 'Programs'));
  roots.push(...SYSTEM_ROOTS);
  for (const r of roots) {
    try {
      if (!fs.existsSync(r)) continue;
      for (const d of fs.readdirSync(r)) {
        const exe = normalizeJavaPath(path.join(r, d));
        if (exe) return { path: exe, version: await probeVersion(exe), source: 'system' };
        const exe2 = normalizeJavaPath(path.join(r, d, 'bin'));
        if (exe2) return { path: exe2, version: await probeVersion(exe2), source: 'system' };
      }
    } catch (e) {}
  }

  // PATH
  const fromPath = await new Promise((resolve) => {
    execFile('where', ['java'], { windowsHide: true }, (err, stdout) => {
      const p = String(stdout || '').split(/\r?\n/).find(Boolean);
      resolve(err || !p ? '' : normalizeJavaPath(p.trim()));
    });
  });
  if (fromPath) return { path: fromPath, version: await probeVersion(fromPath), source: 'path' };

  return { path: '', version: null, source: 'none' };
}

/* ---------------- 部署 ---------------- */

function runTar(zip, dest) {
  return new Promise((resolve, reject) => {
    execFile(process.platform === 'win32' ? 'tar.exe' : 'tar', ['-xf', zip, '-C', dest], { windowsHide: true, timeout: 180000 }, (err, _so, se) => {
      if (err) reject(new Error('解压失败：' + String(se || err.message).trim().slice(0, 200)));
      else resolve();
    });
  });
}

async function extractTo(zip, home) {
  const tmp = home + '.tmp';
  await fsp.rm(tmp, { recursive: true, force: true });
  await ensureDir(tmp);
  await runTar(zip, tmp);
  const entries = fs.readdirSync(tmp);
  const root =
    entries.length === 1 && fs.statSync(path.join(tmp, entries[0])).isDirectory() ? path.join(tmp, entries[0]) : tmp;
  await fsp.rm(home, { recursive: true, force: true });
  await ensureDir(path.dirname(home));
  await fsp.rename(root, home);
  if (root !== tmp) await fsp.rm(tmp, { recursive: true, force: true });
}

/** 收集可用的下载源（按体积从小到大） */
/** macOS：Adoptium 官方 + 清华镜像（arm64 / x64 都覆盖） */
function macSources(major) {
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';
  const list = [];
  list.push({
    label: 'Adoptium JRE ' + major + ' (macOS ' + arch + ')',
    url: 'https://api.adoptium.net/v3/binary/latest/' + major + '/ga/mac/' + arch + '/jre/hotspot/normal/eclipse',
  });
  list.push({
    label: 'Adoptium JDK ' + major + ' (macOS ' + arch + ')',
    url: 'https://api.adoptium.net/v3/binary/latest/' + major + '/ga/mac/' + arch + '/jdk/hotspot/normal/eclipse',
  });
  return list;
}

async function sourcesFor(major) {
  if (process.platform === 'darwin') return macSources(major);
  const list = [];

  // 1) 清华镜像的 Adoptium JRE（体积最小）
  const tuna = `https://mirrors.tuna.tsinghua.edu.cn/Adoptium/${major}/jre/x64/windows/`;
  try {
    const html = await getText([tuna], 8000);
    const zips = [...html.matchAll(/href="([^"]+\.zip)"/g)]
      .map((m) => m[1])
      .filter((n) => /jre_x64_windows/i.test(n))
      .sort();
    if (zips.length) list.push({ label: `清华镜像 JRE ${major}`, url: tuna + zips[zips.length - 1] });
  } catch (e) {}

  // 2) Adoptium 官方 API（会 302 到 GitHub，部分网络不可达）
  list.push({ label: `Adoptium JRE ${major}`, url: `https://api.adoptium.net/v3/binary/latest/${major}/ga/windows/x64/jre/hotspot/normal/eclipse` });

  // 3) 华为云 OpenJDK（JDK，体积大，最后兜底）
  try {
    const base = `https://mirrors.huaweicloud.com/openjdk/${major}/`;
    const html = await getText([base], 8000);
    const zips = [...html.matchAll(/href="([^"]+windows-x64_bin\.zip)"/g)].map((m) => m[1]);
    if (zips.length) list.push({ label: `华为云 OpenJDK ${major}`, url: base + zips[0] });
  } catch (e) {}

  return list;
}

/** 一键部署指定大版本；已部署过则直接复用 */
async function install(major, onProgress) {
  if (!runtimeRoot) throw new Error('Java 模块尚未初始化');
  major = Number(major) || 21;
  const progress = onProgress || (() => {});
  const home = homeFor(major);

  const existing = normalizeJavaPath(home);
  if (existing) return { path: existing, version: await probeVersion(existing), reused: true };

  const sources = await sourcesFor(major);
  const failures = [];
  for (const s of sources) {
    const zip = path.join(runtimeRoot, `download-${major}-${Date.now()}.zip`);
    try {
      await ensureDir(runtimeRoot);
      progress({ phase: '下载 Java', label: s.label, percent: 0, done: 0, total: 0 });
      await download([s.url], zip, (done, total) =>
        progress({
          phase: '下载 Java',
          label: s.label,
          done,
          total,
          percent: total ? Math.min(99, Math.round((done / total) * 100)) : 0,
        }),
      );
      progress({ phase: '解压 Java', label: s.label, percent: 99, done: 0, total: 0 });
      await extractTo(zip, home);
      // 解压完必须能真的找到 java 可执行文件，否则清掉半成品换下一个源
      const okBin = normalizeJavaPath(home);
      if (!okBin) {
        try {
          fs.rmSync(home, { recursive: true, force: true });
        } catch (e) {}
        throw new Error('解压后没找到 ' + JAVA_UI + '（可能是压缩包损坏）');
      }
      const exe = normalizeJavaPath(home);
      if (!exe) throw new Error('解压后未找到 bin/' + JAVA_UI);
      progress({ phase: '完成', label: s.label, percent: 100, done: 1, total: 1 });
      return { path: exe, version: await probeVersion(exe), major, source: s.label };
    } catch (e) {
      failures.push(`${s.label}: ${e.message}`);
    } finally {
      try {
        await fsp.unlink(zip);
      } catch (e) {}
    }
  }
  throw new Error(`Java 部署失败（${failures.join('；')}）`);
}

module.exports = { init, detect, install, probeVersion, normalizeJavaPath, homeFor, bundledHomes };
