const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { exec, spawn } = require('child_process');

const { Version, launch, createMinecraftProcessWatcher } = require('@xmcl/core');
const installer = require('./lib/installer');
const modstore = require('./lib/modstore');
const cnmod = require('./lib/cnmod');
const ms = require('./lib/microsoft');
const javaRuntime = require('./lib/java');
const localskin = require('./lib/localskin');

/* ============================================================
 * 便携根目录：exe 旁边的 FCL\ 文件夹
 *   FCL\data   —— 设置 / 账号 / 皮肤库（Electron userData）
 *   FCL\game   —— 游戏目录（versions / mods / assets / libraries / options.txt）
 *   FCL\java   —— 一键部署的 Java 运行时
 * 也可以在设置里改成别的盘（写入 FCL\config.json 的 root，重启生效）。
 * ============================================================ */
const APP_DIR_NAME = 'FCL';

function canWrite(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, '.fcl-write-test');
    fs.writeFileSync(probe, '1');
    fs.unlinkSync(probe);
    return true;
  } catch (e) {
    return false;
  }
}

/** 便携 exe 真实所在目录（electron-builder portable 会用 PORTABLE_EXECUTABLE_DIR 告诉我们） */
function portableExeDir() {
  // macOS 的 .app 在签名后是只读的，不能把数据写进 bundle，统一放到 ~/Library/Application Support
  if (process.platform === 'darwin') {
    try {
      return path.join(app.getPath('appData'), 'FCL-Portable');
    } catch (e) {}
  }
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR;
  try {
    if (app.isPackaged) return path.dirname(app.getPath('exe'));
  } catch (e) {}
  return __dirname;
}

const defaultRoot = process.platform === 'darwin' ? portableExeDir() : path.join(portableExeDir(), APP_DIR_NAME);
const rootPointer = path.join(defaultRoot, 'config.json');

/** 决定根目录：exe 旁默认 → config.json 覆盖 → 不可写就退回 %APPDATA% */
function resolveRoot() {
  let root = defaultRoot;
  try {
    if (fs.existsSync(rootPointer)) {
      const cfg = JSON.parse(fs.readFileSync(rootPointer, 'utf8'));
      if (cfg && typeof cfg.root === 'string' && cfg.root.trim() && canWrite(cfg.root)) root = path.resolve(cfg.root.trim());
    }
  } catch (e) {}
  if (!canWrite(root)) {
    const fallback = path.join(app.getPath('appData') || path.join(os.homedir(), 'AppData', 'Roaming'), APP_DIR_NAME);
    if (canWrite(fallback)) root = fallback;
  }
  return root;
}

let ROOT = resolveRoot();
const DATA_DIR = path.join(ROOT, 'data');
const GAME_DIR = path.join(ROOT, 'game');
const JAVA_DIR = path.join(ROOT, 'java');
const LOG_DIR = path.join(ROOT, 'logs');
const TEMP_DIR = path.join(ROOT, 'temp');

try {
  for (const d of [DATA_DIR, GAME_DIR, JAVA_DIR, LOG_DIR, path.join(LOG_DIR, 'crash'), TEMP_DIR, path.join(DATA_DIR, 'Cache')]) {
    fs.mkdirSync(d, { recursive: true });
  }
  // 设置 / 账号 / 皮肤 / Chromium 缓存全部落在 FCL\data，不再写 C 盘用户目录
  app.setPath('userData', DATA_DIR);
  app.setPath('sessionData', DATA_DIR);
  try {
    app.setPath('logs', LOG_DIR);
  } catch (e) {}
  try {
    app.setPath('crashDumps', path.join(LOG_DIR, 'crash'));
  } catch (e) {}
  try {
    app.setPath('temp', TEMP_DIR);
  } catch (e) {}
  // 子进程（游戏 / Forge 安装器 / 解压）也用 FCL\temp，别往系统临时目录丢东西
  process.env.TEMP = TEMP_DIR;
  process.env.TMP = TEMP_DIR;
  app.commandLine.appendSwitch('disk-cache-dir', path.join(DATA_DIR, 'Cache'));
  // 微软登录需要跨站 Cookie（login.live.com <-> account.live.com），Chromium 新版默认拦截会让
  // OAuth 回调变成 server_error / "contextID ... no matching cookie"，这里显式关掉该实验特性。
  app.commandLine.appendSwitch(
    'disable-features',
    'TrackingProtection3pcd,ThirdPartyCookieDeprecation,ThirdPartyStoragePartitioning,StorageAccessAPI',
  );
} catch (e) {}


/** 首次运行：把旧数据搬进便携目录（设置/账号/皮肤、已部署的 Java、旧 .minecraft） */
function migrateLegacyData() {
  const appData = app.getPath('appData') || path.join(os.homedir(), 'AppData', 'Roaming');
  const legacyAppDirs = ['FMCL', '肥鱼启动器', '大肥鱼启动器']
    .map((n) => path.join(appData, n))
    .filter((d) => fs.existsSync(d) && path.resolve(d) !== path.resolve(ROOT));

  // 1) 设置 / 账号 / 皮肤（Electron 的 Local Storage）
  if (!fs.existsSync(path.join(DATA_DIR, 'Local Storage')) && legacyAppDirs.length) {
    for (const oldDir of legacyAppDirs) {
      for (const sub of ['Local Storage', 'Preferences', 'skins']) {
        const from = path.join(oldDir, sub);
        if (!fs.existsSync(from)) continue;
        try {
          fs.cpSync(from, path.join(DATA_DIR, sub), { recursive: true });
        } catch (e) {}
      }
      if (fs.existsSync(path.join(DATA_DIR, 'Local Storage'))) break;
    }
  }

  // 2) 已部署的 Java
  if (!fs.existsSync(path.join(JAVA_DIR, 'jdk-25')) && !fs.existsSync(path.join(JAVA_DIR, 'jdk-21'))) {
    for (const oldDir of legacyAppDirs) {
      const from = path.join(oldDir, 'runtime');
      if (!fs.existsSync(from)) continue;
      try {
        fs.cpSync(from, JAVA_DIR, { recursive: true });
        break;
      } catch (e) {}
    }
  }

  // 3) 旧 .minecraft 不自动搬（1GB+ 的文件，误操作代价太大）：
  //    如果 FCL\game 还是空的，就继续沿用旧的 .minecraft 作为默认游戏目录，
  //    用户可以在设置里点「迁移到 FCL\game」再显式搬过来。
}

try {
  migrateLegacyData();
} catch (e) {}


/* 渲染/GPU 相关开关：
 * 早期为了在无 GPU、带沙箱的受限环境里也能跑，强行加了 no-sandbox / disable-gpu /
 * in-process-gpu / 禁用软件光栅。这些在真实机器上会显著增加闪退概率（GPU 进程直接
 * 跑在主进程里，一旦上下文创建失败整个应用就退出），这里改成默认不干预，
 * 只有设置里明确要求「窗口背景透明」时才把窗口做成 transparent。 */
let UI_CFG = {};
try {
  if (fs.existsSync(rootPointer)) UI_CFG = JSON.parse(fs.readFileSync(rootPointer, 'utf8')) || {};
} catch (e) {}
/** 写 FCL\config.json：合并而不是覆盖，避免把 root 等字段冲掉 */
function patchCfg(patch) {
  try {
    fs.mkdirSync(defaultRoot, { recursive: true });
    let cfg = {};
    try {
      cfg = JSON.parse(fs.readFileSync(rootPointer, 'utf8')) || {};
    } catch (e) {}
    Object.assign(cfg, patch || {});
    fs.writeFileSync(rootPointer, JSON.stringify(cfg, null, 2), 'utf8');
    Object.assign(UI_CFG, cfg);
    return true;
  } catch (e) {
    log('warn', '写配置失败：' + (e.message || e));
    return false;
  }
}

const USE_TRANSPARENT = UI_CFG.transparent !== false; // 默认开启；只有配置文件里显式写 false 才用不透明窗口

/* 设置里切换「窗口背景透明」：写进 config.json，重启后生效 */
ipcMain.handle('app:set-close-ask', async (_e, val) => {
  const ok = patchCfg({ closeAskEach: !!val, closeAskV: 2, ...(val ? { closeAsked: false } : { closeAsked: true }) });
  return ok ? { ok: true, closeAskEach: !!val } : { ok: false, error: '写入 config.json 失败' };
});

ipcMain.handle('app:set-tray', async (_e, val) => {
  const ok = patchCfg({ minimizeToTray: !!val });
  return ok ? { ok: true, minimizeToTray: !!val } : { ok: false, error: '写入 config.json 失败' };
});

// 受限环境（无 GPU 驱动）自动回退到软件渲染，而不是硬性禁用 GPU
if (process.env.FCL_SOFTWARE_RENDER === '1') {
  app.disableHardwareAcceleration();
}

let win = null;
let tray = null;
let quitting = false; // 真正退出（而不是隐藏到托盘）
let gameProcess = null;
let gameWindowReady = false;

// 日志里别写完整用户目录，截图/分享时更干净
function shortPath(p) {
  const home = os.homedir();
  const s = String(p || '');
  return home && s.toLowerCase().startsWith(home.toLowerCase()) ? '~' + s.slice(home.length) : s;
}

function send(channel, payload) {
  // 窗口可能已经被销毁（关闭/重开），往已销毁的 webContents 发消息会抛
  // "Object has been destroyed"，下载进度是异步的，很容易撞上
  try {
    if (!win || win.isDestroyed()) return;
    const wc = win.webContents;
    if (!wc || wc.isDestroyed()) return;
    wc.send(channel, payload);
  } catch (e) {}
}
function log(lv, msg) {
  send('mc:log', { lv, msg });
  // 同时落到 FCL\logs\app.log，窗口关掉之后也能查
  try {
    fs.appendFileSync(path.join(LOG_DIR, 'app.log'), `[${new Date().toISOString()}] [${lv}] ${msg}\n`, 'utf8');
  } catch (e) {}
}

