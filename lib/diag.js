/* 运行环境自检：版本 / 加载器 / 模组归属 / 光影前置 / Java 是否匹配
 * 目的：回答"我装了模组和光影，为什么游戏里看不到"这种问题
 */
const fs = require('fs');
const path = require('path');
const deps = require('./deps');

const JAVA_HINT = [
  { test: (mc) => /^(\d+)\./.test(mc) && Number(mc.split('.')[1]) >= 20.5, major: 21 },
  { test: (mc) => /^(\d+)\./.test(mc) && Number(mc.split('.')[1]) >= 17, major: 17 },
  { test: (mc) => /^\d\d\.\d/.test(mc) && !mc.startsWith('1.'), major: 25 },
];

function guessJava(mc) {
  const s = String(mc || '');
  const modern = /^(\d+)\.(\d+)/.exec(s);
  if (modern && !s.startsWith('1.')) {
    const major = Number(modern[1]);
    if (major >= 26) return 25;
    if (major >= 21) return 21;
  }
  const m = /^1\.(\d+)(?:\.(\d+))?/.exec(s);
  if (m) {
    const minor = Number(m[1]);
    const patch = Number(m[2] || 0);
    if (minor >= 20 && patch >= 5) return 21;
    if (minor >= 17) return 17;
    return 8;
  }
  return 21;
}

function mcOf(v) {
  const s = String(v || '');
  let m = s.match(/^fabric-loader-[^-]+-(.+)$/);
  if (m) return m[1];
  m = s.match(/^quilt-loader-[^-]+-(.+)$/);
  if (m) return m[1];
  m = s.match(/^(?:forge|neoforge)-(.+?)(?:-\d|$)/);
  if (m) return m[1];
  return s;
}

function loaderOf(v) {
  const s = String(v || '');
  if (/^fabric/i.test(s)) return 'fabric';
  if (/^quilt/i.test(s)) return 'quilt';
  if (/^neoforge/i.test(s)) return 'neoforge';
  if (/^forge/i.test(s)) return 'forge';
  return '';
}

function hasIrisLike(jars) {
  return (jars || []).some((j) => /iris|oculus|optifine/i.test(j.name));
}

function listJars(dir) {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => /\.jar$/i.test(f) && !/\.disabled$/i.test(f))
      .map((f) => ({ name: f, file: path.join(dir, f), size: fs.statSync(path.join(dir, f)).size }));
  } catch (e) {
    return [];
  }
}

/**
 * @returns {{checks:Array, summary:{errors:number,warns:number}, modsDir:string, isolatedDir:string|null}}
 */
