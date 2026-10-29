/* 自动更新：检查 GitHub Release + 下载新版 exe */
const https = require('https');
const fs = require('fs');
const path = require('path');

const REPO = 'Him-Wang/FCL';

/* 只允许从 GitHub 自己的域名下载，避免被伪造的 Release / 重定向带到任意地址 */
const ALLOWED_HOSTS = new Set([
  'github.com',
  'api.github.com',
  'objects.githubusercontent.com',
  'github-releases.githubusercontent.com',
  'codeload.github.com',
]);

function httpJson(url, timeout = 15000, redirects = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { timeout, headers: { 'User-Agent': 'FCL-Updater', Accept: 'application/vnd.github+json' } },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (redirects >= 3) return reject(new Error('重定向过多'));
          return httpJson(res.headers.location, timeout, redirects + 1).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error('HTTP ' + res.statusCode));
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('连接超时')));
    req.on('error', reject);
  });
}

function parseVer(v) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(v || ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
}

function isNewer(latest, current) {
  const a = parseVer(latest);
  const b = parseVer(current);
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

/** 查最新 Release（只提供 Windows x64 的 exe） */
async function check(currentVersion) {
  const rel = await httpJson(`https://api.github.com/repos/${REPO}/releases/latest`);
  const tag = rel.tag_name || '';
  const latest = (rel.name || tag).replace(/^v/i, '');
  const version = (tag.match(/v?(\d+\.\d+\.\d+)/) || [])[1] || '';
  const assets = (rel.assets || []).filter((a) => /\.exe$/i.test(a.name) && /x64/i.test(a.name));
  const asset = assets[0] || null;
  return {
    latest: version || latest,
    tag,
    name: rel.name || tag,
    notes: rel.body || '',
    url: rel.html_url,
    publishedAt: rel.published_at,
    hasUpdate: !!version && isNewer(version, currentVersion),
    asset: asset ? { name: asset.name, size: asset.size, url: asset.browser_download_url } : null,
  };
}

/** URL 末段 → 安全的本地文件名（只留 basename，去掉 Windows 非法字符） */
function safeFileName(raw) {
  let s = String(raw || '').split('?')[0];
  try {
    s = decodeURIComponent(s);
  } catch (e) {}
  return path
    .basename(s)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .trim();
}

/** 下载到指定目录，返回本地路径 */
function download(url, destDir, onProgress) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(destDir, { recursive: true });
    const name = safeFileName(url.split('/').pop()) || 'FCL-update.exe';
    const dest = path.join(destDir, name);
    if (path.dirname(path.resolve(dest)) !== path.resolve(destDir)) return reject(new Error('非法的下载路径'));
    const tmp = dest + '.part';
    const fail = (err) => {
      try {
        fs.rmSync(tmp, { force: true });
      } catch (e) {}
      reject(err);
    };
    const go = (u, redirects = 0) => {
      let parsed;
      try {
        parsed = new URL(u);
      } catch (e) {
        return fail(new Error('非法的下载地址'));
      }
      if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname)) {
        return fail(new Error('不允许的下载地址：' + parsed.hostname));
      }
      https
        .get(u, { timeout: 20000, headers: { 'User-Agent': 'FCL-Updater' } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            if (redirects >= 5) return fail(new Error('重定向过多'));
            return go(new URL(res.headers.location, u).href, redirects + 1);
          }
          if (res.statusCode !== 200) {
            res.resume();
            return fail(new Error('下载失败：HTTP ' + res.statusCode));
          }
          const total = Number(res.headers['content-length'] || 0);
          let done = 0;
          const ws = fs.createWriteStream(tmp);
          res.on('error', fail);
          res.on('data', (chunk) => {
            done += chunk.length;
            if (onProgress && total) onProgress({ done, total, percent: Math.round((done / total) * 100) });
          });
          res.pipe(ws);
          ws.on('finish', () => {
            ws.close(() => {
              if (total && done !== total) return fail(new Error('下载不完整（' + done + '/' + total + '）'));
              try {
                fs.renameSync(tmp, dest);
              } catch (e) {
                return fail(e);
              }
              resolve({ path: dest, size: done });
            });
          });
          ws.on('error', fail);
        })
        .on('error', fail);
    };
    go(url);
  });
}

module.exports = { check, download, isNewer };