/* 主进程的未捕获异常不要弹「A JavaScript error occurred in the main process」对话框，
   记进日志继续跑（典型场景：下载进度回调时窗口已经关了） */
process.on('uncaughtException', (err) => {
  try {
    fs.appendFileSync(path.join(LOG_DIR, 'app.log'), `[${new Date().toISOString()}] [fatal] ${err && err.stack ? err.stack : err}\n`, 'utf8');
  } catch (e) {}
});
process.on('unhandledRejection', (reason) => {
  try {
    fs.appendFileSync(path.join(LOG_DIR, 'app.log'), `[${new Date().toISOString()}] [reject] ${reason && reason.stack ? reason.stack : reason}\n`, 'utf8');
  } catch (e) {}
});

/** 第二个实例被单实例锁挡掉时，让已有窗口弹出来并提示一句 */
function notifyAlreadyRunning() {
  if (!win || win.isDestroyed()) return;
  log('info', '检测到重复启动：已把已有窗口切回前台并提示');
  const fire = () => send('app:already-running', true);
  try {
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', fire);
    else fire();
  } catch (e) {}
}

function createWindow() {
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return win;
  }
  win = new BrowserWindow({
    width: 1020,
    height: 680,
    minWidth: 880,
    minHeight: 580,
    frame: false,
    show: !process.env.CL_SMOKE,
    icon: path.join(__dirname, 'build', 'icon.ico'),
    backgroundColor: USE_TRANSPARENT ? '#00000000' : '#f4f6f9',
    transparent: USE_TRANSPARENT,
    title: 'FCL',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  /* 磨砂：默认只用 CSS backdrop-filter，窗口保持全透明，圆角外能透出桌面。
   * 系统级 Acrylic 会给整个窗口矩形铺一层不透明背景，导致圆角外露出灰块，
   * 所以只在配置文件里显式写 { "acrylic": true } 时才启用。 */
  if (process.platform === 'win32' && UI_CFG.acrylic === true) {
    try {
      const build = Number((os.release().split('.')[2] || '0'));
      if (build >= 22000 && typeof win.setBackgroundMaterial === 'function') {
        win.setBackgroundMaterial('acrylic');
        log('info', '已启用系统亚克力（圆角外可能出现背景色块）');
      }
    } catch (e) {
      log('warn', '启用亚克力失败：' + (e.message || e));
    }
  }

win.webContents.on('preload-error', (_e, p, err) => {
  log('error', 'preload 加载失败：' + p + ' ' + (err && err.message));
});

win.loadFile(path.join(__dirname, 'index.html'));

/* 闪退排查：把渲染进程/GPU 子进程的意外退出、窗口关闭都记进 FCL\logs\app.log */
win.webContents.on('render-process-gone', (_e, details) => {
  log('error', `渲染进程退出：${details.reason}（exitCode ${details.exitCode}）`);
});
win.webContents.on('unresponsive', () => log('warn', '窗口无响应'));
win.webContents.on('responsive', () => log('info', '窗口恢复响应'));
win.on('closed', () => {
  log('warn', '主窗口已关闭');
  win = null;
});

  if (process.env.CL_SMOKE) {
    win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      console.log(`[renderer:${level}] ${message} @${sourceId}:${line}`);
    });    win.webContents.on('did-finish-load', () => {
      console.log('[smoke] did-finish-load');
      setTimeout(async () => {
        try {
          const r = await win.webContents.executeJavaScript(`(() => ({
            version: document.querySelector('#verName').textContent,
            tabs: document.querySelectorAll('#verTabs .tab').length,
            rows: document.querySelectorAll('#verList .row-item').length,
            chips: document.querySelectorAll('#envBar .chip').length,
            logs: document.querySelectorAll('.log-line').length,
            mods: document.querySelectorAll('#modList .row-item').length,
            fish: document.querySelectorAll('use[href="#i-fish"]').length,
            fab: document.querySelectorAll('#themeFab').length,
            storeRows: document.querySelectorAll('#storeList .row-item').length,
            onlineMods: document.querySelectorAll('#modOnlineList .row-item').length,
            queueRows: document.querySelectorAll('#queueList .q-row').length,
            queueStat: (document.querySelector('#queueStat') || {}).textContent || '',
            javaState: (document.querySelector('#javaState') || {}).textContent || ''
          }))()`);
          console.log('[smoke] dom ' + JSON.stringify(r));
          const r2 = await win.webContents.executeJavaScript(`(() => {
            const out = {};
            const g = (n) => getComputedStyle(document.body).getPropertyValue(n).trim();
            const cs = () => getComputedStyle(document.body);
            const setMode = (m) => {
              const fab = document.querySelector('#themeFab');
              let guard = 0;
              while (fab.dataset.mode !== m && guard++ < 4) fab.click();
            };
            const probe = (k) => { out[k] = document.body.className + ' | ' + g('--accent-fill') + ' | bg ' + cs().backgroundColor; };
            setMode('light');
            probe('light');
            setMode('dark');
            probe('dark');
            setMode('system');
            out.sysMode = document.querySelector('#themeFab').dataset.mode + ' | ' +
              document.body.className + ' | sys=' + window.matchMedia('(prefers-color-scheme: dark)').matches;
            out.fab = document.querySelectorAll('#themeFab').length;
            setMode('light');
            return out;
          })()`);
          if (process.env.CL_SHOT) {
            win.setSize(1020, 700);
            win.show();
            const shot = async (name, sel) => {
              if (sel) await win.webContents.executeJavaScript(
                `(() => { const b = document.querySelector('${sel}'); if (b) b.click(); })()`);
              await new Promise((r) => setTimeout(r, 600));
              const img = await win.webContents.capturePage();
              require('fs').writeFileSync(path.join(__dirname, 'shots', name + '.png'), img.toPNG());
              console.log('[smoke] shot ' + name);
            };
            try { require('fs').mkdirSync(path.join(__dirname, 'shots'), { recursive: true }); } catch (e) {}
            const clickMode = async (m) => win.webContents.executeJavaScript(
              `document.querySelector('#themeFab').click()`);
            await shot('ui-light', '#themeFab');
            await clickMode('dark');
            await shot('workbuddy-dark', null);
            await shot('ui-dark', '#themeFab');
            await clickMode('light');
            await shot('classic-light', null);
            await shot('ui-system', '#themeFab');
            await clickMode('dark');
            await shot('dark-launch', null);
            await clickMode('light');
            await shot('light-settings', '[data-page="settings"]');
          }
        } catch (e) {
          console.log('[smoke] dom error ' + e.message);
        }
      }, 5000);
    });
  }

  // 队列自检：CL_QUEUE_TEST=1 时一次性排 4 个安装，确认同时只有 3 个在跑
  if (process.env.CL_QUEUE_TEST) {
    win.webContents.on('did-finish-load', () => {
      setTimeout(() => {
        const dir = process.env.CL_QUEUE_DIR || path.join(os.tmpdir(), 'dsl-queue-test');
        ['26.3', '26.4-snapshot-5', '1.21.4', '1.21.1'].forEach((id) =>
          enqueueInstall({ kind: 'vanilla', id, gameDir: dir, assets: false }));
        setTimeout(() => {
          const snap = queueSnapshot();
          console.log('[queue-test] ' + snap.map((t) => `${t.title}=${t.status}`).join(', '));
          console.log('[queue-test] running=' + snap.filter((t) => t.status === 'running').length + ' queued=' + snap.filter((t) => t.status === 'queued').length);
          app.quit();
        }, 6000);
      }, 1500);
    });
  }

  // UI 截图自检：CL_SHOT_UI=1 时逐页截图到 shots/ui-*.png
  if (process.env.CL_SHOT_UI) {
    win.webContents.on('did-finish-load', async () => {
      // 打包后 __dirname 在 asar 里，只能写到 userData；开发时仍写项目内 shots/
      const dir = app.isPackaged ? path.join(app.getPath('userData'), 'shots') : path.join(__dirname, 'shots');
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (e) {}
      console.log('[ui-shot] 输出目录：' + dir);
      const cap = async (name) => {
        await new Promise((r) => setTimeout(r, 900));
        const active = await win.webContents.executeJavaScript(
          `(document.querySelector('.nav-item.active') || {}).textContent || '?'`,
        );
        const img = await win.webContents.capturePage();
        fs.writeFileSync(path.join(dir, name + '.png'), img.toPNG());
        console.log('[ui-shot] ' + name + ' (页面：' + active.trim() + ')');
      };
      const run = (js) => win.webContents.executeJavaScript(js);
      try {
        win.setSize(1020, 700);
        if (process.env.CL_SHOT_OFFSCREEN) {
          win.setPosition(-4000, 0);
          win.showInactive();
        } else {
          win.show();
        }
        await new Promise((r) => setTimeout(r, 1500));

        // CL_SHOT_ONLY=pages：只截指定页面，用导航文字定位，最稳
        if (process.env.CL_SHOT_ONLY) {
          const list = String(process.env.CL_SHOT_ONLY).split(',').map((s) => s.trim()).filter(Boolean);
          const label = { launch: '启动游戏', versions: '版本管理', store: '材质包', mods: '模组管理', accounts: '账号管理', settings: '设置' };
          await run(`(() => { const s = document.createElement('style'); s.textContent = '.toast{display:none!important}'; document.head.appendChild(s); })()`);
          // 统一成「默认主题 + 浅色」，这样每张截图配色一致
          await run(`document.querySelector('#themeFab').click()`);
          await run(`document.querySelector('#themeFab').click()`);
          await new Promise((r) => setTimeout(r, 900));
          for (const page of list) {
            await run(`(() => { const items = Array.from(document.querySelectorAll('.nav-item')); const b = items.find((x) => x.textContent.includes(${JSON.stringify(label[page] || page)})); if (b) b.click(); return !!b; })()`);
            await new Promise((r) => setTimeout(r, 2600));
            win.webContents.invalidate();
            await new Promise((r) => setTimeout(r, 400));
            await cap('only-' + page);
          }
          console.log('[ui-shot] only done');
          setTimeout(() => app.quit(), 800);
          return;
        }

        // CL_SHOT_CLEAN：只截干净的页面（不切主题、不点启动，避免 toast 和环境差异）
        if (process.env.CL_SHOT_CLEAN) {
          const go = async (page, name) => {
            await run(`document.querySelector('[data-page="${page}"]').click()`);
            await run(`document.querySelector('.content').scrollTop = 0`);
            await new Promise((r) => setTimeout(r, 1100));
            await cap(name);
          };
          await run(`(() => { const s = document.createElement('style'); s.textContent = '.toast{display:none!important}'; document.head.appendChild(s); })()`);
          await run(`document.querySelector('[data-act="preset"][data-id="default"]') && document.querySelector('#themeFab').click()`);
          await run(`document.querySelector('[data-act="mode"][data-id="light"]') && document.querySelector('#themeFab').click()`);
          await new Promise((r) => setTimeout(r, 900));
          try { win.setAlwaysOnTop(true, 'screen-saver'); win.focus(); win.moveTop(); } catch (e) {}
          await new Promise((r) => setTimeout(r, 600));
          await go('launch', 'clean-1-launch');
          await go('versions', 'clean-2-versions');
          await go('mods', 'clean-3-mods');
          await run(`document.querySelector('[data-page="store"]').click(); document.querySelector('[data-act="store-tab"][data-id="resourcepack"]').click()`);
          await new Promise((r) => setTimeout(r, 1400));
          await cap('clean-4-packs');
          await go('accounts', 'clean-5-skin');
          await go('settings', 'clean-6-settings');
          await run(`document.querySelector('.content').scrollTop = 99999`);
          await new Promise((r) => setTimeout(r, 800));
          await cap('clean-7-settings-bottom');
          await run(`document.querySelector('#themeFab').click()`);
          await new Promise((r) => setTimeout(r, 1200));
          await go('launch', 'clean-8-launch-dark');
          await run(`document.querySelector('#themeFab').click()`);
          await new Promise((r) => setTimeout(r, 900));
          await run(`document.querySelector('#themeFab').click()`);
          await new Promise((r) => setTimeout(r, 1000));
          await go('launch', 'clean-9-theme-classic');
          await run(`document.querySelector('#themeFab').click()`);
          await new Promise((r) => setTimeout(r, 1000));
          await go('launch', 'clean-10-theme-workbuddy');
          console.log('[ui-shot] clean done');
          setTimeout(() => app.quit(), 1200);
          return;
        }

        await run(`document.querySelector('[data-page="launch"]').click()`);
        await cap('ui-1-launch');        await run(`document.querySelector('[data-page="versions"]').click()`);
        await cap('ui-2-versions');
        await run(`document.querySelector('[data-page="mods"]').click()`);
        await cap('ui-3-mods');
        await run(`document.querySelector('[data-page="store"]').click(); document.querySelector('[data-act="store-tab"][data-id="resourcepack"]').click()`);
        await cap('ui-3b-packs');
        await run(`document.querySelector('[data-act="store-tab"][data-id="shader"]').click()`);
        await cap('ui-3c-shaders');
        await run(`document.querySelector('[data-page="accounts"]').click()`);
        await cap('ui-4-accounts');
        await run(`document.querySelector('[data-page="settings"]').click()`);
        await cap('ui-5-settings');
        await run(`document.querySelector('.content').scrollTop = 99999`);
        await cap('ui-5b-settings-bottom');
        await run(`document.querySelector('[data-page="launch"]').click()`);
        await run(`document.querySelector('#verCard').click()`);
        await cap('ui-6-picker');
        await run(`document.querySelector('#modalClose').click(); document.querySelector('#launchBtn').click()`);
        await cap('ui-7-launching');
        // 最后恢复成默认主题 + 浅色，补一张浅色首屏
        await run(`document.querySelector('[data-act="preset"][data-id=""]') && document.querySelector('#themeFab').click()`);
        await run(`document.querySelector('[data-act="mode"][data-id="light"]') && document.querySelector('#themeFab').click()`);
        await new Promise((r) => setTimeout(r, 600));
        await cap('ui-9-light');
        console.log('[ui-shot] done');
      } catch (e) {
        console.log('[ui-shot] error ' + e.message);
      }
      setTimeout(() => app.quit(), 2500);
    });
  }

  // 启动自检：CL_LAUNCH_TEST=1 时自动点「启动游戏」，汇报游戏进程 / 窗口 / 崩溃情况
  if (process.env.CL_LAUNCH_TEST) {
    win.webContents.on('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, 2500));
      await win.webContents.executeJavaScript('document.querySelector("#launchBtn").click()');
      const wait = Number(process.env.CL_LAUNCH_WAIT || 45) * 1000;
      const t0 = Date.now();
      while (Date.now() - t0 < wait) {
        await new Promise((r) => setTimeout(r, 1000));
        if (gameWindowReady) break;
      }
      console.log(
        '[launch-test] ' +
          JSON.stringify({
            running: !!gameProcess,
            windowReady: gameWindowReady,
            seconds: Math.round((Date.now() - t0) / 1000),
            crash: readLatestCrash(process.env.CL_GAME_DIR || path.join(process.env.APPDATA || '', '.minecraft')),
          }),
      );
      try {
        const tail = await win.webContents.executeJavaScript(
          `Array.from(document.querySelectorAll('#log .log-line')).slice(-10).map(e => e.textContent.trim()).join('\\n')`,
        );
        console.log('[launch-test] 日志尾部：\n' + tail);
        const btn = await win.webContents.executeJavaScript(`document.querySelector('#launchText').textContent`);
        console.log('[launch-test] 按钮状态：' + btn);
      } catch (e) {}
      if (gameProcess) {
        try {
          gameProcess.kill();
        } catch (e) {}
      }
      setTimeout(() => app.quit(), 1500);
    });
  }

  // 删除版本自检：CL_DEL_TEST=<版本目录父路径> 时，通过渲染层 IPC 真实删除一个测试版本
  if (process.env.CL_DEL_TEST) {
    win.webContents.on('did-finish-load', async () => {
      const dir = process.env.CL_DEL_TEST;
      const id = 'zz-del-test';
      try {
        fs.mkdirSync(path.join(dir, 'versions', id), { recursive: true });
        fs.writeFileSync(path.join(dir, 'versions', id, id + '.json'), '{}');
        console.log('[del-test] created:', path.join(dir, 'versions', id));
        const r = await win.webContents.executeJavaScript(
          `window.launcher.deleteVersion({ id: ${JSON.stringify(id)}, gameDir: ${JSON.stringify(dir)} })`,
        );
        console.log('[del-test] result:', JSON.stringify(r));
        console.log('[del-test] exists after delete:', fs.existsSync(path.join(dir, 'versions', id)));
        const bad = await win.webContents
          .executeJavaScript(`window.launcher.deleteVersion({ id: '../escape', gameDir: ${JSON.stringify(dir)} })`)
          .catch((e) => ({ error: String(e.message || e) }));
        console.log('[del-test] path traversal blocked:', JSON.stringify(bad));
      } catch (e) {
        console.log('[del-test] error:', e.message);
      }
      setTimeout(() => app.quit(), 800);
    });
  }

  // 导入自检：CL_IMPORT_TEST=<gameDir> 时造几个假文件，通过渲染层 IPC 真实导入
  if (process.env.CL_IMPORT_TEST) {
    win.webContents.on('did-finish-load', async () => {
      const dir = process.env.CL_IMPORT_TEST;
      try {
        const tmp = path.join(os.tmpdir(), 'dsl-import-test');
        fs.rmSync(tmp, { recursive: true, force: true });
        fs.mkdirSync(tmp, { recursive: true });
        const files = ['jei-test.jar', 'Sodium-test.zip', 'readme.txt'].map((n) => path.join(tmp, n));
        files.forEach((f) => fs.writeFileSync(f, 'x'));
        fs.mkdirSync(path.join(dir, 'resourcepacks'), { recursive: true });
        const r1 = await win.webContents.executeJavaScript(
          `window.launcher.importContent({ gameDir: ${JSON.stringify(dir)}, type: 'mod', files: ${JSON.stringify(files)} })`,
        );
        const r2 = await win.webContents.executeJavaScript(
          `window.launcher.importContent({ gameDir: ${JSON.stringify(dir)}, type: 'resourcepack', files: ${JSON.stringify([files[1]])} })`,
        );
        console.log('[import-test] mod ->', JSON.stringify(r1));
        console.log('[import-test] pack ->', JSON.stringify(r2));
        console.log('[import-test] mods dir:', fs.readdirSync(path.join(dir, 'mods')).join(', '));
        console.log('[import-test] options.txt:', fs.readFileSync(path.join(dir, 'options.txt'), 'utf8').trim());
      } catch (e) {
        console.log('[import-test] error:', e.message);
      }
      setTimeout(() => app.quit(), 800);
    });
  }

  // 皮肤面板自检：CL_SKIN_TEST=<png 路径> 时把皮肤塞进当前账号并截图
  if (process.env.CL_SKIN_TEST) {
    let skinTestPhase = 0; // 0=注入并刷新, 1=刷新后截图（避免 did-finish-load 递归）
    win.webContents.on('did-finish-load', async () => {
      const dir = path.join(__dirname, 'shots');
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (e) {}
      try {
        if (skinTestPhase === 0) {
          skinTestPhase = 1;
          const buf = fs.readFileSync(process.env.CL_SKIN_TEST);
          const dataUrl = 'data:image/png;base64,' + buf.toString('base64');
          await new Promise((r) => setTimeout(r, 1200));
          await win.webContents.executeJavaScript(`(() => {
            const k = 'craftlauncher.v1';
            const d = JSON.parse(localStorage.getItem(k) || '{}');
            if (Array.isArray(d.accounts) && d.accounts.length) {
              d.accounts[0].skin = { variant: 'slim', dataUrl: ${JSON.stringify(dataUrl)} };
              localStorage.setItem(k, JSON.stringify(d));
            }
            return 1;
          })()`);
          await win.webContents.executeJavaScript('location.reload()');
          return;
        }
        await new Promise((r) => setTimeout(r, 2600));
        win.setSize(1020, 700);
        win.show();
        await win.webContents.executeJavaScript(`document.querySelector('[data-page="accounts"]').click()`);
        await new Promise((r) => setTimeout(r, 900));
        const img = await win.webContents.capturePage();
        fs.writeFileSync(path.join(dir, 'ui-8-skin.png'), img.toPNG());
        console.log('[skin-test] captured ui-8-skin.png');
      } catch (e) {
        console.log('[skin-test] error: ' + e.message);
      }
      setTimeout(() => app.quit(), 600);
    });
  }

  // 离线皮肤自检：CL_CSL_TEST=<gameDir> 时走一遍「装 CSL + 写皮肤 + 改配置」的完整链路
  if (process.env.CL_CSL_TEST) {
    win.webContents.on('did-finish-load', async () => {
      const gd = process.env.CL_CSL_TEST;
      try {
        const skinPath = process.env.CL_CSL_SKIN;
        const dataUrl = skinPath && fs.existsSync(skinPath)
          ? 'data:image/png;base64,' + fs.readFileSync(skinPath).toString('base64')
          : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAFklEQVR42u3BAQ0AAADCoPdPbQ43oAAAAAAAAAAAAAAA4N8AGLwAAZ1cJ6UAAAAASUVORK5CYII=';
        const r = await win.webContents.executeJavaScript(
          `window.launcher.enableLocalSkin({ gameDir: ${JSON.stringify(gd)}, playerName: 'Hermintway_', mc: '26.3', loader: 'fabric', dataUrl: ${JSON.stringify(dataUrl)} })`,
        );
        console.log('[csl-test] result:', JSON.stringify(r));
        console.log('[csl-test] mods:', fs.readdirSync(path.join(gd, 'mods')).join(', '));
        const skin = path.join(gd, 'CustomSkinLoader', 'LocalSkin', 'skins', 'Hermintway_.png');
        console.log('[csl-test] skin file:', fs.existsSync(skin), fs.existsSync(skin) ? fs.statSync(skin).size + 'B' : '');
      } catch (e) {
        console.log('[csl-test] error:', e.message);
      }
      setTimeout(() => app.quit(), 800);
    });
  }

  // 皮肤库自检：CL_SKINLIB_TEST=<png> 走一遍 add / list / 去重 / apply / delete
  if (process.env.CL_SKINLIB_TEST) {
    win.webContents.on('did-finish-load', async () => {
      const js = (code) => win.webContents.executeJavaScript(code);
      try {
        const dataUrl = 'data:image/png;base64,' + fs.readFileSync(process.env.CL_SKINLIB_TEST).toString('base64');
        const a1 = await js(`window.launcher.skinsAdd({ dataUrl: ${JSON.stringify(dataUrl)}, name: '测试皮肤A' })`);
        const a2 = await js(`window.launcher.skinsAdd({ dataUrl: ${JSON.stringify(dataUrl)}, name: '测试皮肤A' })`);
        const list = await js(`window.launcher.skinsList()`);
        const apply = await js(
          `window.launcher.skinsApply({ gameDir: ${JSON.stringify(path.join(os.tmpdir(), 'dsl-skinlib-test'))}, playerName: 'Hermintway_', dataUrl: ${JSON.stringify(dataUrl)} })`,
        );
        console.log('[skinlib] add1:', JSON.stringify(a1));
        console.log('[skinlib] add2(去重):', JSON.stringify(a2), '同 id:', a1.id === a2.id);
        console.log('[skinlib] list:', list.length, '条', list.map((x) => x.name).join(', '));
        console.log('[skinlib] apply(未装 CSL):', JSON.stringify(apply));
        await js(`window.launcher.skinsDelete({ id: ${JSON.stringify(a1.id)} })`);
        const after = await js(`window.launcher.skinsList()`);
        console.log('[skinlib] delete 后剩余:', after.length);
      } catch (e) {
        console.log('[skinlib] error:', e.message);
      }
      setTimeout(() => app.quit(), 800);
    });
  }

  // 调试：CL_EVAL="<js 表达式>" 在渲染层求值并打印结果
  if (process.env.CL_EVAL) {
    win.webContents.on('did-finish-load', async () => {
      try {
        await new Promise((r) => setTimeout(r, 1500));
        const out = await win.webContents.executeJavaScript(process.env.CL_EVAL);
        console.log('[eval] ' + JSON.stringify(out));
        console.log('[eval] opacity=' + win.getOpacity());
      } catch (e) {
        console.log('[eval] error: ' + e.message);
      }
      setTimeout(() => app.quit(), 300);
    });
  }

  ipcMain.on('win:minimize', () => win.minimize());
  ipcMain.on('win:setOpacity', (_e, v) => {
    const n = Math.max(0.3, Math.min(1, Number(v) || 1));
    try {
      win.setOpacity(n);
    } catch (e) {}
  });
  ipcMain.on('win:maximize', () => (win.isMaximized() ? win.unmaximize() : win.maximize()));
  ipcMain.on('win:close', () => win.close());
  // 托盘关闭策略：点 × 只是隐藏，托盘菜单里才有「退出」
  const hideToTray = () => {
    win.hide();
    if (tray && !tray.__hinted) {
      tray.__hinted = true;
      log('info', '已最小化到托盘（右键托盘图标可退出）');
      send('tray:hint', true);
    }
  };

  // 第一次关闭：在应用内弹窗问「最小化还是退出」，用户在界面里点选
  let closeAskedPending = false;
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();

    // 已经问过（且是当前这版问的）：按记住的选择走。
    // closeAskV 用来区分旧配置：1.2.x 写过 closeAsked=true，如果只认这个标记，
    // 老用户升级后就再也不会看到询问、直接最小化，看起来像"弹窗丢了"。
    const askedNow = UI_CFG.closeAsked === true && UI_CFG.closeAskV === 2;
    if (askedNow && UI_CFG.closeAskEach !== true) {
      if (UI_CFG.minimizeToTray === false) {
        quitting = true;
        app.quit();
      } else {
        hideToTray();
      }
      return;
    }

    if (closeAskedPending) return; // 弹窗已经开着，别叠加
    closeAskedPending = true;
    try {
      if (!win.isVisible()) win.show();
      win.focus();
    } catch (err) {}
    send('app:ask-close', { defaultMinimize: UI_CFG.minimizeToTray !== false });
    // 兜底：界面 8 秒没响应就按最小化处理，避免窗口卡住关不掉
    setTimeout(() => {
      if (closeAskedPending) {
        closeAskedPending = false;
        patchCfg({ closeAsked: true });
        hideToTray();
      }
    }, 8000);
  });

  // 界面里点选之后回复：minimize=true 最小化，false 退出
  ipcMain.on('app:close-choice', (_e, opt) => {
    const o = opt || {};
    closeAskedPending = false;
    patchCfg({
      closeAsked: true,
      closeAskV: 2,
      ...(o.remember === false ? {} : { minimizeToTray: !!o.minimize }),
    });
    log('info', '关闭方式选择：' + (o.minimize ? '最小化到托盘' : '直接退出') + (o.remember === false ? '（本次有效）' : '（已记住）'));
    if (o.minimize) hideToTray();
    else {
      quitting = true;
      app.quit();
    }
  });

  win.on('maximize', () => send('win:state', true));
  win.on('unmaximize', () => send('win:state', false));
}

