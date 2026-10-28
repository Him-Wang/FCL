/* 自动更新：检查 GitHub Release + 下载新版 exe */
const https = require('https');
const fs = require('fs');
const path = require('path');

const REPO = 'Him-Wang/FCL';

function httpJson(url, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { timeout, headers: { 'User-Agent': 'FCL-Updater', Accept: 'application/vnd.github+json' } },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return httpJson(res.headers.location, timeout).then(resolve, reject);
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

/** 查最新 Release；只认 tag 形如 v1.4.x 的（macOS 的 v1.0.x-macos 不算） */
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

/** 下载到指定目录，返回本地路径 */
function download(url, destDir, onProgress) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(destDir, { recursive: true });
    const name = decodeURIComponent(url.split('/').pop().split('?')[0]) || 'FCL-update.exe';
    const dest = path.join(destDir, name);
    const tmp = dest + '.part';
    const go = (u, redirects = 0) => {
      https
        .get(u, { timeout: 20000, headers: { 'User-Agent': 'FCL-Updater' } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
            res.resume();
            return go(res.headers.location, redirects + 1);
          }
          if (res.statusCode !== 200) {
            res.resume();
            return reject(new Error('下载失败：HTTP ' + res.statusCode));
          }
          const total = Number(res.headers['content-length'] || 0);
          let done = 0;
          const ws = fs.createWriteStream(tmp);
          res.on('data', (chunk) => {
            done += chunk.length;
            if (onProgress && total) onProgress({ done, total, percent: Math.round((done / total) * 100) });
          });
          res.pipe(ws);
          ws.on('finish', () => {
            ws.close(() => {
              try {
                fs.renameSync(tmp, dest);
              } catch (e) {}
              resolve({ path: dest, size: done });
            });
          });
          ws.on('error', reject);
        })
        .on('error', reject);
    };
    go(url);
  });
}

module.exports = { check, download, isNewer };