function diagnose({ gameDir, version, javaPath, javaVersion }) {
  const checks = [];
  const add = (level, title, detail, action) => checks.push({ level, title, detail: detail || '', action: action || null });

  const mc = mcOf(version);
  const loader = loaderOf(version);
  const verDir = path.join(gameDir, 'versions', String(version || ''));
  const verJson = path.join(verDir, String(version || '') + '.json');
  const versionInstalled = !!version && fs.existsSync(verJson);
  const globalMods = path.join(gameDir, 'mods');
  const isoMods = version ? path.join(verDir, 'mods') : '';
  const isoExists = isoMods && fs.existsSync(isoMods);
  const shaderDir = path.join(gameDir, 'shaderpacks');
  const shaders = fs.existsSync(shaderDir)
    ? fs.readdirSync(shaderDir).filter((f) => /\.(zip|jar)$/i.test(f) && !/\.disabled$/i.test(f))
    : [];
  const globalJars = listJars(globalMods);
  const isoJars = isoExists ? listJars(isoMods) : [];
  const activeJars = isoJars.length ? isoJars : globalJars;
  const modsDir = isoJars.length ? isoMods : globalMods;

  // 1) 版本
  if (!version) add('error', '没有选择版本', '启动页先选一个版本');
  else if (!versionInstalled) add('error', `版本 ${version} 没有安装`, '文件缺失，请重新安装这个版本', { type: 'reinstall-version', version });
  else add('ok', `版本 ${version} 已安装`, `对应 MC ${mc} · 加载器 ${loader || '原版'}`);

  // 2) 模组目录归属
  if (!activeJars.length) {
    add('warn', '没有找到任何模组', `扫描目录：${modsDir}`);
  } else if (!loader) {
    add('error', `当前是原版版本，${activeJars.length} 个模组不会加载`, '原版客户端不读 mods，模组必须用 Fabric / Forge 版本启动', { type: 'install-fabric', mc });
  } else {
    add('ok', `已加载 ${activeJars.length} 个模组`, `目录：${modsDir}`);
  }

  // 3) 加载器不匹配的 mod
  const wrong = [];
  for (const j of activeJars) {
    const low = j.name.toLowerCase();
    if (loader === 'fabric' && /neoforge|forge/.test(low) && !/fabric/.test(low)) wrong.push(j.name);
    if (loader === 'forge' && /fabric/.test(low)) wrong.push(j.name);
  }
  if (wrong.length) {
    add('warn', `${wrong.length} 个模组加载器不匹配`, wrong.slice(0, 4).join('、'), { type: 'open-mods' });
  }

  // 4) 光影
  if (shaders.length) {
    const hasIris = activeJars.some((j) => /iris/i.test(j.name));
    const hasOculus = activeJars.some((j) => /oculus/i.test(j.name));
    const hasOptifine = activeJars.some((j) => /optifine/i.test(j.name));
    if (!loader) {
      add('error', `装有 ${shaders.length} 个光影，但当前是原版`, '光影需要 Iris（Fabric）或 OptiFine，原版无法加载', { type: 'install-iris' });
    } else if (!hasIris && !hasOculus && !hasOptifine) {
      add('warn', `装有 ${shaders.length} 个光影，但没装 Iris`, '没有光影前置，游戏里不会出现「光影包」选项', { type: 'install-iris' });
    } else if (!hasIris && !hasOculus && hasOptifine && loader === 'fabric') {
      add('warn', 'OptiFine 与 Fabric 不兼容', 'Fabric 下请改用 Iris + Sodium', { type: 'install-iris' });
    } else {
      add('ok', `光影前置已就绪（${hasIris ? 'Iris' : hasOculus ? 'Oculus' : 'OptiFine'}）`, `已安装 ${shaders.length} 个光影`);
    }
  } else {
    add('ok', '没有安装光影', '需要的话在「材质包·光影」里下载');
  }

  // 4b) 光影是否真的选了包 + 显卡 OpenGL 版本
  try {
    const irisCfg = path.join(gameDir, 'config', 'iris.properties');
    let shaderPack = '';
    if (fs.existsSync(irisCfg)) {
      shaderPack = (fs.readFileSync(irisCfg, 'utf8').match(/^shaderPack=(.*)$/m) || [])[1] || '';
    }
    const logPath = path.join(gameDir, 'logs', 'latest.log');
    let glVer = '';
    if (fs.existsSync(logPath)) {
      // 只读日志最后 200KB（日志可能有几百 MB，整读会卡）
      const st = fs.statSync(logPath);
      const len = Math.min(st.size, 200000);
      const fd = fs.openSync(logPath, 'r');
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, Math.max(0, st.size - len));
      fs.closeSync(fd);
      const tail = buf.toString('utf8');
      // 旧日志：OpenGL Version: 4.6；26.x：using drivers: 3.3.0
      const m = /OpenGL Version:\s*(\d+)\.(\d+)/.exec(tail) || /using drivers:\s*(\d+)\.(\d+)/i.exec(tail);
      if (m) glVer = m[1] + '.' + m[2];
    }
    if (shaders.length && hasIrisLike(activeJars)) {
      if (!shaderPack.trim()) {
        add('warn', 'Iris 已装，但还没选光影包', '进游戏 → 选项 → 视频设置 → 光影包，点一个包再点「应用」', { type: 'open-shaders' });
      } else if (glVer && Number(glVer) < 4.3) {
        add('warn', `显卡只提供 OpenGL ${glVer}（集显/老驱动常见），Complementary、BSL、Photon 这类需要 4.3+ 跑不起来`, '先用轻量光影试试：Sildur\'s Basic（36 KB）或 MakeUp Ultra Fast（397 KB），已可在光影列表里选', { type: 'open-shaders' });
      } else {
        add('ok', '已选择光影包', shaderPack);
      }
    }
  } catch (e) {}

  // 5) 依赖
  try {
    const d = deps.check({ gameDir, version });
    if (d.missing && d.missing.length) {
      add('warn', `缺少 ${d.missing.length} 个模组依赖`, d.missing.map((x) => x.id).join('、'), { type: 'fix-deps' });
    } else {
      add('ok', '模组依赖齐全', '');
    }
  } catch (e) {}

  // 6) Java
  const need = guessJava(mc);
  const have = String(javaVersion || '').match(/(\d+)/);
  const haveMajor = have ? Number(have[1]) : 0;
  if (!javaPath) add('warn', '没有检测到 Java', '启动时会自动部署');
  else if (haveMajor && haveMajor < need) add('error', `Java 版本偏低（${haveMajor} < ${need}）`, '在设置里部署更高的 Java', { type: 'deploy-java' });
  else add('ok', `Java 可用（${haveMajor || '未知'}）`, javaPath || '');

  return {
    checks,
    summary: {
      errors: checks.filter((c) => c.level === 'error').length,
      warns: checks.filter((c) => c.level === 'warn').length,
    },
    modsDir,
    isolatedDir: isoExists ? isoMods : null,
    mc,
    loader,
    shaderCount: shaders.length,
    modCount: activeJars.length,
  };
}

module.exports = { diagnose, mcOf, loaderOf, guessJava };
