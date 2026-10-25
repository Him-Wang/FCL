/* 把 CustomSkinLoader 的常见构建下载到 assets/csl/，并生成 manifest.json
 * 这样启动器自带模组，用户不联网也能「设皮肤 → 进游戏就生效」。
 * 运行：node tools/fetch-csl.js
 */
const fs = require('fs');
const path = require('path');

const UA = 'FMCL/1.0.0 (FishMineCraftLauncher)';
const API = 'https://api.modrinth.com/v2/project/customskinloader/version';

// 目标：(版本号, 必须包含的 loader, 保存文件名)
const TARGETS = [
  { version: '15.1-Universal', loader: 'fabric', save: 'CustomSkinLoader_Universal-15.1.jar' },
  { version: '14.28-Universal', loader: 'fabric', games: ['26.'], save: 'CustomSkinLoader_Universal-14.28-26x.jar' },
  { version: '14.28-Universal', loader: 'forge', games: ['1.2'], save: 'CustomSkinLoader_Universal-14.28-1.20plus.jar' },
  { version: '14.28-Fabric', loader: 'fabric', save: 'CustomSkinLoader_Fabric-14.28.jar' },
  { version: '14.27-ForgeV1', loader: 'forge', save: 'CustomSkinLoader_ForgeV1-14.27.jar' },
  { version: '14.28-ForgeV2', loader: 'forge', save: 'CustomSkinLoader_ForgeV2-14.28.jar' },
  { version: '14.27-ForgeV3', loader: 'forge', save: 'CustomSkinLoader_ForgeV3-14.27.jar' },
];

(async () => {
  const res = await fetch(API, { headers: { 'User-Agent': UA } });
  const all = await res.json();
  const outDir = path.join(__dirname, '..', 'assets', 'csl');
  fs.mkdirSync(outDir, { recursive: true });
  const manifest = [];

  for (const t of TARGETS) {
    const cand = all.filter((v) => {
      if (v.version_number !== t.version) return false;
      if (!(v.loaders || []).includes(t.loader)) return false;
      if (t.games) {
        const g = v.game_versions || [];
        if (!g.some((x) => t.games.some((p) => x.startsWith(p)))) return false;
      }
      return true;
    });
    if (!cand.length) {
      console.log('MISS', t.version, t.loader);
      continue;
    }
    const v = cand[0];
    const f = (v.files || []).find((x) => x.primary) || (v.files || [])[0];
    if (!f) continue;
    const dest = path.join(outDir, t.save);
    const bin = Buffer.from(await (await fetch(f.url, { headers: { 'User-Agent': UA } })).arrayBuffer());
    fs.writeFileSync(dest, bin);
    manifest.push({
      file: t.save,
      loaders: v.loaders || [],
      games: v.game_versions || [],
      version: v.version_number,
      size: bin.length,
    });
    console.log('OK  ', t.save, (bin.length / 1024).toFixed(0) + 'KB', 'loaders:', (v.loaders || []).join(','), 'games:', (v.game_versions || []).length);
  }

  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({ project: 'customskinloader', items: manifest }, null, 2), 'utf8');
  console.log('manifest ->', path.join(outDir, 'manifest.json'), manifest.length, 'items');
})();
