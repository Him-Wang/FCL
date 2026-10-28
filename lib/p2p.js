/* P2P 联机（内置 EasyTier，LGPL-3.0）
 *
 * 两种角色：
 *   房主（peer 留空）：本机监听 11010，虚拟 IP 10.144.144.1
 *   加入（填 peer）：连到房主的 tcp://<房主地址>:11010，虚拟 IP 用 DHCP 分配
 *
 * 说明：EasyTier 的虚拟网卡需要管理员权限（防火墙放行那一步会报 0x80070005），
 *       所以界面会引导用户「以管理员身份重启启动器」。
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

let proc = null;
let state = { running: false, virtualIp: '', room: '', peer: '', role: '', log: [] };

function binDir() {
  const candidates = [
    path.join(process.resourcesPath || '', 'easytier'),
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'vendor', 'easytier'),
    path.join(__dirname, '..', 'vendor', 'easytier'),
  ];
  for (const d of candidates) {
    try {
      if (d && fs.existsSync(path.join(d, 'easytier-core.exe'))) return d;
    } catch (e) {}
  }
  return candidates[candidates.length - 1];
}

function available() {
  try {
    return fs.existsSync(path.join(binDir(), 'easytier-core.exe'));
  } catch (e) {
    return false;
  }
}

/** 从日志里抠出虚拟 IP */
function parseIp(line) {
  const m =
    /(?:got|new|assign(?:ed)?)[^\d]{0,20}ipv4[^\d]{0,20}(\d+\.\d+\.\d+\.\d+)/i.exec(line) ||
    /virtual ipv4[^\d]*(\d+\.\d+\.\d+\.\d+)/i.exec(line) ||
    /ipv4[^\d]{0,10}(\d+\.\d+\.\d+\.\d+)\/\d+/i.exec(line);
  return m ? m[1] : '';
}

/**
 * @param {{room:string, secret?:string, peer?:string, onLog?:Function, onState?:Function}} opt
 */
function start(opt) {
  if (proc) throw new Error('P2P 已经在运行');
  if (!available()) throw new Error('内置 EasyTier 缺失（vendor/easytier）');

  const room = String(opt.room || '').trim();
  if (!room) throw new Error('请先填房间号');
  const secret = String(opt.secret || '').trim() || room;
  const peer = String(opt.peer || '').trim();
  const isHost = !peer;

  const args = [
    '--network-name', room,
    '--network-secret', secret,
    '-i', isHost ? '10.144.144.1' : '10.144.144.2',
  ];
  if (!isHost) args.push('-p', /:\/\//.test(peer) ? peer : 'tcp://' + peer);
  args.push('--disable-p2p');

  const p = spawn(path.join(binDir(), 'easytier-core.exe'), args, {
    cwd: binDir(),
    windowsHide: true,
    env: Object.assign({}, process.env),
  });
  proc = p;
  state = { running: true, virtualIp: isHost ? '10.144.144.1' : '', room, peer, role: isHost ? 'host' : 'join', log: [] };

  const push = (line) => {
    if (typeof line !== 'string') return;
    for (const l of line.split(/\r?\n/)) {
      if (!l.trim()) continue;
      state.log.push(l);
      if (state.log.length > 600) state.log.shift();
      const ip = parseIp(l);
      if (ip) state.virtualIp = ip;
      opt.onLog && opt.onLog(l);
    }
  };
  p.stdout.setEncoding('utf8');
  p.stderr.setEncoding('utf8');
  p.stdout.on('data', push);
  p.stderr.on('data', push);
  p.on('exit', (code) => {
    proc = null;
    state.running = false;
    opt.onState && opt.onState({ running: false, code, role: state.role, virtualIp: state.virtualIp });
  });
  p.on('error', (e) => {
    proc = null;
    state.running = false;
    opt.onLog && opt.onLog('[错误] ' + (e.message || e));
    opt.onState && opt.onState({ running: false, error: String(e.message || e) });
  });

  return { running: true, role: state.role, room, peer, virtualIp: state.virtualIp, pid: p.pid };
}

function stop() {
  if (!proc) return false;
  try { proc.kill(); } catch (e) {}
  proc = null;
  state.running = false;
  return true;
}

function status() {
  return {
    running: !!proc,
    role: state.role || '',
    room: state.room || '',
    peer: state.peer || '',
    virtualIp: state.virtualIp || '',
    available: available(),
    logTail: (state.log || []).slice(-80).join('\n'),
  };
}

module.exports = { start, stop, status, available, parseIp };