/* ---------------- Java 探测 / 一键部署 ---------------- */
async function findJava(custom) {
  const j = await javaRuntime.detect(custom);
  return { path: j.path, version: j.version, source: j.source };
}

/** 版本要求的 Java 大版本：读已下载的版本 JSON，缺省 21 */
/** 版本 json 没写 javaVersion 时，按版本号猜需要的 Java 大版本：
 *  远古版（alpha/beta）和老版本只能跑 Java 8；1.17+ 要 17，1.20.5+ 要 21 */
function guessJavaMajor(versionId) {
  const s = String(versionId || '');
  const m = /^1\.(\d+)(?:\.(\d+))?/.exec(s);
  if (m) {
    const minor = Number(m[1]);
    const patch = Number(m[2] || 0);
    if (minor >= 20 && patch >= 5) return 21;
    if (minor >= 17) return 17;
    return 8;
  }
  const snap = /^(\d{2})w\d{2}[a-z]?$/i.exec(s);
  if (snap) return Number(snap[1]) >= 21 ? 17 : 8;
  return 8; // old_alpha / old_beta 之类
}

async function requiredJavaMajor(gameDir, versionId) {
  try {
    const p = path.join(gameDir, 'versions', versionId, `${versionId}.json`);
    const j = JSON.parse(await fs.promises.readFile(p, 'utf8'));
    if (j.javaVersion && j.javaVersion.majorVersion) return j.javaVersion.majorVersion;
    if (j.inheritsFrom) return requiredJavaMajor(gameDir, j.inheritsFrom);
  } catch (e) {}
  return guessJavaMajor(versionId);
}

