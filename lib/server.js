/* FCL · 一键开服
 *
 * 支持两种服务端：
 *   paper   —— PaperMC 官方 v3 API（fill.papermc.io），带插件生态，推荐
 *   vanilla —— Mojang 官方的原版服务端
 *
 * 只负责：下载服务端 jar、写 eula / server.properties / start 脚本、启动与停止进程。
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const net = require('./net');
const tcp = require('net');

const PAPER_API = 'https://fill.papermc.io/v3/projects/paper';
const VERSION_MANIFEST = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json';

let running = null; // { proc, dir }

async function getJSON(url) {
  return net.getJSON([url], 20000);
}

/** Paper 指定 MC 版本的最新构建 */
async function paperLatest(mc) {
  const list = await getJSON(`${PAPER_API}/versions/${encodeURIComponent(mc)}/builds`);
  if (!Array.isArray(list) || !list.length) {
    throw new Error('Paper 还没有发布 ' + mc + ' 的服务端');
  }
  const stable = list.find((b) => b.channel === 'STABLE') || list[0];
  const dl = (stable.downloads && (stable.downloads['server:default'] || stable.downloads.application)) || null;
  if (!dl || !dl.url) throw new Error('Paper 构建里没有服务端下载地址');
  return { build: stable.id, channel: stable.channel, url: dl.url, size: dl.size || 0, sha256: dl.sha256 || '' };
}

/** 原版服务端 jar */
async function vanillaLatest(mc) {
  const manifest = await getJSON(VERSION_MANIFEST);
  const v = (manifest.versions || []).find((x) => x.id === mc);
  if (!v) throw new Error('官方版本清单里没有 ' + mc);
  const meta = await getJSON(v.url);
  const s = meta.downloads && meta.downloads.server;
  if (!s) throw new Error(mc + ' 没有官方服务端（太老的版本没有）');
  return { url: s.url, size: s.size, sha1: s.sha1 };
}

/** 端口是否可用（TCP bind 探测，不依赖 netstat） */
function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = tcp.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '0.0.0.0');
  });
}

/** 从 start 起找一个空闲端口（最多顺延 100 个） */
async function choosePort(start) {
  const base = Number(start) || 25565;
  for (let i = 0; i < 100; i++) {
    const p = base + i;
    if (p > 65535) break;
    if (await isPortFree(p)) return p;
  }
  throw new Error('从 ' + base + ' 起找不到空闲端口');
}

/** 改 server.properties 里的端口（保留其它行） */
function setPropertyPort(file, port) {
  const txt = fs.readFileSync(file, 'utf8');
  const out = /^server-port=.*$/m.test(txt)
    ? txt.replace(/^server-port=.*$/m, 'server-port=' + port)
    : txt + '\nserver-port=' + port + '\n';
  fs.writeFileSync(file, out, 'utf8');
}

function readPropertyPort(file) {
  try {
    const m = /^server-port=(\d+)/m.exec(fs.readFileSync(file, 'utf8'));
    return m ? Number(m[1]) : 25565;
  } catch (e) {
    return 25565;
  }
}

function writeIfAbsent(file, content) {
  if (fs.existsSync(file)) return false;
  fs.writeFileSync(file, content, 'utf8');
  return true;
}

function serverProps({ port, motd, onlineMode, maxPlayers }) {
  return [
    '#Minecraft server properties（由 FCL 生成，可直接改）',
    `motd=${motd}`,
    `server-port=${port}`,
    `online-mode=${onlineMode ? 'true' : 'false'}`,
    `max-players=${maxPlayers}`,
    'view-distance=10',
    'simulation-distance=10',
    'spawn-protection=0',
    'enable-command-block=true',
    'allow-flight=true',
    'difficulty=easy',
    'gamemode=survival',
    'level-name=world',
    'pvp=true',
    '',
  ].join('\n');
}

function startScript({ jar, mem }) {
  return [
    '@echo off',
    'chcp 65001 >nul',
    'title FCL Server',
    `java -Xms${Math.min(1024, mem)}M -Xmx${mem}M -jar "${jar}" nogui`,
    'pause',
    '',
  ].join('\r\n');
}

