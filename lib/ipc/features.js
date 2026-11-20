/* FCL · 附加功能 IPC（开服 / 联机 / 更新 / 崩溃导出 / P2P / 依赖自检 / 环境自检 / 光影预检）
 * 这些逻辑以前直接堆在 main.js 末尾，抽出来后 main 只负责接线。
 */
module.exports = function registerFeatureIpc(ctx) {
  const {
    ipcMain, send, log, shell, app, quit,
    GAME_DIR, ROOT, LOG_DIR, UI_CFG, patchCfg, findJava,
    serverLib, p2p, deps, diag, shaderCheck, crashLib, updater, modstore,
    net, os, path, fs,
  } = ctx;

/* ---------------- 路径入参兜底 ---------------- */
// 这些 IPC 的目录参数来自渲染层。合法值要么来自系统文件夹选择框（绝对路径），
// 要么是 GAME_DIR。这里只做“必须是无 NUL 的绝对路径”这一层防御，不限制必须落在
// GAME_DIR 内——用户自定义游戏目录是正常功能。contextIsolation 已开、无远程内容加载，
// 这层只是纵深防御：即使将来出现渲染层注入，也拦住畸形路径。
function safeDir(p, fallback) {
  try {
    const s = String(p || '');
    if (!s || s.includes('\0') || !path.isAbsolute(s)) return fallback;
    return path.resolve(s);
  } catch (e) {
    return fallback;
  }
}

/* ---------------- 一键开服 ---------------- */
function serverDirFor(mc) {
  return path.join(GAME_DIR, 'server-' + mc);
}

ipcMain.handle('server:info', async (_e, dir) => {
  const d = dir || serverDirFor((UI_CFG.lastServerMc || '26.3'));
  return { dir: d, info: serverLib.info(d), running: serverLib.isRunning() };
});

ipcMain.handle('server:create', async (_e, req) => {
  const mc = req.mc;
  const dir = safeDir(req.dir, serverDirFor(mc));
  patchCfg({ lastServerMc: mc });
  log('info', `创建服务端：${mc}（${req.kind}）→ ${dir}`);
  const r = await serverLib.create({
    dir, mc,
    kind: req.kind === 'vanilla' ? 'vanilla' : 'paper',
    port: req.port || 25565,
    mem: req.mem || 2048,
    motd: req.motd,
    onlineMode: req.onlineMode !== false,
    maxPlayers: req.maxPlayers || 20,
    onProgress: (p) => send('server:progress', p),
  });
  log('info', `服务端已就绪：${r.jar}`);
  return { ok: true, ...r, info: serverLib.info(dir) };
});

ipcMain.handle('server:start', async (_e, req) => {
  const dir = req.dir || serverDirFor(req.mc || '26.3');
  const java = await findJava(req.javaPath);
  if (!java.path) throw new Error('未检测到 Java，请先在设置里部署 Java 运行时');
  log('info', '启动服务端：' + dir);
  const r = await serverLib.start({
    dir,
    javaPath: java.path,
    mem: req.mem,
    onLog: (line) => send('server:log', line),
    onExit: (code) => {
      log('info', '服务端退出，代码 ' + code);
      send('server:state', { running: false, code });
    },
  });
  send('server:state', { running: true, pid: r.pid, heap: r.heap });
  return { ok: true, ...r };
});

ipcMain.handle('server:cmd', async (_e, line) => {
  const ok = serverLib.command(line);
  if (ok) log('info', '服务端命令：' + line);
  return { ok };
});

ipcMain.handle('server:stop', async () => {
  const ok = await serverLib.stop();
  send('server:state', { running: false, stopped: ok });
  return { ok };
});


/* ---------------- 联机 ---------------- */
function lanAddresses() {
  const out = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const a of ifs[name] || []) {
      if (a.family === 'IPv4' && !a.internal) {
        out.push({ iface: name, address: a.address });
      }
    }
  }
  // 常见的局域网段排前面
  out.sort((x, y) => {
    const rank = (ip) =>
      ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : /^172.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3;
    return rank(x.address) - rank(y.address);
  });
  return out;
}

async function publicIp() {
  const urls = [
    'https://api.ipify.org?format=json',
    'https://ipv4.icanhazip.com',
    'https://myip.ipip.net/json',
  ];
  for (const u of urls) {
    try {
      const txt = await net.getText([u], 8000);
      const s = String(txt).trim();
      const ip = (s.match(/(\d{1,3}(?:\.\d{1,3}){3})/) || [])[1];
      if (ip) return ip;
    } catch (e) {}
  }
  return '';
}

