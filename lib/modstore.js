/* 下载中心：对接 Modrinth 开放 API（开源项目，https://docs.modrinth.com）
 * 提供模组 / 材质包 / 光影的搜索与真实下载安装
 */

const path = require('path');
const { getJSON, download, ensureDir } = require('./net');

const API = 'https://api.modrinth.com/v2';
let APP_VERSION = '0.0.0';
try { APP_VERSION = require('../package.json').version; } catch (e) {}
const UA = { 'User-Agent': `FCL/${APP_VERSION} (FishCraftLauncher)` };

const TYPE_DIR = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks' };
const TYPE_LABEL = { mod: '模组', resourcepack: '材质包', shader: '光影' };

/** 远端给的文件名一律只取 basename，并去掉 Windows 非法字符/保留的路径片段 */
function safeFileName(name) {
  const base = path.basename(String(name || '')).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim();
  if (!base || base === '.' || base === '..') return '';
  return base;
}

/** 搜索；query 为空时按下载量返回热门 */
async function search(opt) {
  const facets = [];
  if (opt.type) facets.push(`project_type:${opt.type}`);
  if (opt.mc) facets.push(`versions:${opt.mc}`);
  if (opt.loader) facets.push(`categories:${opt.loader}`);

  const params = new URLSearchParams();
  params.set('query', opt.query || '');
  params.set('limit', String(opt.limit || 20));
  params.set('index', opt.query ? 'relevance' : 'downloads');
  if (facets.length) params.set('facets', JSON.stringify(facets.map((f) => [f])));

  const j = await getJSON(`${API}/search?${params}`, 20000, UA);
  return (j.hits || []).map((h) => ({
    id: h.project_id || h.slug,
    slug: h.slug,
    title: h.title,
    desc: h.description,
    icon: h.icon_url,
    downloads: h.downloads,
    type: h.project_type,
    versions: h.versions || [],
    categories: h.categories || [],
    author: h.author
  }));
}

/** 列出项目可用版本（按 MC 版本 / 加载器过滤） */
async function versions(id, opt) {
  const p = new URLSearchParams();
  if (opt && opt.loader) p.set('loaders', JSON.stringify([opt.loader]));
  if (opt && opt.mc) p.set('game_versions', JSON.stringify([opt.mc]));
  const arr = await getJSON(`${API}/project/${encodeURIComponent(id)}/version?${p}`, 20000, UA);
  const list = (arr || []).filter((v) => v.files && v.files.length);
  return list.map((v) => {
    const f = v.files.find((x) => x.primary) || v.files[0];
    return {
      id: v.id,
      name: v.name || v.version_number,
      version: v.version_number,
      url: f.url,
      filename: f.filename,
      size: f.size,
      sha1: (f.hashes && f.hashes.sha1) || '',
      loaders: v.loaders || [],
      gameVersions: v.game_versions || [],
      type: v.version_type || 'release'
    };
  });
}

/** 下载安装到对应目录（mods / resourcepacks / shaderpacks） */
async function install(opt, onProgress) {
  const vs = await versions(opt.id, { mc: opt.mc, loader: opt.loader });
  if (!vs.length) throw new Error('没有与当前 MC 版本 / 加载器匹配的可用版本');

  const pick = vs.find((v) => v.type === 'release') || vs[0];
  const dirName = TYPE_DIR[opt.type] || 'mods';
  const dir = path.join(opt.gameDir, dirName);
  await ensureDir(dir);
  const fileName = safeFileName(pick.filename);
  if (!fileName) throw new Error('下载地址返回了非法的文件名');
  const dest = path.join(dir, fileName);
  if (path.dirname(path.resolve(dest)) !== path.resolve(dir)) throw new Error('非法的安装路径');

  await download([pick.url], dest, (d, t) => onProgress && onProgress({
    phase: `下载${TYPE_LABEL[opt.type] || '文件'}`, name: fileName, done: d, total: t, current: 0, count: 1
  }), { timeout: 120000, sha1: pick.sha1 || undefined });

  return { file: fileName, dir: dirName, version: pick.version, size: pick.size };
}

module.exports = { search, versions, install, TYPE_DIR, TYPE_LABEL };