/** 已有 jar 且能对上校验值就复用；否则重新下载（下载时强制校验，避免执行被替换/写坏的 jar） */
async function ensureServerJar(dest, info, opt) {
  const algo = info.sha256 ? 'sha256' : 'sha1';
  const expect = String(info.sha256 || info.sha1 || '').toLowerCase();
  if (fs.existsSync(dest) && fs.statSync(dest).size >= 1024) {
    if (!expect) return; // 没有官方校验值，只能按大小判断
    const got = await net.hashFile(dest, algo).catch(() => '');
    if (got && got.toLowerCase() === expect) return;
  }
  const dlOpt = expect ? (algo === 'sha256' ? { sha256: expect } : { sha1: expect }) : {};
  await net.download(
    info.url,
    dest,
    (done, total) => opt.onProgress && opt.onProgress({ phase: opt.phase, done, total }),
    dlOpt,
  );
}

/**
 * 创建服务端目录
 * @param {{dir:string, mc:string, kind:'paper'|'vanilla', port:number, mem:number, motd?:string,
 *          onlineMode?:boolean, maxPlayers?:number, onProgress?:Function}} opt
 */
async function create(opt) {
  const { dir, mc, kind } = opt;
  const port = Number(opt.port) || 25565;
  const mem = Math.max(1024, Number(opt.mem) || 2048);
  fs.mkdirSync(dir, { recursive: true });

  let jar;
  if (kind === 'paper') {
    opt.onProgress && opt.onProgress({ phase: '查询 Paper 构建' });
    const info = await paperLatest(mc);
    jar = `paper-${mc}-${info.build}.jar`;
    const dest = path.join(dir, jar);
    if (!fs.existsSync(dest) || fs.statSync(dest).size < 1024) {
      opt.onProgress && opt.onProgress({ phase: '下载 Paper', total: info.size });
    }
    await ensureServerJar(dest, info, { phase: '下载 Paper', onProgress: opt.onProgress });
  } else {
    opt.onProgress && opt.onProgress({ phase: '查询原版服务端' });
    const info = await vanillaLatest(mc);
    jar = 'server.jar';
    const dest = path.join(dir, jar);
    if (!fs.existsSync(dest) || fs.statSync(dest).size < 1024) {
      opt.onProgress && opt.onProgress({ phase: '下载原版服务端', total: info.size });
    }
    await ensureServerJar(dest, info, { phase: '下载原版服务端', onProgress: opt.onProgress });
  }

  // 端口防冲突：被占用就顺延，绝不杀别人的进程
  let finalPort = port;
  try {
    if (!(await isPortFree(port))) {
      finalPort = await choosePort(port);
    }
  } catch (e) {
    finalPort = port;
  }

  writeIfAbsent(path.join(dir, 'eula.txt'), '# 由 FCL 生成：同意 Minecraft EULA（https://aka.ms/MinecraftEULA）\neula=true\n');
  writeIfAbsent(
    path.join(dir, 'server.properties'),
    serverProps({ port: finalPort, motd: opt.motd || 'FCL Server', onlineMode: opt.onlineMode !== false, maxPlayers: opt.maxPlayers || 20 })
  );
  // 已有 properties 但端口被占，也要改过来
  if (finalPort !== port) {
    try { setPropertyPort(path.join(dir, 'server.properties'), finalPort); } catch (e) {}
  }
  fs.writeFileSync(
    path.join(dir, 'start.cmd'),
    startScript({ jar, mem }),
    'utf8'
  );
  fs.writeFileSync(
    path.join(dir, 'FCL-SERVER.json'),
    JSON.stringify({ mc, kind, port: finalPort, requestedPort: port, mem, jar, createdAt: new Date().toISOString() }, null, 2),
    'utf8'
  );

  return { dir, jar, mc, kind, port: finalPort, requestedPort: port, portChanged: finalPort !== port, mem };
}

