/* 中文模组搜索：MC百科（mcmod.cn，最大的中文 MC 模组百科）
 *
 * MC百科没有公开 API，这里解析它的搜索结果页（search.mcmod.cn/s?key=...）：
 *   <div class="search-result-list">
 *     <div class="result-item">
 *       <div class="head">…<a href="https://www.mcmod.cn/class/2021.html">机械动力 (Create)</a></div>
 *       <div class="body">摘要…</div>
 *       <div class="foot">…快照时间：2026-10-17…</div>
 * 标题里的英文名（括号内）可直接拿去 Modrinth 搜同名项目，从而实现「中文搜 → 一键下载」。
 * 注意：mcmod 对高频请求有限流，这里做了 5 分钟缓存 + 单飞（并发请求复用同一次抓取）。
 */

const { getText } = require('./net');

const ENDPOINT = 'https://search.mcmod.cn/s?key=';
const TTL = 5 * 60 * 1000;
const cache = new Map();
const inflight = new Map();

const HTML_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
  'Accept-Language': 'zh-CN,zh;q=0.9',
  Accept: 'text/html,application/xhtml+xml',
  Referer: 'https://www.mcmod.cn/',
};

function decode(s) {
  return String(s)
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/\s+/g, ' ')
    .trim();
}

function parse(html, limit) {
  const START = '<div class="result-item">';
  const idx = [];
  let i = -1;
  while ((i = html.indexOf(START, i + 1)) >= 0) idx.push(i);
  const out = [];
  for (let k = 0; k < idx.length && out.length < limit; k++) {
    const chunk = html.slice(idx[k], k + 1 < idx.length ? idx[k + 1] : idx[k] + 8000);
    const head = (chunk.match(/<div class="head">([\s\S]*?)<div class="body">/) || [])[1] || '';
    const anchors = [...head.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
    const titleAnchor = anchors.filter((a) => /\/class\/\d+\.html/.test(a[1]))[0] || anchors[anchors.length - 1];
    if (!titleAnchor) continue;
    const body = (chunk.match(/<div class="body">([\s\S]*?)<\/div>\s*<div class="foot">/) || [])[1] || '';
    const time = (chunk.match(/快照时间：<\/span><span class="value">([^<]+)/) || [])[1] || '';
    const title = decode(titleAnchor[2]);
    const en = ((title.match(/[(（]([^()（）]+)[)）]\s*$/) || [])[1] || '').trim();
    out.push({
      title,
      en,
      url: titleAnchor[1].startsWith('//') ? 'https:' + titleAnchor[1] : titleAnchor[1],
      desc: decode(body).slice(0, 170),
      time: time.trim(),
    });
  }
  return out;
}

/** 中文关键词搜索 MC百科；返回 [{ title, en, url, desc, time }] */
async function search(query, limit) {
  const key = String(query || '').trim();
  if (!key) throw new Error('请输入中文模组名，例如：机械动力 / 暮色森林');
  const max = Math.min(Number(limit) || 20, 30);

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.items.slice(0, max);

  if (inflight.has(key)) return (await inflight.get(key)).slice(0, max);

  const job = (async () => {
    const html = await getText([ENDPOINT + encodeURIComponent(key)], 20000, HTML_HEADERS);
    if (/访问过于频繁|安全验证|captcha/i.test(html)) throw new Error('MC百科请求过于频繁，请稍后再试');
    const items = parse(html, 30);
    if (!items.length) throw new Error(`MC百科没有找到「${key}」相关模组`);
    cache.set(key, { at: Date.now(), items });
    return items;
  })();

  inflight.set(key, job);
  try {
    return (await job).slice(0, max);
  } finally {
    inflight.delete(key);
  }
}

module.exports = { search };
