/* 网络工具：JSON 拉取 / 文件下载
 * 说明：走 Node 原生 http/https，而不是 Electron 主进程的全局 fetch（后者走 Chromium 网络栈，
 *      在部分代理 / 沙箱环境下会挂起）。支持多镜像回退、重定向跟随、超时与进度回调。
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fsp = fs.promises;
const { URL } = require('url');

const UA = 'FMCL/1.0.0 (FishMineCraftLauncher)';

/** 建立 TCP/TLS 连接的最长等待：镜像节点黑洞时快速失败，而不是卡满整个超时 */
const CONNECT_TIMEOUT = 10000;
/** 长时间收不到数据即视为失败（大文件下载中，只要有数据就会不断重置该计时） */
const IDLE_TIMEOUT = 20000;
/** 进度回调节流间隔（毫秒），避免逐块刷 IPC */
const PROGRESS_INTERVAL = 120;

async function ensureDir(p) {
  await fsp.mkdir(p, { recursive: true });
}

async function removeQuiet(p) {
  try {
    await fsp.unlink(p);
  } catch (e) {}
}

function sha1File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha1');
    const s = fs.createReadStream(file);
    s.on('data', (b) => h.update(b));
    s.on('error', reject);
    s.on('end', () => resolve(h.digest('hex')));
  });
}

function request(url, opt, redirects) {
  opt = opt || {};
  const timeout = opt.timeout || IDLE_TIMEOUT;
  const headers = Object.assign({ 'User-Agent': UA, 'Accept-Encoding': 'identity' }, opt.headers || {});
  if (opt.body) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/x-www-form-urlencoded';
    headers['Content-Length'] = Buffer.byteLength(opt.body);
  }

  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      return reject(new Error('非法地址 ' + url));
    }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, { method: opt.method || (opt.body ? 'POST' : 'GET'), headers }, (res) => {
      const code = res.statusCode || 0;
      if (code >= 300 && code < 400 && res.headers.location) {
        res.resume();
        if ((redirects || 0) >= 5) return reject(new Error('重定向过多 ' + url));
        return resolve(request(new URL(res.headers.location, url).href, opt, (redirects || 0) + 1));
      }
      if (code >= 400) {
        res.resume();
        return reject(new Error(`HTTP ${code} ${url}`));
      }
      resolve(res);
    });
    // 连接阶段单独计时：有些镜像会 302 到自身失效的 CDN 节点，TCP 能连上但 TLS 永不完成
    req.on('socket', (s) => {
      if (!s.connecting) return;
      const t = setTimeout(() => req.destroy(new Error('连接超时 ' + url)), CONNECT_TIMEOUT);
      const done = () => clearTimeout(t);
      s.once('connect', done);
      s.once('close', done);
    });
    req.setTimeout(timeout, () => req.destroy(new Error('请求超时 ' + url)));
    req.on('error', reject);
    if (opt.body) req.write(opt.body);
    req.end();
  });
}

/** 依次尝试多个地址，返回第一个成功的结果；onFail 用于感知哪个镜像坏了 */
async function tryFetch(urls, handler, onFail) {
  const list = Array.isArray(urls) ? urls : [urls];
  let lastErr;
  for (const u of list) {
    try {
      return await handler(u);
    } catch (e) {
      lastErr = e;
      if (onFail) {
        try {
          onFail(u, e);
        } catch (_) {}
      }
    }
  }
  throw lastErr || new Error('全部地址均失败');
}

/** 并发竞速：多个镜像同时请求，取最先成功的那个（JSON 等小请求用） */
async function raceFetch(urls, handler) {
  const list = Array.isArray(urls) ? urls : [urls];
  if (list.length === 1) return handler(list[0]);
  return new Promise((resolve, reject) => {
    let failed = 0;
    let lastErr;
    list.forEach((u) => {
      handler(u)
        .then(resolve)
        .catch((e) => {
          lastErr = e;
          if (++failed === list.length) reject(lastErr || new Error('全部地址均失败'));
        });
    });
  });
}

function readAll(res) {
  return new Promise((resolve, reject) => {
    const parts = [];
    res.on('data', (b) => parts.push(b));
    res.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    res.on('error', reject);
  });
}

async function getJSON(urls, timeout, headers) {
  return raceFetch(urls, async (u) => {
    const res = await request(u, { timeout: timeout || 15000, headers });
    return JSON.parse(await readAll(res));
  });
}

async function getText(urls, timeout, headers) {
  return raceFetch(urls, async (u) => {
    const res = await request(u, { timeout: timeout || 15000, headers });
    return readAll(res);
  });
}

/**
 * 下载到文件；onProgress(done, total)。
 * - 先写 `<dest>.part`，校验通过后再原子改名，避免中断留下“大小对但内容坏”的文件
 * - opt.sha1 给出时校验 SHA-1，不匹配当作本次尝试失败（会自动回退下一个地址）
 * - opt.onAttemptFail(url, err) 每次地址失败时回调，便于上层标记镜像不可用
 */
async function download(urls, dest, onProgress, opt) {
  opt = opt || {};
  await ensureDir(path.dirname(dest));
  const part = dest + '.part';
  let lastTick = 0;
  const tick = (done, total) => {
    if (!onProgress) return;
    const now = Date.now();
    if (done !== total && now - lastTick < PROGRESS_INTERVAL) return;
    lastTick = now;
    onProgress(done, total);
  };

  return tryFetch(
    urls,
    async (u) => {
      await removeQuiet(part);
      const res = await request(u, { timeout: opt.timeout || IDLE_TIMEOUT });
      const total = Number(res.headers['content-length']) || 0;
      let done = 0;
      await new Promise((resolve, reject) => {
        const ws = fs.createWriteStream(part);
        let settled = false;
        const fail = (e) => {
          if (settled) return;
          settled = true;
          ws.destroy();
          reject(e);
        };
        res.on('data', (b) => {
          done += b.length;
          tick(done, total);
        });
        res.on('error', fail);
        ws.on('error', fail);
        ws.on('finish', () => {
          if (settled) return;
          settled = true;
          resolve();
        });
        res.pipe(ws);
      });
      if (opt.sha1) {
        const got = await sha1File(part);
        if (got.toLowerCase() !== String(opt.sha1).toLowerCase()) {
          await removeQuiet(part);
          throw new Error(`校验失败 ${path.basename(dest)}（期望 ${String(opt.sha1).slice(0, 8)}… 实际 ${got.slice(0, 8)}…）`);
        }
      }
      await fsp.rename(part, dest);
      tick(done, total || done);
      return dest;
    },
    opt.onAttemptFail,
  );
}

/** 表单 POST（OAuth 用） */
async function postForm(url, body, timeout) {
  const form = typeof body === 'string' ? body : new URLSearchParams(body).toString();
  const res = await request(url, { method: 'POST', body: form, timeout: timeout || 15000 });
  const txt = await readAll(res);
  try {
    return JSON.parse(txt);
  } catch (e) {
    return { raw: txt };
  }
}

/** 并发受限的任务队列 */
async function pool(tasks, limit, onEach) {
  let i = 0;
  const workers = new Array(Math.min(limit, tasks.length)).fill(0).map(async () => {
    while (i < tasks.length) {
      const idx = i++;
      await tasks[idx]();
      if (onEach) onEach(idx + 1, tasks.length);
    }
  });
  await Promise.all(workers);
}

module.exports = { getJSON, getText, download, postForm, pool, ensureDir, tryFetch, request, sha1File };