/** 启动服务端；onLog 收到每一行输出 */
async function start({ dir, javaPath, mem, onLog, onExit }) {
  if (running) throw new Error('服务端已经在运行');
  const confPath = path.join(dir, 'FCL-SERVER.json');
  if (!fs.existsSync(confPath)) throw new Error('这个目录还不是服务端（缺 FCL-SERVER.json），请先创建');
  const conf = JSON.parse(fs.readFileSync(confPath, 'utf8'));
  const jar = path.join(dir, conf.jar || 'server.jar');
  if (!fs.existsSync(jar)) throw new Error('服务端 jar 不存在：' + conf.jar);

  // 启动前再检查一次端口（可能被别的程序抢了）
  let port = readPropertyPort(path.join(dir, 'server.properties'));
  try {
    if (!(await isPortFree(port))) {
      const next = await choosePort(port);
      setPropertyPort(path.join(dir, 'server.properties'), next);
      onLog && onLog('[FCL] 端口 ' + port + ' 被占用，已改用 ' + next);
      port = next;
    }
  } catch (e) {}

  const heap = Math.max(1024, Number(mem) || conf.mem || 2048);
  const args = [`-Xms${Math.min(1024, heap)}M`, `-Xmx${heap}M`, '-jar', jar, 'nogui'];
  const java = javaPath || 'java';

  const proc = spawn(java, args, { cwd: dir, env: Object.assign({}, process.env), windowsHide: true });
  running = { proc, dir };

  const push = (line) => {
    if (typeof line !== 'string') return;
    line.split(/\r?\n/).forEach((l) => {
      if (l.trim()) onLog && onLog(l);
    });
  };
  proc.stdout.setEncoding('utf8');
  proc.stderr.setEncoding('utf8');
  proc.stdout.on('data', push);
  proc.stderr.on('data', push);
  proc.on('exit', (code) => {
    running = null;
    onExit && onExit(code);
  });
  proc.on('error', (e) => {
    running = null;
    onLog && onLog('[启动失败] ' + (e.message || e));
    onExit && onExit(-1);
  });

  return { pid: proc.pid, jar: path.basename(jar), heap, port };
}

/** 停止：先发 stop 指令，10 秒不退再强杀；确认进程真的没了才清空 running */
async function stop() {
  if (!running) return false;
  const { proc } = running;
  try {
    proc.stdin.write('stop\n');
  } catch (e) {}
  const t = setTimeout(() => {
    try { proc.kill(); } catch (e) {}
  }, 10000);
  await new Promise((resolve) => {
    proc.once('exit', () => { clearTimeout(t); resolve(); });
    setTimeout(() => { clearTimeout(t); try { proc.kill(); } catch (e) {} resolve(); }, 15000);
  });
  // 强制结束后仍可能没退（被安全软件拦住 / kill 失败）：保留 running，
  // 否则再点启动会起第二个服务端写同一个存档
  if (proc.exitCode === null && proc.signalCode === null) {
    throw new Error('服务端进程没有退出，请到任务管理器结束 java.exe 后再试');
  }
  running = null;
  return true;
}

/** 向服务端控制台发送一条命令 */
function command(line) {
  if (!running || !line) return false;
  try {
    running.proc.stdin.write(String(line).replace(/\r?\n$/, '') + '\n');
    return true;
  } catch (e) {
    return false;
  }
}

function isRunning() {
  return !!running;
}

/** 读已有服务端目录的配置 */
function info(dir) {
  const confPath = path.join(dir, 'FCL-SERVER.json');
  if (!fs.existsSync(confPath)) return null;
  try {
    const conf = JSON.parse(fs.readFileSync(confPath, 'utf8'));
    conf.jarExists = fs.existsSync(path.join(dir, conf.jar || 'server.jar'));
    conf.running = !!running && running.dir === dir;
    return conf;
  } catch (e) {
    return null;
  }
}

module.exports = { create, start, stop, isRunning, info, command, choosePort, paperLatest, vanillaLatest };
