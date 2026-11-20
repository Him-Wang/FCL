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
const { download, getText, getJSON, ensureDir } = require('./net');

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

/** 从 Adoptium 官方 assets API 取下载地址和它自带的 SHA-256。
 *  这个 API 直接给出二进制包的 checksum（不是跳转到 GitHub 后再猜），
 *  是下面所有下载源做“先校验、后解压执行”的信任锚。 */
async function adoptiumSource(major, os, arch, imageType, label) {
  try {
    const api = `https://api.adoptium.net/v3/assets/latest/${major}/hotspot?architecture=${arch}&image_type=${imageType}&os=${os}&vendor=eclipse`;
    const assets = await getJSON([api], 12000);
    const pkg = assets && assets[0] && assets[0].binary && assets[0].binary.package;
    if (pkg && pkg.link && /^[0-9a-f]{64}$/i.test(pkg.checksum || '')) {
      return {
        label: label || `Adoptium ${imageType.toUpperCase()} ${major} (${os} ${arch})`,
        url: pkg.link,
        sha256: pkg.checksum.toLowerCase(),
        name: pkg.name,
      };
    }
  } catch (e) {}
  return null;
}

/** macOS：Adoptium 官方（assets API 带校验和，arm64 / x64 都覆盖） */
async function macSources(major) {
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';
  const list = [];
  const jre = await adoptiumSource(major, 'mac', arch, 'jre', 'Adoptium JRE ' + major + ' (macOS ' + arch + ')');
  if (jre) list.push(jre);
  const jdk = await adoptiumSource(major, 'mac', arch, 'jdk', 'Adoptium JDK ' + major + ' (macOS ' + arch + ')');
  if (jdk) list.push(jdk);
  return list;
}

/** 按文件名里的版本号数值排序（字符串排序会把 21.0.9 排在 21.0.10 后面） */
function cmpVerName(a, b) {
  const num = (s) => (String(s).match(/\d+(?:\.\d+)+/g) || ['0']).pop().split('.').map(Number);
  const pa = num(a);
  const pb = num(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

async function sourcesFor(major) {
  if (process.platform === 'darwin') return macSources(major);
  const list = [];

  // 信任锚：Adoptium 官方 assets API 直接给出二进制包链接与 SHA-256。
  // 下面所有镜像源都用它（或镜像自带的校验文件）拿到校验和，做不到就跳过（fail closed）。
  const adopt = await adoptiumSource(major, 'windows', 'x64', 'jre', `Adoptium JRE ${major}`);
  if (adopt) list.push(adopt);

  // 1) 清华镜像的 Adoptium JRE（体积最小）：文件名与官方一致，复用官方 API 的校验和
  const tuna = `https://mirrors.tuna.tsinghua.edu.cn/Adoptium/${major}/jre/x64/windows/`;
  try {
    const html = await getText([tuna], 8000);
    const zips = [...html.matchAll(/href="([^"]+\.zip)"/g)]
      .map((m) => m[1])
      .filter((n) => /jre_x64_windows/i.test(n))
      .sort(cmpVerName);
    const name = zips.length ? decodeURIComponent(zips[zips.length - 1]) : '';
    if (name && adopt && name === adopt.name) {
      list.unshift({
        label: `清华镜像 JRE ${major}`,
        url: tuna + zips[zips.length - 1],
        sha256: adopt.sha256,
        name: adopt.name,
      });
    }
  } catch (e) {}

  // 2) 华为云 OpenJDK（JDK，体积大，最后兜底）：镜像目录自带 .sha256 校验文件
  try {
    const base = `https://mirrors.huaweicloud.com/openjdk/${major}/`;
    const html = await getText([base], 8000);
    const zips = [...html.matchAll(/href="([^"]+windows-x64_bin\.zip)"/g)].map((m) => m[1]);
    if (zips.length) {
      const url = base + zips[0];
      const sidecar = await getText([url + '.sha256'], 8000);
      const m = String(sidecar).match(/[0-9a-f]{64}/i);
      if (m) list.push({ label: `华为云 OpenJDK ${major}`, url, sha256: m[0].toLowerCase(), name: zips[0] });
    }
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
    // fail closed：没有可信校验和的源绝不下载、绝不解压执行。
    if (!/^[0-9a-f]{64}$/i.test(s.sha256 || '')) {
      failures.push(`${s.label}: 无可信 SHA-256，跳过（拒绝解压未校验的压缩包）`);
      continue;
    }
    const zip = path.join(runtimeRoot, `download-${major}-${Date.now()}.zip`);
    try {
      await ensureDir(runtimeRoot);
      progress({ phase: '下载 Java', label: s.label, percent: 0, done: 0, total: 0 });
      // 把校验和交给 net.download：写完临时文件后先核对 SHA-256，不符就当本次失败并回退下一个源。
      // 这一步是“下载后要 spawn java.exe”的前提，绝不能省。
      await download([s.url], zip, (done, total) =>
        progress({
          phase: '下载 Java',
          label: s.label,
          done,
          total,
          percent: total ? Math.min(99, Math.round((done / total) * 100)) : 0,
        }),
        { sha256: s.sha256 },
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