ipcMain.handle('net:info', async () => {
  const lan = lanAddresses();
  const pub = await publicIp().catch(() => '');
  return { lan, publicIp: pub };
});

/** 在 Windows 防火墙放行端口（尽力而为，失败不报错） */
ipcMain.handle('net:firewall', async (_e, port) => {
  const p = Number(port) || 25565;
  if (process.platform !== 'win32') return { ok: false, message: '仅 Windows 需要放行防火墙' };
  const { exec } = require('child_process');
  const run = (cmd) =>
    new Promise((resolve) => exec(cmd, { windowsHide: true }, (err, stdout, stderr) => resolve({ err, stdout, stderr })));
  const name = 'FCL Server ' + p;
  await run('netsh advfirewall firewall delete rule name="' + name + '"');
  const r = await run(
    'netsh advfirewall firewall add rule name="' + name + '" dir=in action=allow protocol=TCP localport=' + p,
  );
  if (r.err) return { ok: false, message: '需要管理员权限（' + String(r.stderr || r.err.message).trim() + '）' };
  return { ok: true, message: '已在防火墙放行 TCP ' + p };
});

/** 用 UPnP 尝试端口映射（路由器不支持就返回失败，不做保证） */
ipcMain.handle('net:upnp', async (_e, req) => {
  const port = Number((req && req.port) || 25565);
  try {
    const upnp = require('../upnp');
    const r = await upnp.mapPort({ port, description: 'FCL Minecraft Server' });
    return r;
  } catch (e) {
    return { ok: false, message: String((e && e.message) || e) || 'UPnP 不可用' };
  }
});