ipcMain.handle('java:detect', async (_e, opt) => {
  const j = await javaRuntime.detect(opt && opt.javaPath);
  return j;
});

ipcMain.handle('java:require', async (_e, req) => {
  return { major: await requiredJavaMajor(req.gameDir, req.version) };
});

ipcMain.handle('java:install', async (_e, req) => {
  const major = Number((req && req.major) || 0) || 21;
  log('info', `开始一键部署 Java ${major}…`);
  const r = await javaRuntime.install(major, (p) => {
    send('java:progress', p);
    if (p.phase === '下载 Java' && p.percent === 0) log('info', `Java ${major} 下载源：${p.label}`);
  });
  log('info', `Java 就绪：${r.path}${r.version ? ' (' + r.version + ')' : ''}`);
  return r;
});

/* ---------------- 下载队列（最多同时 3 个） ---------------- */
const MAX_PARALLEL = 3;
let taskSeq = 0;
const tasks = [];
let queueTimer = null;

function queueSnapshot() {
  return tasks
    .slice()
    .sort((a, b) => a.id - b.id)
    .map((t) => ({
      id: t.id,
      title: t.title,
      kind: t.kind,
      status: t.status,
      error: t.error,
      progress: t.progress,
    }));
}

function broadcastQueue() {
  if (queueTimer) return;
  queueTimer = setTimeout(() => {
    queueTimer = null;
    send('queue:update', queueSnapshot());
  }, 120);
}

function runningCount() {
  return tasks.filter((t) => t.status === 'running').length;
}

function pumpQueue() {
  while (runningCount() < MAX_PARALLEL) {
    const next = tasks.find((t) => t.status === 'queued');
    if (!next) break;
    next.status = 'running';
    runTask(next);
  }
  broadcastQueue();
}

async function runTask(t) {
  const onProgress = (p) => {
    t.progress = p;
    broadcastQueue();
  };
  try {
    const r = await performInstall(t.req, onProgress);
    t.status = 'done';
    t.result = r;
    t.progress = { phase: '完成', done: 1, total: 1, percent: 100 };
  } catch (e) {
    t.status = 'error';
    t.error = String((e && e.message) || e);
  }
  pumpQueue();
}

/** 真正执行安装（队列内部调用） */
async function performInstall(req, onProgress) {
  const gameDir = req.gameDir;
  log('info', `开始安装：${req.id || req.mc}（${req.kind}）`);
  if (req.kind === 'fabric') {
    if (!req.loader) {
      const loaders = await installer.fabricLoaders(req.mc);
      if (!loaders.length) throw new Error('该版本暂无可用 Fabric Loader');
      req.loader = loaders[0].loader.version;
    }
    return installer.installFabric(req.mc, req.loader, gameDir, onProgress, req.assets !== false);
  }
  if (req.kind === 'forge') {
    if (!req.forge) {
      const list = await installer.forgeVersions(req.mc).catch(() => []);
      if (!list.length) {
        throw new Error('Forge 还没有发布 ' + req.mc + ' 的安装包；换一个正式版（例如 26.2 / 26.3）再试');
      }
      req.forge = list[0];
    }
    const java = await findJava(req.javaPath);
    if (!java.path) throw new Error('未找到 Java，无法运行 Forge 安装器');
    return installer.installForge(req.mc, req.forge, gameDir, java.path, onProgress);
  }
  return installer.installVanilla(req.id, gameDir, onProgress, req.assets !== false);
}

function enqueueInstall(req) {
  const key = [req.kind, req.id || req.mc, req.loader || '', req.forge || '', req.gameDir].join('|');
  const dup = tasks.find((t) => t.key === key && (t.status === 'queued' || t.status === 'running'));
  if (dup) return { id: dup.id, duplicated: true, status: dup.status };
  const t = {
    id: ++taskSeq,
    key,
    kind: req.kind,
    title: req.id || req.mc,
    req,
    status: 'queued',
    progress: null,
    error: null,
  };
  tasks.push(t);
  log('info', `已加入下载队列：${t.title}（第 ${tasks.filter((x) => x.status !== 'done' && x.status !== 'error').length} 个）`);
  pumpQueue();
  return { id: t.id, duplicated: false, status: 'queued' };
}

function waitTask(id) {
  return new Promise((resolve, reject) => {
    const tick = () => {
      const t = tasks.find((x) => x.id === id);
      if (!t) return reject(new Error('任务已不存在'));
      if (t.status === 'done') return resolve(t.result);
      if (t.status === 'error') return reject(new Error(t.error));
      setTimeout(tick, 300);
    };
    tick();
  });
}

ipcMain.handle('queue:add', async (_e, req) => enqueueInstall(req));
ipcMain.handle('queue:list', async () => queueSnapshot());
ipcMain.handle('queue:remove', async (_e, id) => {
  const i = tasks.findIndex((t) => t.id === id && t.status === 'queued');
  if (i < 0) return false;
  tasks.splice(i, 1);
  broadcastQueue();
  return true;
});
ipcMain.handle('queue:clear', async () => {
  for (let i = tasks.length - 1; i >= 0; i--) {
    if (tasks[i].status === 'done' || tasks[i].status === 'error') tasks.splice(i, 1);
  }
  broadcastQueue();
  return true;
});

/** 版本清单 / 安装（老接口：入队并等待完成，启动流程用） */
ipcMain.handle('mc:manifest', async () => {
  const list = await installer.getManifest();
  return list.map((v) => ({ id: v.id, type: v.type, time: v.releaseTime }));
});

ipcMain.handle('mc:install', async (_e, req) => {
  const { id } = enqueueInstall(req);
  return waitTask(id);
});


/* ---------------- 皮肤系统 ---------------- */
const SKIN_SIZES = [
  [64, 32],
  [64, 64],
  [128, 128],
];

ipcMain.handle('skin:pick', async () => {
  const res = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'Minecraft 皮肤（PNG）', extensions: ['png'] }],
  });
  if (res.canceled || !res.filePaths.length) return null;
  const file = res.filePaths[0];
  const buf = await fs.promises.readFile(file);
  // 读 PNG 头里的宽高，顺手校验是不是合法皮肤尺寸
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) {
    throw new Error('这不是 PNG 文件（皮肤必须是 PNG，JPG 请先另存为 PNG）');
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const okSize = SKIN_SIZES.some(([w, h]) => w === width && h === height);
  if (!okSize) {
    // 很多网站给的是放大版（128/256/512），只要宽高比是皮肤比例就交给前端缩放
    const ratio = height === width ? 2 : 1; // 64×64 或 64×32
    const isPower = (n) => n >= 64 && Number.isInteger(Math.log2(n)) && n % 64 === 0;
    if (!isPower(width) || !isPower(height) || (height !== width && height * 2 !== width)) {
      throw new Error(`皮肤尺寸应为 64×64 / 64×32 / 128×128（或其整数倍），当前是 ${width}×${height}`);
    }
  }
  return {
    name: path.basename(file),
    width,
    height,
    dataUrl: 'data:image/png;base64,' + buf.toString('base64'),
  };
});