/* ---------------- 崩溃报告导出 ---------------- */
ipcMain.handle('crash:export', async (_e, req) => {
  const info = req && req.info ? req.info : {};
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = path.join(ROOT, 'crash-reports');
  const outFile = path.join(outDir, 'FCL-crash-' + stamp + '.zip');
  try {
    await crashLib.exportZip({ gameDir: (req && req.gameDir) || GAME_DIR, outFile, info, launcherLog: path.join(LOG_DIR, 'app.log') });
    log('info', '崩溃报告已导出：' + outFile);
    shell.showItemInFolder(outFile);
    return { ok: true, file: outFile };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

/* ---------------- 自动更新 ---------------- */
ipcMain.handle('app:check-update', async () => {
  const current = app.getVersion();
  try {
    const r = await updater.check(current);
    return { ok: true, current, ...r };
  } catch (e) {
    return { ok: false, current, error: String((e && e.message) || e) };
  }
});

ipcMain.handle('app:download-update', async (_e, req) => {
  const url = req && req.url;
  if (!url) return { ok: false, error: '没有下载地址' };
  try {
    const dir = path.join(ROOT, 'updates');
    const r = await updater.download(url, dir, (p) => send('update:progress', p));
    log('info', '更新包已下载：' + r.path);
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

ipcMain.handle('shell:reveal', async (_e, p) => {
  try {
    shell.showItemInFolder(String(p));
    return true;
  } catch (e) {
    return false;
  }
});


/* ---------------- 以管理员身份重启 ---------------- */
ipcMain.handle('app:relaunch-admin', async () => {
  try {
    const { execFile } = require('child_process');
    const exe = process.execPath;
    // 不要用单引号把 exe 拼进 PowerShell 命令：安装路径里带 '（如 C:\Users\O'Brien\...）
    // 会截断字符串甚至注入任意命令（lib/crash.js 之前修过同样的坑）。改走环境变量。
    execFile(
      'powershell.exe',
      ['-NoProfile', '-Command', `Start-Process -FilePath $env:FCL_EXE -Verb RunAs`],
      { windowsHide: true, env: { ...process.env, FCL_EXE: exe } },
    );
    log('info', '正在以管理员身份重新启动：' + exe);
    setTimeout(() => {
      quit();
    }, 900);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

/* ---------------- P2P 联机 ---------------- */
ipcMain.handle('p2p:status', async () => p2p.status());

ipcMain.handle('p2p:start', async (_e, req) => {
  const r = p2p.start({
    room: req && req.room,
    secret: req && req.secret,
    peer: req && req.peer,
    onLog: (line) => send('p2p:log', line),
    onState: (st) => send('p2p:state', st),
  });
  log('info', `P2P 已启动：房间 ${r.room}，角色 ${r.role === 'host' ? '房主' : '加入'}，虚拟 IP ${r.virtualIp || '待分配'}`);
  return { ok: true, ...r };
});

ipcMain.handle('p2p:stop', async () => {
  const ok = p2p.stop();
  send('p2p:state', { running: false });
  log('info', 'P2P 已停止');
  return { ok };
});


/* ---------------- 模组依赖自检 / 一键修复 ---------------- */
ipcMain.handle('deps:check', async (_e, req) => {
  const gameDir = safeDir(req && req.gameDir, GAME_DIR);
  const r = deps.check({ gameDir, version: req && req.version });
  log('info', `依赖检查：${r.mods.length} 个模组，缺失 ${r.missing.length} 项`);
  return r;
});

ipcMain.handle('deps:fix', async (_e, req) => {
  const gameDir = safeDir(req && req.gameDir, GAME_DIR);
  const mc = (req && req.mc) || '';
  const loader = (req && req.loader) || 'fabric';
  const before = deps.check({ gameDir, version: req && req.version });
  const installed = [];
  const failed = [];

  for (let round = 0; round < 3; round++) {
    const cur = deps.check({ gameDir, version: req && req.version });
    if (!cur.missing.length) break;
    const slugs = deps.slugsFor(cur.missing);
    let progressed = false;
    for (const slug of slugs) {
      try {
        send('deps:progress', { phase: '安装依赖', name: slug });
        const r = await modstore.install({ id: slug, mc, loader, type: 'mod', gameDir });
        installed.push({ slug, file: r.file, version: r.version });
        log('info', `已补装依赖：${slug} → ${r.file}`);
        progressed = true;
      } catch (e) {
        failed.push({ slug, error: String((e && e.message) || e) });
        log('warn', `补装依赖失败：${slug}（${(e && e.message) || e}）`);
      }
    }
    if (!progressed) break;
  }

  const after = deps.check({ gameDir, version: req && req.version });
  return {
    ok: after.missing.length === 0,
    before: before.missing,
    after: after.missing,
    installed,
    failed,
  };
});


/* ---------------- 运行环境自检 ---------------- */
ipcMain.handle('diag:run', async (_e, req) => {
  const gameDir = safeDir(req && req.gameDir, GAME_DIR);
  const java = await findJava(req && req.javaPath).catch(() => ({ path: '', version: '' }));
  const r = diag.diagnose({
    gameDir,
    version: (req && req.version) || UI_CFG.lastVersion || '',
    javaPath: java.path,
    javaVersion: java.version,
  });
  log('info', `环境自检：错误 ${r.summary.errors} / 警告 ${r.summary.warns}（模组 ${r.modCount}，光影 ${r.shaderCount}）`);
  return r;
});


/* ---------------- 一键降配 ---------------- */
ipcMain.handle('perf:optimize', async (_e, req) => {
  const gameDir = safeDir(req && req.gameDir, GAME_DIR);
  const file = path.join(gameDir, 'options.txt');
  const want = {
    renderDistance: '8',
    simulationDistance: '8',
    graphicsPreset: '"fast"',
    entityShadows: 'false',
    enableVsync: 'false',
    maxFps: '60',
    ao: 'true',
    particles: '1',
  };
  try {
    let lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/) : [];
    const seen = new Set();
    lines = lines.map((line) => {
      const k = line.split(':')[0];
      if (Object.prototype.hasOwnProperty.call(want, k)) {
        seen.add(k);
        return k + ':' + want[k];
      }
      return line;
    });
    for (const k of Object.keys(want)) if (!seen.has(k)) lines.push(k + ':' + want[k]);
    fs.mkdirSync(gameDir, { recursive: true });
    fs.writeFileSync(file, lines.join('\n'), 'utf8');
    log('info', '已把游戏画质调到低配档（视距 8 / 快速画质 / 关阴影 / 60 帧上限）');
    return { ok: true, file };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});


/* ---------------- 光影兼容性预检 ---------------- */
ipcMain.handle('shader:scan', async (_e, req) => {
  const gameDir = safeDir(req && req.gameDir, GAME_DIR);
  const r = shaderCheck.scan(gameDir);
  const okN = r.packs.filter((p) => p.ok).length;
  log('info', `光影预检：GL ${r.gl.version}，${r.packs.length} 个包里 ${okN} 个可跑`);
  return r;
});

};