/** 上传皮肤到微软账号（需要有效的 Minecraft access token） */
ipcMain.handle('skin:upload', async (_e, req) => {
  if (!req || !req.accessToken) throw new Error('该账号没有有效的 Minecraft 令牌，请重新用微软账号登录');
  const base64 = String(req.dataUrl || '').replace(/^data:image\/png;base64,/, '');
  const buf = Buffer.from(base64, 'base64');
  if (!buf.length) throw new Error('皮肤数据为空');
  const form = new FormData();
  form.append('variant', req.variant === 'slim' ? 'slim' : 'classic');
  form.append('file', new Blob([buf], { type: 'image/png' }), 'skin.png');
  const res = await fetch('https://api.minecraftservices.com/minecraft/profile/skins', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${req.accessToken}` },
    body: form,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    if (res.status === 401) throw new Error('令牌已过期，请重新用微软账号登录');
    throw new Error(`上传失败（HTTP ${res.status}）${txt ? '：' + txt.slice(0, 160) : ''}`);
  }
  log('info', `皮肤已上传到微软账号（${req.variant === 'slim' ? '纤细' : '经典'}）`);
  return { ok: true };
});

/* ---------------- 离线皮肤（CustomSkinLoader 本地皮肤） ---------------- */
ipcMain.handle('localskin:status', async (_e, req) => localskin.status(req.gameDir, req.playerName));

ipcMain.handle('localskin:enable', async (_e, req) => {
  const { gameDir, playerName, mc, loader, dataUrl } = req;
  log('info', `准备离线皮肤：${playerName}（${mc} / ${loader || '原版'}）`);

  if (dataUrl) {
    const file = await localskin.writeSkin(gameDir, playerName, dataUrl);
    log('info', `本地皮肤已写入：${file}`);
  }

  let modInfo = null;
  const before = await localskin.status(gameDir, playerName);
  if (!before.modInstalled) {
    modInfo = await localskin.installMod(gameDir, mc, loader, (p) => send('mc:install-progress', p));
    log('info', `CustomSkinLoader 已安装：${modInfo.file}`);
  }

  const patch = await localskin.patchConfig(gameDir);
  const st = await localskin.status(gameDir, playerName);
  log('info', `离线皮肤状态：模组=${st.modInstalled ? '已装' : '缺失'} 配置=${st.configExists ? '有' : '无'} LocalSkin优先=${st.localFirst ? '是' : '否'}`);
  return { ...st, patched: patch, installed: modInfo ? modInfo.file : '' };
});

/* ---------------- 皮肤库（一键换肤） ---------------- */
function skinLibDir() {
  return path.join(app.getPath('userData'), 'skins');
}

/** 首次运行时把内置的几套经典皮肤拷进皮肤库（之后用户删了就不会再加回来） */
async function seedBuiltinSkins() {
  try {
    const dir = skinLibDir();
    const marker = path.join(dir, '.builtin.json');
    if (fs.existsSync(marker)) return;
    await fs.promises.mkdir(dir, { recursive: true });
    const src = path.join(__dirname, 'assets', 'skins');
    if (!fs.existsSync(src)) return;
    for (const f of await fs.promises.readdir(src)) {
      if (!/\.png$/i.test(f)) continue;
      const dest = path.join(dir, f);
      if (!fs.existsSync(dest)) await fs.promises.copyFile(path.join(src, f), dest).catch(() => {});
    }
    await fs.promises.writeFile(marker, JSON.stringify({ seededAt: Date.now(), from: src }), 'utf8');
  } catch (e) {}
}

ipcMain.handle('skins:list', async () => {
  const dir = skinLibDir();
  await fs.promises.mkdir(dir, { recursive: true });
  const files = (await fs.promises.readdir(dir)).filter((f) => f.toLowerCase().endsWith('.png'));
  const out = [];
  for (const f of files.slice(0, 120)) {
    const full = path.join(dir, f);
    try {
      const [buf, st] = await Promise.all([fs.promises.readFile(full), fs.promises.stat(full)]);
      out.push({
        id: f,
        name: f.replace(/\.png$/i, ''),
        dataUrl: 'data:image/png;base64,' + buf.toString('base64'),
        size: buf.length,
        mtime: st.mtimeMs,
      });
    } catch (e) {}
  }
  return out.sort((a, b) => b.mtime - a.mtime);
});

ipcMain.handle('skins:add', async (_e, req) => {
  const dir = skinLibDir();
  await fs.promises.mkdir(dir, { recursive: true });
  const buf = Buffer.from(String((req && req.dataUrl) || '').replace(/^data:image\/png;base64,/, ''), 'base64');
  if (!buf.length) throw new Error('皮肤数据为空');
  // 用内容哈希命名：同一张皮肤只会存一份
  const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 10);
  const file = path.join(dir, `skin-${hash}.png`);
  if (!fs.existsSync(file)) await fs.promises.writeFile(file, buf);
  return { id: path.basename(file), name: path.basename(file, '.png'), dataUrl: 'data:image/png;base64,' + buf.toString('base64') };
});

ipcMain.handle('skins:delete', async (_e, req) => {
  const id = path.basename(String((req && req.id) || ''));
  if (!/^[\w.-]+\.png$/i.test(id)) throw new Error('非法皮肤文件名');
  const file = path.join(skinLibDir(), id);
  if (fs.existsSync(file)) await shell.trashItem(file);
  return true;
});

/** 换肤后顺手同步到 CustomSkinLoader（已经启用过才同步） */
ipcMain.handle('skins:apply', async (_e, req) => {
  const { gameDir, playerName, dataUrl, mc, loader } = req || {};
  let st = await localskin.status(gameDir, playerName);

  // 没装 CSL 就先把自带的构建装进去（不联网，几百毫秒），这样「点一下皮肤」游戏里就有了
  let autoInstalled = false;
  if (!st.modInstalled && loader) {
    try {
      const info = await localskin.installMod(gameDir, mc, loader);
      autoInstalled = true;
      log('info', `已自动装好 CustomSkinLoader（${info.from === 'bundled' ? '启动器自带' : '在线'}：${info.file}）`);
      st = await localskin.status(gameDir, playerName);
    } catch (e) {
      log('warn', `自动安装 CustomSkinLoader 失败：${e.message || e}`);
    }
  }

  if (!st.modInstalled) return { synced: false, reason: 'no-mod' };
  await localskin.writeSkin(gameDir, playerName, dataUrl);
  const patch = await localskin.patchConfig(gameDir).catch(() => null);
  log('info', `皮肤已同步到 CustomSkinLoader：${playerName}`);
  return { synced: true, autoInstalled, localFirst: patch ? patch.localFirst : undefined };
});

/** 旧 .minecraft：FCL\game 还是空的就先沿用，等用户显式迁移 */
function legacyMinecraftDir() {
  const old = path.join(app.getPath('appData') || path.join(os.homedir(), 'AppData', 'Roaming'), '.minecraft');
  try {
    if (fs.existsSync(path.join(old, 'versions')) && !fs.existsSync(path.join(GAME_DIR, 'versions'))) return old;
  } catch (e) {}
  return '';
}

/** 把旧 .minecraft 搬进 FCL\game（同盘 rename 瞬间完成，跨盘退回复制） */
async function migrateMinecraft() {
  const old = legacyMinecraftDir();
  if (!old) return { ok: false, reason: '没有可迁移的旧 .minecraft' };
  try {
    if (fs.existsSync(GAME_DIR)) {
      const left = fs.readdirSync(GAME_DIR).filter((n) => n !== 'data');
      if (left.length) return { ok: false, reason: 'FCL\\game 里已有文件，为安全起见没有自动合并' };
      fs.rmdirSync(GAME_DIR);
    }
    try {
      fs.renameSync(old, GAME_DIR);
    } catch (e) {
      fs.cpSync(old, GAME_DIR, { recursive: true });
    }
    log('info', `已把旧游戏目录迁移到 ${GAME_DIR}`);
    return { ok: true, to: GAME_DIR };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

ipcMain.handle('game:migrate', async () => migrateMinecraft());
ipcMain.handle('game:legacy', async () => legacyMinecraftDir());

/* ---------------- 便携根目录 ---------------- */
ipcMain.handle('app:root', async () => ({
  root: ROOT,
  data: DATA_DIR,
  game: GAME_DIR,
  java: JAVA_DIR,
  pointer: rootPointer,
  defaultRoot,
  portable: !!process.env.PORTABLE_EXECUTABLE_DIR,
  version: app.getVersion(),
  transparent: USE_TRANSPARENT,
  minimizeToTray: UI_CFG.minimizeToTray !== false,
  closeAskEach: UI_CFG.closeAskEach === true,
}));

ipcMain.handle('app:set-root', async (_e, req) => {
  const target = String((req && req.root) || '').trim();
  if (!target) throw new Error('路径不能为空');
  if (!canWrite(target)) throw new Error('这个目录不可写：' + target);
  fs.mkdirSync(defaultRoot, { recursive: true });
  fs.writeFileSync(rootPointer, JSON.stringify({ root: target }, null, 2), 'utf8');
  for (const sub of ['data', 'game', 'java']) {
    try {
      fs.mkdirSync(path.join(target, sub), { recursive: true });
    } catch (e) {}
  }
  log('info', `根目录已改为 ${target}（重启后生效）`);
  return { ok: true, root: target, needRestart: true };
});

ipcMain.handle('app:restart', async () => {
  // 便携版（electron-builder portable）不能直接用 app.relaunch()：
  // 它重启的是 %TEMP% 里那份自解压副本，而退出时这个临时目录会被清掉，
  // 新进程再去 require 就会报 ENOENT package.json。这里改为重启用户手里那个 exe。
  const portable = process.env.PORTABLE_EXECUTABLE_FILE;
  if (portable && fs.existsSync(portable)) {
    try {
      spawn(portable, [], { detached: true, stdio: 'ignore' }).unref();
      app.exit(0);
      return true;
    } catch (e) {
      log('warn', '重启便携版失败，尝试普通重启：' + (e.message || e));
    }
  }
  app.relaunch();
  app.exit(0);
  return true;
});

/* ---------------- 背景图片 ---------------- */
// 渲染进程用 <input type=file> 读到的 dataURL 直接存盘，绕开系统文件对话框
ipcMain.handle('bg:save', async (_e, req) => {
  const dataUrl = String((req && req.dataUrl) || '');
  const m = /^data:image\/(png|jpeg|jpg|webp|bmp);base64,(.+)$/i.exec(dataUrl);
  if (!m) throw new Error('图片数据无效');
  const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 24 * 1024 * 1024) throw new Error('图片太大了（上限 24MB）');
  for (const f of await fs.promises.readdir(DATA_DIR)) {
    if (/^wallpaper\./i.test(f)) await fs.promises.unlink(path.join(DATA_DIR, f)).catch(() => {});
  }
  const dest = path.join(DATA_DIR, 'wallpaper.' + ext);
  await fs.promises.writeFile(dest, buf);
  log('info', `背景图片已导入：${dest}`);
  return { path: dest, name: (req && req.name) || path.basename(dest) };
});

ipcMain.handle('bg:pick', async () => {
  const res = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }],
  });
  if (res.canceled || !res.filePaths.length) return null;
  const src = res.filePaths[0];
  const ext = (path.extname(src) || '.jpg').toLowerCase();
  try {
    for (const f of await fs.promises.readdir(DATA_DIR)) {
      if (/^wallpaper\./i.test(f)) await fs.promises.unlink(path.join(DATA_DIR, f)).catch(() => {});
    }
    const dest = path.join(DATA_DIR, 'wallpaper' + ext);
    await fs.promises.copyFile(src, dest);
    log('info', `背景图片已导入：${dest}`);
    return { path: dest, name: path.basename(src) };
  } catch (e) {
    return { path: src, name: path.basename(src) };
  }
});

/* ---------------- 本机环境 ---------------- */
ipcMain.handle('sys:env', async (_e, opt) => {
  const legacy = legacyMinecraftDir();
  const gameDir = (opt && opt.gameDir) || legacy || GAME_DIR;
  const java = await findJava(opt && opt.javaPath);

  let installed = [];
  try {
    const vd = path.join(gameDir, 'versions');
    if (fs.existsSync(vd)) installed = fs.readdirSync(vd, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch (e) {}

  let saves = [];
  try {
    const sd = path.join(gameDir, 'saves');
    if (fs.existsSync(sd)) saves = fs.readdirSync(sd, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch (e) {}

  let mods = [];
  try {
    const md = path.join(gameDir, 'mods');
    if (fs.existsSync(md)) {
      mods = fs.readdirSync(md).filter((f) => f.endsWith('.jar') || f.endsWith('.jar.disabled'))
        .map((f) => ({ name: f, enabled: f.endsWith('.jar'), size: Math.round(fs.statSync(path.join(md, f)).size / 1024) }));
    }
  } catch (e) {}

  const scanPacks = (sub, extraRe) => {
    const d = path.join(gameDir, sub);
    try {
      if (!fs.existsSync(d)) return [];
      const re = extraRe || /\.(zip|jar)$/i;
      return fs
        .readdirSync(d)
        .filter((f) => re.test(f))
        .map((f) => ({ name: f, size: Math.round(fs.statSync(path.join(d, f)).size / 1024) }));
    } catch (e) {
      return [];
    }
  };

  return {
    gameDir,
    gameDirExists: fs.existsSync(gameDir),
    root: ROOT,
    defaultGameDir: GAME_DIR,
    legacyGameDir: legacy,
    javaDir: JAVA_DIR,
    portable: !!process.env.PORTABLE_EXECUTABLE_DIR,
    installedVersions: installed,
    localMods: mods,
    resourcePacks: scanPacks('resourcepacks'),
    shaderPacks: scanPacks('shaderpacks', /\.(zip|jar)(\.disabled)?$/i),
    enabledPacks: readEnabledPacks(gameDir),
    saves,
    java: java.version,
    javaPath: java.path,
    totalMemGB: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    cpu: os.cpus()[0] ? os.cpus()[0].model : '未知'
  };
});

/* ---------------- 版本加载器列表 ---------------- */
ipcMain.handle('mc:verify', async (_e, req) => {
  log('info', `校验游戏文件：${req.version}`);
  const r = await installer.verify(req.version, req.gameDir, (p) => {
    send('mc:verify-progress', p);
  }, req.assets !== false);
  log('info', `文件校验完成：${r}`);
  return r;
});

/* ---------------- 崩溃报告 ---------------- */
function readLatestCrash(gameDir) {
  try {
    const dir = path.join(gameDir, 'crash-reports');
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.txt'))
      .sort();
    if (!files.length) return null;
    const file = path.join(dir, files[files.length - 1]);
    const st = fs.statSync(file);
    if (Date.now() - st.mtimeMs > 5 * 60 * 1000) return null; // 只认 5 分钟内新生成的
    const txt = fs.readFileSync(file, 'utf8');
    const desc = (txt.match(/Description:\s*(.+)/) || [])[1] || '';
    const err = (txt.match(/(?:Caused by: )?((?:java|net|com)\.[\w.$]+(?:Exception|Error))[^\n]*/) || [])[0] || '';
    return { file, description: desc.trim(), error: err.trim() };
  } catch (e) {
    return null;
  }
}

ipcMain.handle('log:last-crash', async (_e, req) => readLatestCrash(req.gameDir));

ipcMain.handle('mc:loaders', async (_e, req) => {
  if (req.kind === 'fabric') return (await installer.fabricLoaders(req.mc)).map((x) => x.loader.version);
  return installer.forgeVersions(req.mc);
});


/* ---------------- 启动 / 结束游戏 ---------------- */
ipcMain.handle('mc:launch', async (_e, req) => {
  if (gameProcess) return { ok: false, error: '游戏已在运行中' };

  // 装了 CustomSkinLoader 的话，启动前把 LocalSkin 排到 loadlist 最前
  try {
    const r = await localskin.syncOnLaunch(req.gameDir);
    if (r && r.changed) log('info', '已修正 CustomSkinLoader 配置：LocalSkin 优先');
  } catch (e) {}

  const java = await findJava(req.javaPath);
  if (!java.path) throw new Error('未检测到 Java，请在设置中指定 javaw.exe 或安装 JDK');

  log('info', `Java：${java.path}${java.version ? ' (' + java.version + ')' : ''}`);
  log('info', `游戏目录：${req.gameDir}`);
  log('info', `解析版本 ${req.version}…`);

  const opts = {
    gamePath: req.gameDir,
    resourcePath: req.gameDir,
    javaPath: java.path,
    version: req.version,
    launcherName: 'FCL',
    launcherBrand: 'FCL',
    minMemory: Math.min(1024, req.maxMemory || 4096),
    maxMemory: req.maxMemory || 4096,
    extraJVMArgs: (req.jvmArgs || '').split(/\s+/).filter(Boolean)
  };

  if (req.account) {
    opts.gameProfile = { name: req.account.name, id: req.account.uuid || '' };
    opts.accessToken = req.account.accessToken || '';
    opts.userType = 'mojang';
  }
  if (req.fullscreen) opts.resolution = { fullscreen: true };
  else if (req.width && req.height) opts.resolution = { width: +req.width, height: +req.height };

  const proc = await launch(opts);
  gameProcess = proc;  log('info', `Minecraft 进程已启动（PID ${proc.pid}）`);

  let lines = 0;
  const push = (raw) => {
    String(raw).split(/\r?\n/).filter((s) => s.trim()).slice(0, 6).forEach((s) => {
      if (lines++ > 300) return;
      log('game', s.replace(/\u001b\[[0-9;]*m/g, '').slice(0, 200));
    });
  };
  proc.stdout.on('data', push);
  proc.stderr.on('data', push);

  try {
    const watcher = createMinecraftProcessWatcher(proc);
    watcher.on('minecraft-window-ready', () => {
      gameWindowReady = true;
      log('info', '游戏窗口已就绪');
      send('mc:game-ready', {});
    });
    watcher.on('minecraft-exit', (e) => {
      gameProcess = null;
      const crash = e.code === 0 ? null : readLatestCrash(req.gameDir);
      log(e.code === 0 ? 'info' : 'error', `游戏退出，代码 ${e.code}${e.crashReport ? '（已生成崩溃报告）' : ''}`);
      if (crash) {
        log('error', `崩溃原因：${crash.description || '(未注明)'}${crash.error ? ' —— ' + crash.error : ''}`);
        log('error', `崩溃报告：${crash.file}`);
      }
      send('mc:game-exit', { code: e.code, crash });
    });
  } catch (e) {}

  proc.on('exit', (code) => {
    if (!gameProcess) return;
    gameProcess = null;
    const crash = code === 0 ? null : readLatestCrash(req.gameDir);
    log(code === 0 ? 'info' : 'warn', `进程结束，退出代码 ${code}`);
    send('mc:game-exit', { code, crash });
  });

  return { ok: true, pid: proc.pid };
});

ipcMain.handle('mc:kill', async () => {
  if (!gameProcess) return false;
  try { gameProcess.kill(); } catch (e) {}
  gameProcess = null;
  log('info', '已结束游戏进程');
  return true;
});

/* ---------------- 下载中心（Modrinth） ---------------- */
ipcMain.handle('store:search', async (_e, req) => modstore.search(req));

/* ---------------- 中文模组搜索（MC百科） ---------------- */
ipcMain.handle('cnmod:search', async (_e, req) => cnmod.search(req.query, req.limit));

ipcMain.handle('store:install', async (_e, req) => {
  log('info', `开始下载${modstore.TYPE_LABEL[req.type] || '文件'}：${req.title || req.id}`);
  const r = await modstore.install(req, (p) => send('mc:install-progress', p));
  log('info', `已安装到 ${r.dir}/${r.file}`);
  // 材质包下载完直接启用（写 options.txt），做到「下完就能在游戏里看到」
  if (req.type === 'resourcepack') {
    try {
      const cur = readEnabledPacks(req.gameDir);
      if (!cur.includes(r.file)) writeEnabledPacks(req.gameDir, cur.concat([r.file]));
      r.enabled = true;
      log('info', `材质包已启用：${r.file}`);
    } catch (e) {}
  }
  return r;
});

/* ---------------- 删除已下载版本 ---------------- */
ipcMain.handle('mc:delete-version', async (_e, req) => {
  const gameDir = req.gameDir;
  const id = String(req.id || '').trim();
  if (!id || /[\\/]/.test(id) || id.includes('..')) throw new Error('非法的版本名');
  const versionsDir = path.join(gameDir, 'versions');
  const dir = path.join(versionsDir, id);
  if (path.dirname(dir) !== versionsDir) throw new Error('非法的版本路径');
  if (!fs.existsSync(dir)) throw new Error('版本不存在：' + id);
  if (gameProcess) throw new Error('游戏正在运行，请先结束游戏再删除版本');
  log('info', `删除版本：${id}`);
  await shell.trashItem(dir); // 走回收站，误删可恢复
  log('info', `已删除版本目录：${versionsDir}\\${id}`);
  return { ok: true, id };
});

/* ---------------- 导入本地内容（模组 / 材质包 / 光影） ---------------- */
const CONTENT_DIR = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks' };
const CONTENT_EXT = { mod: /\.(jar|zip)$/i, resourcepack: /\.zip$/i, shader: /\.zip$/i };

ipcMain.handle('dialog:pickContent', async (_e, req) => {
  const type = req && req.type === 'mod' ? 'mod' : req && req.type === 'shader' ? 'shader' : 'resourcepack';
  const filters =
    type === 'mod'
      ? [{ name: '模组（.jar / .zip）', extensions: ['jar', 'zip'] }]
      : [{ name: type === 'shader' ? '光影包（.zip）' : '材质包（.zip）', extensions: ['zip'] }];
  const res = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters });
  return res.canceled ? [] : res.filePaths;
});

/** 把用户选中的本地文件（或拆包目录）复制进对应的游戏目录 */
ipcMain.handle('content:import', async (_e, req) => {
  const type = CONTENT_DIR[req.type] ? req.type : 'mod';
  const dest = path.join(req.gameDir, CONTENT_DIR[type]);
  await fs.promises.mkdir(dest, { recursive: true });

  const imported = [];
  const skipped = [];
  const failed = [];
  for (const src of req.files || []) {
    const name = path.basename(src);
    try {
      const st = await fs.promises.stat(src);
      const target = path.join(dest, name);
      if (fs.existsSync(target)) {
        skipped.push(name);
        continue;
      }
      if (st.isDirectory()) {
        // 拆包目录形式的材质包/光影也支持
        await fs.promises.cp(src, target, { recursive: true, force: false, errorOnExist: true });
        imported.push(name);
        continue;
      }
      if (!CONTENT_EXT[type].test(name)) {
        failed.push(`${name}（后缀不支持）`);
        continue;
      }
      await fs.promises.copyFile(src, target);
      imported.push(name);
    } catch (e) {
      failed.push(`${name}（${e.message}）`);
    }
  }

  if (type === 'resourcepack' && imported.length) {
    try {
      const cur = readEnabledPacks(req.gameDir);
      writeEnabledPacks(req.gameDir, cur.concat(imported.filter((n) => !cur.includes(n))));
    } catch (e) {}
  }

  const label = type === 'mod' ? '模组' : type === 'shader' ? '光影' : '材质包';
  log('info', `导入${label}：成功 ${imported.length}，已存在 ${skipped.length}，失败 ${failed.length} → ${dest}`);
  failed.forEach((f) => log('warn', `导入失败：${f}`));
  return { imported, skipped, failed, dir: dest };
});

/* ---------------- 材质包 / 光影（一键部署） ---------------- */
function packDirOf(gameDir, type) {
  return path.join(gameDir, type === 'shader' ? 'shaderpacks' : 'resourcepacks');
}

function readEnabledPacks(gameDir) {
  try {
    const txt = fs.readFileSync(path.join(gameDir, 'options.txt'), 'utf8');
    const line = txt.split(/\r?\n/).find((l) => l.startsWith('resourcePacks:'));
    if (!line) return [];
    const list = JSON.parse(line.slice('resourcePacks:'.length));
    return (Array.isArray(list) ? list : [])
      .map((s) => String(s).replace(/^file\//, ''))
      .filter((s) => s && s !== 'vanilla');
  } catch (e) {
    return [];
  }
}

function writeEnabledPacks(gameDir, names) {
  const p = path.join(gameDir, 'options.txt');
  const entry = 'resourcePacks:' + JSON.stringify(['vanilla'].concat(names.map((n) => 'file/' + n)));
  let lines = [];
  try {
    lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
  } catch (e) {
    lines = [];
  }
  const i = lines.findIndex((l) => l.startsWith('resourcePacks:'));
  if (i >= 0) lines[i] = entry;
  else lines.push(entry);
  fs.writeFileSync(p, lines.join('\n'), 'utf8');
}

/** 把材质包启用/停用（写 options.txt 的 resourcePacks，游戏启动即生效） */
ipcMain.handle('pack:toggle', async (_e, req) => {
  const cur = readEnabledPacks(req.gameDir);
  const has = cur.includes(req.name);
  const next = has ? cur.filter((n) => n !== req.name) : cur.concat([req.name]);
  writeEnabledPacks(req.gameDir, next);
  log('info', `${has ? '停用' : '启用'}材质包：${req.name}`);
  return { enabled: !has, enabledPacks: next };
});

ipcMain.handle('pack:delete', async (_e, req) => {
  const target = path.join(packDirOf(req.gameDir, req.type), req.name);
  if (!fs.existsSync(target)) throw new Error('文件不存在：' + req.name);
  await shell.trashItem(target);
  if (req.type !== 'shader') {
    const cur = readEnabledPacks(req.gameDir);
    if (cur.includes(req.name)) writeEnabledPacks(req.gameDir, cur.filter((n) => n !== req.name));
  }
  log('info', `已删除${req.type === 'shader' ? '光影' : '材质包'}：${req.name}`);
  return true;
});

/* ---------------- 模组（真实文件操作） ---------------- */
ipcMain.handle('mc:mod-toggle', async (_e, req) => {
  const dir = path.join(req.gameDir, 'mods');
  const from = path.join(dir, req.name);
  const to = req.name.endsWith('.disabled')
    ? path.join(dir, req.name.replace(/\.disabled$/, ''))
    : path.join(dir, req.name + '.disabled');
  await fspRename(from, to);
  return path.basename(to);
});

ipcMain.handle('mc:mod-delete', async (_e, req) => {
  const target = path.join(req.gameDir, 'mods', req.name);
  await shell.trashItem(target);
  return true;
});

function fspRename(from, to) {
  return new Promise((resolve, reject) => fs.rename(from, to, (e) => (e ? reject(e) : resolve())));
}

/* ---------------- 微软登录 ---------------- */
ipcMain.handle('ms:start', async (_e, clientId) => ms.startDeviceLogin(clientId));
ipcMain.handle('ms:poll', async (_e, req) => ms.pollLogin(req.clientId, req.deviceCode, req.expires));

/* ---------------- 微软登录：内嵌登录窗口（玩家不用申请 Azure 应用） ---------------- */
let msLoginWin = null;
let msLoginNeedsCookieReset = false;
async function openMicrosoftLogin() {
  if (msLoginWin) throw new Error('登录窗口已经打开了');
  return await new Promise((resolve, reject) => {
    const authWin = new BrowserWindow({
      width: 540,
      height: 720,
      parent: win,
      modal: true,
      autoHideMenuBar: true,
      title: '登录微软账号',
      backgroundColor: '#ffffff',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        partition: 'persist:mslogin',
        sandbox: true,
      },
    });
    msLoginWin = authWin;
    // 放行导航：登录全程都是 https 页面跳转，不能被主窗口那套外链拦截挡掉
    try {
      authWin.webContents.__fclAllowNav = true;
    } catch (e) {}
    let settled = false;

    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      msLoginWin = null;
      try {
        if (!authWin.isDestroyed()) authWin.destroy();
      } catch (e) {}
      fn(arg);
    };
    const ok = (acc) => finish(resolve, acc);
    const bad = (err) => finish(reject, err instanceof Error ? err : new Error(String(err)));

    const handle = async (u) => {
      if (!u || !u.startsWith(ms.LIVE_REDIRECT)) return;
      try {
        const q = new URL(u).searchParams;
        const err = q.get('error_description') || q.get('error');
        const code = q.get('code');
        if (err) return bad(new Error(err));
        if (!code) return bad(new Error('微软没有返回授权码'));
        log('info', '微软登录：已拿到授权码，正在换取 Minecraft 账号…');
        const tok = await ms.exchangeCode(code);
        const acc = await ms.finishWithToken(tok.access_token);
        log('info', '微软登录成功：' + acc.name);
        ok(acc);
      } catch (e) {
        bad(e);
      }
    };

    const intercept = (e, u) => {
      if (u && u.startsWith(ms.LIVE_REDIRECT)) {
        if (e && e.preventDefault) e.preventDefault();
        handle(u);
      }
    };
    authWin.webContents.on('will-redirect', intercept);
    authWin.webContents.on('will-navigate', intercept);
    authWin.webContents.on('did-navigate', (_e, u) => {
      if (u && u.startsWith(ms.LIVE_REDIRECT)) handle(u);
    });
    authWin.on('closed', () => {
      msLoginWin = null;
      if (!settled) {
        settled = true;
        reject(new Error('已取消微软登录'));
      }
    });

    authWin.loadURL(ms.buildAuthUrl()).catch((e) => bad(e));
  });
}

ipcMain.handle('ms:login', () => openMicrosoftLogin());

/* 兜底：内嵌窗口被微软拦掉时，改用系统浏览器登录，再把回调链接粘回来 */
ipcMain.handle('ms:browser-login', async () => {
  const url = ms.buildAuthUrl();
  await shell.openExternal(url);
  log('info', '微软登录：已在系统浏览器中打开授权页');
  return { ok: true, url };
});

ipcMain.handle('ms:complete-url', async (_e, raw) => {
  const text = String(raw || '').trim();
  if (!text) throw new Error('没有粘贴链接');
  let code = '';
  try {
    const u = new URL(text);
    code = u.searchParams.get('code') || '';
    const errCode = u.searchParams.get('error');
    if (!code && errCode) throw new Error('微软返回错误：' + errCode);
  } catch (e) {
    // 允许只粘贴 code 本身
    if (/^[A-Za-z0-9._~-]{20,}$/.test(text)) code = text;
    else throw new Error('这段内容里没有 code，请复制浏览器地址栏的完整链接');
  }
  if (!code) throw new Error('链接里没有 code');
  log('info', '微软登录：正在用浏览器回调里的 code 换取账号');
  const tok = await ms.exchangeCode(code);
  return await ms.finishWithToken(tok.access_token);
});

/* ---------------- 其它 ---------------- */
ipcMain.handle('dialog:openFolder', async () => {
  const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('shell:open', async (_e, target) => {
  if (!target) return false;
  try {
    // 目录不存在时先创建（例如首次打开 saves / mods）
    if (!fs.existsSync(target) && !path.extname(target)) fs.mkdirSync(target, { recursive: true });
    if (fs.existsSync(target)) return shell.openPath(target) === '';
    await shell.openExternal(target);
    return true;
  } catch (e) {
    return false;
  }
});

/** 创建托盘图标与右键菜单 */
function createTray() {
  if (tray) return;
  try {
    let img = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.ico'));
    if (img.isEmpty()) img = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon-preview-32.png'));
    tray = new Tray(img.resize({ width: 16, height: 16 }));
    tray.setToolTip('FCL · FishCraftLauncher');
    const show = () => {
      if (!win) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    };
    const menu = Menu.buildFromTemplate([
      { label: '显示主窗口', click: show },
      { label: '隐藏到托盘', click: () => win && win.hide() },
      { type: 'separator' },
      { label: '打开游戏目录', click: () => shell.openPath(GAME_DIR) },
      { label: '打开启动器目录', click: () => shell.openPath(ROOT) },
      { type: 'separator' },
      {
        label: '退出 FCL',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]);
    tray.setContextMenu(menu);
    tray.on('click', show);
    tray.on('double-click', show);
  } catch (e) {
    log('warn', '创建托盘图标失败：' + (e.message || e));
  }
}

/* 单实例：第二个实例只把已有窗口拉到前台，避免两个进程抢同一个数据目录 */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win || win.isDestroyed()) {
      createWindow();
      return;
    }
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    win.focus();
    notifyAlreadyRunning();
  });
}

if (gotLock) app.whenReady().then(() => {
  // Java 一键部署的落地根目录：<userData>/runtime
  javaRuntime.init(JAVA_DIR);
  if (ms.setSkinDir) ms.setSkinDir(path.join(DATA_DIR, 'skins'));
  seedBuiltinSkins();
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  quitting = true;
});

app.on('window-all-closed', () => {
  log('warn', '所有窗口已关闭，应用退出');
  if (process.platform !== 'darwin') app.quit();
});

/* GPU / 网络等子进程非正常退出时留个记录（这类问题以前表现为“闪退”） */
/* 安全/稳定：主窗口里不允许开新窗口、不允许跳外链（外链交给系统浏览器）。
   注意：微软登录窗口必须放行 —— 它整段流程都是在 https 页面之间跳转，
   被这里拦掉就会表现为“点了微软登录没反应/白窗”。窗口创建后会给
   它的 webContents 打上 __fclAllowNav 标记。 */
app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (contents.__fclAllowNav) return { action: 'allow' };
    try {
      if (url && !url.startsWith('file:')) shell.openExternal(url);
    } catch (err) {}
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (contents.__fclAllowNav) return;
    if (url && !url.startsWith('file:')) {
      event.preventDefault();
      try {
        shell.openExternal(url);
      } catch (err) {}
    }
  });
});

app.on('child-process-gone', (_e, details) => {
  log('error', `子进程退出：${details.type} / ${details.reason}（exitCode ${details.exitCode}）`);
});
