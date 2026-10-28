(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const KEY = 'craftlauncher.v1';
  const L = window.launcher || null;
  const hasElectron = !!L;

  /* 未捕获错误：写到启动日志里，方便事后排查 */
  window.__fclErrorHook = true;
  window.addEventListener('error', (e) => {
    try {
      appendLog('error', '未捕获错误：' + (e.message || e.error) + ' @' + (e.filename || '') + ':' + (e.lineno || 0));
    } catch (err) {}
  });
  window.addEventListener('unhandledrejection', (e) => {
    try {
      appendLog('error', '未处理的 Promise：' + ((e.reason && (e.reason.message || e.reason)) || ''));
    } catch (err) {}
  });

  /* ---------------- 状态 ---------------- */
  const state = {
    srv: { kind: 'paper', mc: '', port: 25565, mem: 2048, dir: '', running: false, created: null },
    page: 'launch',
    version: '1.20.4',
    accounts: [],
    currentAccount: null,
    installed: [],
    queue: [],
    java: null,
    onlineMods: [],
    modSource: 'modrinth',
    cnMods: [],
    skinLib: [],
    settings: {
      mem: 4096, javaPath: '', gameDir: '', winW: 1280, winH: 720,
      jvm: '', optimizedJvm: true,
      dark: false, mode: 'light', clientId: '',
      fullscreen: false, closeLauncher: false, checkAssets: true, isolate: true, opacity: 1
    },
    env: null,
    manifest: null,
    store: { type: 'resourcepack', items: [] },
    paths: null
  };

  let fresh = true; // 是否为首次运行（无历史数据）

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        version: state.version, accounts: state.accounts, currentAccount: state.currentAccount,
        settings: state.settings
      }));
    } catch (e) {}
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      fresh = !raw;
      if (!raw) return;
      const d = JSON.parse(raw);
      state.version = d.version || state.version;
      state.accounts = d.accounts || [];
      state.currentAccount = d.currentAccount || null;
      Object.assign(state.settings, d.settings || {});
    } catch (e) {}
  }

  /* ---------------- 通用 ---------------- */
  function toast(msg, ms) {
    const wrap = $('#toastWrap');
    while (wrap.children.length >= 4) wrap.firstElementChild.remove();
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(() => el.remove(), ms || 2600);
  }

  const now = () => new Date().toTimeString().slice(0, 8);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const curAcc = () => state.accounts.find((a) => a.id === state.currentAccount) || null;
  const gameDir = () => state.settings.gameDir || (state.env && state.env.gameDir) || '';
  const isInstalled = (id) => (state.env ? state.env.installedVersions.includes(id) : state.installed.includes(id));

  function appendLog(lv, msg) {
    const box = $('#log');
    const empty = box.querySelector('.log-empty');
    if (empty) empty.remove();
    const line = document.createElement('div');
    line.className = 'log-line';
    line.innerHTML = `<span class="t">[${now()}]</span> <span class="lv-${lv}">[${lv.toUpperCase()}]</span> <span class="m">${esc(msg)}</span>`;
    box.appendChild(line);
    // 最多保留 400 行，长时间挂机也不会一直吃内存
    while (box.childElementCount > 400) box.firstElementChild.remove();
    box.scrollTop = box.scrollHeight;
  }

  function switchPage(p) {
    state.page = p;
    $$('.nav-item').forEach((b) => {
      const on = b.dataset.page === p;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    $$('.page').forEach((s) => s.classList.toggle('active', s.id === 'page-' + p));
    $('.content').scrollTop = 0;
    if (p === 'accounts') renderSkin();
    if (p === 'server') { renderServerPage(); refreshLanInfo(); if ($('#p2pRoom') && !$('#p2pRoom').value) p2pGenRoom(); p2pRender(); }
  }

  /* ---------------- 开服 ---------------- */
  function ipcMsg(e) {
    return String((e && e.message) || e).replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '');
  }
  function srvLog(line) {
    const box = $('#srvConsole');
    if (!box) return;
    const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
    box.textContent += (box.textContent ? '\n' : '') + line;
    if (box.textContent.length > 200000) box.textContent = box.textContent.slice(-120000);
    if (atBottom) box.scrollTop = box.scrollHeight;
    trackOnline(line);
  }

  /** 从服务端日志里数在线玩家（和 FMCL 的控制台同款思路） */
  function trackOnline(line) {
    const s = state.srv;
    s.players = s.players || {};
    let m = /(\S+) joined the game/.exec(line);
    if (m) s.players[m[1]] = true;
    m = /(\S+) left the game/.exec(line);
    if (m) delete s.players[m[1]];
    // list 命令输出：There are 2 of a max of 20 players online: A, B
    m = /There are (\d+) of a max/.exec(line);
    const el = $('#srvOnline');
    if (el) el.textContent = '在线 ' + (m ? Number(m[1]) : Object.keys(s.players).length);
  }

  function renderSrvState() {
    const el = $('#srvState');
    if (!el) return;
    const s = state.srv;
    el.classList.toggle('on', !!s.running);
    el.classList.toggle('busy', !s.running && !!s.created);
    el.textContent = s.running ? '运行中' : s.created ? '已创建' : '未创建';
    const start = $('#srvStartBtn');
    const stop = $('#srvStopBtn');
    if (start) start.disabled = !s.created || s.running;
    if (stop) stop.disabled = !s.running;
    const dir = $('#srvDir');
    if (dir) dir.value = s.dir || '';
    $$('[data-act="srv-kind"]').forEach((b) => b.classList.toggle('active', b.dataset.id === s.kind));
  }

  async function renderServerPage() {
    if (!hasElectron) return;
    if (!state.srv.mc) state.srv.mc = state.version || '26.3';
    const mc = $('#srvMc');
    if (mc && !mc.value) mc.value = state.srv.mc;
    try {
      const r = await L.serverInfo();
      state.srv.dir = r.dir;
      state.srv.created = r.info;
      state.srv.running = !!r.running || !!(r.info && r.info.running);
      if (r.info) {
        state.srv.kind = r.info.kind === 'vanilla' ? 'vanilla' : 'paper';
        state.srv.port = r.info.port || state.srv.port;
        state.srv.mem = r.info.mem || state.srv.mem;
        if (!$('#srvMc').value) $('#srvMc').value = r.info.mc || state.srv.mc;
      }
    } catch (e) {}
    renderSrvState();
  }

  /* ---------------- 崩溃诊断 ---------------- */
  function showCrashDialog(info) {
    if (!info) return;
    state.lastCrash = info;
    const d = info.diagnosis || [];
    const rows = [];
    rows.push(`<p class="crash-line"><b>退出码</b> <span class="mono">${info.exitCode == null ? '未知' : info.exitCode}</span></p>`);
    if (info.description) rows.push(`<p class="crash-line"><b>崩溃描述</b> ${esc(info.description)}</p>`);
    if (info.exception) rows.push(`<p class="crash-line"><b>异常</b> <span class="mono">${esc(info.exception)}</span></p>`);
    if (d.length) {
      rows.push('<div class="crash-diag">' + d.map((x) =>
        `<div class="crash-tip"><span class="crash-tag">${esc(x.tag)}</span><span>${esc(x.hint)}</span></div>`
      ).join('') + '</div>');
    } else {
      rows.push('<p class="tip">没有命中已知的崩溃模式，可以看下面的日志尾部或导出报告。</p>');
    }
    if (info.logTail) {
      rows.push(`<details class="crash-details"><summary>游戏日志尾部</summary><pre class="crash-log">${esc(info.logTail)}</pre></details>`);
    }
    rows.push(`<div class="row wrap" style="margin-top:var(--sp-3)">
      <button type="button" class="btn primary" data-act="crash-export">导出诊断包</button>
      ${info.report ? '<button type="button" class="btn" data-act="crash-open">打开崩溃报告</button>' : ''}
      <button type="button" class="btn ghost" data-act="crash-close">知道了</button>
    </div>`);
    openModal('游戏崩溃了', rows.join(''));
  }

  window.__fclShowCrash = (info) => showCrashDialog(info);

  async function crashExport() {
    if (!hasElectron || !L.crashExport) return;
    const r = await L.crashExport({ gameDir: gameDir(), info: state.lastCrash || {} });
    if (r && r.ok) toast('已导出：' + r.file, 6000);
    else toast('导出失败：' + ((r && r.error) || '未知错误'), 6000);
  }

  /* ---------------- 自动更新 ---------------- */
  let updateState = null;

  function renderUpdateState() {
    const verEl = $('#appVer');
    if (verEl && state.paths && state.paths.version) verEl.textContent = '当前版本 v' + state.paths.version;
    const hint = $('#updateHint');
    const dl = $('#downloadUpdateBtn');
    const op = $('#openUpdatePageBtn');
    if (!hint) return;
    if (!updateState) return;
    if (updateState.error) {
      hint.textContent = '检查失败：' + updateState.error;
      return;
    }
    if (!updateState.hasUpdate) {
      hint.textContent = '已是最新版本（v' + updateState.current + '）';
      if (dl) dl.classList.add('hidden');
      if (op) op.classList.add('hidden');
      return;
    }
    hint.textContent = '发现新版本 v' + updateState.latest + (updateState.asset ? '（' + Math.round(updateState.asset.size / 1024 / 1024) + ' MB）' : '');
    if (dl) dl.classList.toggle('hidden', !updateState.asset);
    if (op) op.classList.remove('hidden');
  }

  async function checkUpdate() {
    if (!hasElectron || !L.checkUpdate) { toast('桌面端才支持检查更新'); return; }
    const btn = $('#checkUpdateBtn');
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = '检查中…';
    try {
      const r = await L.checkUpdate();
      updateState = r;
      renderUpdateState();
      if (r.ok && r.hasUpdate) toast('发现新版本 v' + r.latest, 5000);
      else if (r.ok) toast('已是最新版本', 3000);
    } catch (e) {
      updateState = { error: ipcMsg(e) };
      renderUpdateState();
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  }

  async function downloadUpdate() {
    if (!updateState || !updateState.asset) return;
    const btn = $('#downloadUpdateBtn');
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = '下载中…';
    const off = L.onUpdateProgress ? L.onUpdateProgress((p) => {
      btn.textContent = '下载 ' + (p.percent || 0) + '%';
    }) : null;
    try {
      const r = await L.downloadUpdate({ url: updateState.asset.url });
      if (r.ok) {
        toast('下载完成，已打开所在文件夹：' + r.path, 8000);
        if (L.reveal) L.reveal(r.path);
        $('#updateHint').textContent = '新版已下载：' + r.path + '（关闭当前窗口后运行它）';
      } else {
        toast('下载失败：' + r.error, 6000);
      }
    } catch (e) {
      toast('下载失败：' + ipcMsg(e), 6000);
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  }

  /* ---------------- 联机 ---------------- */
  async function refreshLanInfo() {
    if (!hasElectron || !L.netInfo) return null;
    try {
      const r = await L.netInfo();
      state.lan = r;
      const port = +($('#srvPort') && $('#srvPort').value) || 25565;
      const lan = r.lan && r.lan[0] ? r.lan[0].address : '';
      const lanEl = $('#lanAddr');
      if (lanEl) lanEl.value = lan ? lan + ':' + port : '';
      const wanEl = $('#wanAddr');
      if (wanEl) wanEl.value = r.publicIp ? r.publicIp + ':' + port : '';
      const st = $('#lanState');
      if (st) st.textContent = r.publicIp ? '公网 IP：' + r.publicIp : '只检测到局域网地址';
      return r;
    } catch (e) {
      return null;
    }
  }

  async function lanCopy(which) {
    const el = which === 'wan' ? $('#wanAddr') : $('#lanAddr');
    if (!el || !el.value) { toast('还没有地址，先启动服务端'); return; }
    try {
      await navigator.clipboard.writeText(el.value);
      toast('已复制：' + el.value, 3000);
    } catch (e) {
      el.select();
      document.execCommand('copy');
      toast('已复制：' + el.value, 3000);
    }
  }

  async function lanFirewall() {
    const port = +($('#srvPort') && $('#srvPort').value) || 25565;
    if (!hasElectron || !L.netFirewall) return;
    const r = await L.netFirewall(port);
    srvLog('[联机] ' + (r.message || (r.ok ? '已放行' : '失败')));
    toast(r.message || (r.ok ? '已放行' : '放行失败'), 5000);
  }

  async function lanUpnp() {
    const port = +($('#srvPort') && $('#srvPort').value) || 25565;
    if (!hasElectron || !L.netUpnp) return;
    const st = $('#lanState');
    if (st) st.textContent = '正在尝试 UPnP…';
    const r = await L.netUpnp({ port });
    srvLog('[联机] ' + (r.message || (r.ok ? '映射成功' : '映射失败')));
    if (st) st.textContent = r.ok ? 'UPnP 已映射，外网可用公网地址' : 'UPnP 不可用，需要手动端口转发';
    toast(r.message || (r.ok ? '映射成功' : '映射失败'), 6000);
  }

  /* ---------------- P2P 联机 ---------------- */
  /** EasyTier 建虚拟网卡需要管理员权限，命中就别报"未知错误" */
  function p2pNeedAdmin(text) {
    if (!/Failed to create adapter|拒绝访问|0x80070005|access is denied|administrator/i.test(String(text || ''))) return false;
    const btn = $('#p2pAdminBtn');
    if (btn) btn.classList.remove('hidden');
    $('#p2pHint') && ($('#p2pHint').textContent = 'EasyTier 需要管理员权限创建虚拟网卡：点「以管理员身份重启」后重试。');
    return true;
  }

  function p2pRender() {
    const st = state.p2p || {};
    const ipEl = $('#p2pIp');
    if (ipEl) {
      ipEl.textContent = st.running ? (st.virtualIp ? st.virtualIp : '已启动，等分配 IP') : '未启动';
      ipEl.classList.toggle('on', !!st.running);
    }
    const start = $('#p2pStartBtn');
    const stop = $('#p2pStopBtn');
    if (start) start.disabled = !!st.running;
    if (stop) stop.disabled = !st.running;
  }

  function p2pGenRoom() {
    const r = 'fcl-' + String(Math.floor(Math.random() * 900000 + 100000));
    if ($('#p2pRoom')) $('#p2pRoom').value = r;
  }

  async function p2pStart() {
    if (!hasElectron || !L.p2pStart) { toast('桌面端才支持 P2P'); return; }
    const room = ($('#p2pRoom').value || '').trim();
    if (!room) { toast('请先填房间号'); return; }
    const btn = $('#p2pStartBtn');
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = '启动中…';
    try {
      const r = await L.p2pStart({
        room,
        secret: ($('#p2pSecret').value || '').trim(),
        peer: ($('#p2pPeer').value || '').trim(),
      });
      state.p2p = { running: true, role: r.role, virtualIp: r.virtualIp, room: r.room };
      srvLog('[P2P] 已启动：' + (r.role === 'host' ? '房主' : '加入') + '，虚拟 IP ' + (r.virtualIp || '待分配'));
      p2pRender();
      toast(r.role === 'host' ? '房主已就绪：把虚拟 IP 发给朋友' : '已加入房间', 5000);
    } catch (e) {
      const msg = ipcMsg(e);
      srvLog('[P2P] 启动失败：' + msg);
      p2pNeedAdmin(msg);
      toast('P2P 启动失败：' + msg, 6000);
      if (/管理员|denied|0x80070005/i.test(msg)) {
        toast('虚拟网卡需要管理员权限，请右键以管理员身份运行启动器', 8000);
      }
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  }

  async function p2pStop() {
    if (!hasElectron || !L.p2pStop) return;
    await L.p2pStop();
    state.p2p = { running: false };
    p2pRender();
    srvLog('[P2P] 已停止');
  }

  async function srvCreate() {
    const btn = $('#srvCreateBtn');
    const mc = ($('#srvMc').value || '').trim();
    const port = +$('#srvPort').value || 25565;
    const mem = +$('#srvMem').value || 2048;
    const online = $('#srvOnline').checked;
    if (!mc) { toast('请先填写游戏版本，例如 26.3'); return; }
    if (!hasElectron) { toast('桌面端才能开服'); return; }
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = '创建中…';
    $('#srvState').textContent = '准备中';
    $('#srvState').classList.add('busy');
    try {
      const r = await L.serverCreate({ mc, kind: state.srv.kind, port, mem, onlineMode: online });
      state.srv.dir = r.dir;
      state.srv.created = r.info;
      state.srv.mc = mc;
      state.srv.port = port;
      state.srv.mem = mem;
      srvLog('[FCL] 服务端已创建：' + r.jar + '（' + mc + '，端口 ' + port + '）');
      if (r.portChanged) {
        toast('端口 ' + r.requestedPort + ' 被占用，已改用 ' + r.port, 6000);
        srvLog('[FCL] 端口 ' + r.requestedPort + ' 被占用，已改用 ' + r.port);
        const pe = $('#srvPort'); if (pe) pe.value = r.port;
      } else {
        toast('服务端已创建，可以点「启动」了', 4000);
      }
    } catch (e) {
      srvLog('[错误] ' + ipcMsg(e));
      toast('创建失败：' + ipcMsg(e), 5000);
    } finally {
      btn.disabled = false;
      btn.textContent = old;
      renderSrvState();
    }
  }

  async function srvStart() {
    if (!hasElectron) return;
    try {
      const r = await L.serverStart({ dir: state.srv.dir, mem: +$('#srvMem').value || 2048 });
      state.srv.running = true;
      srvLog('[FCL] 服务端已启动（PID ' + r.pid + '，堆 ' + r.heap + 'MB）');
      refreshLanInfo();
    } catch (e) {
      const msg = ipcMsg(e);
      srvLog('[错误] ' + msg);
      // 没 Java 就顺手部署一个（和服务端同版本要求）
      if (/未检测到 Java/.test(msg) && L.javaInstall) {
        toast('没有 Java，正在自动部署…', 4000);
        srvLog('[FCL] 未检测到 Java，开始自动部署…');
        try {
          await L.javaInstall({ major: 25 });
          srvLog('[FCL] Java 部署完成，正在重试启动…');
          const r2 = await L.serverStart({ dir: state.srv.dir, mem: +$('#srvMem').value || 2048 });
          state.srv.running = true;
          srvLog('[FCL] 服务端已启动（PID ' + r2.pid + '，堆 ' + r2.heap + 'MB）');
        } catch (e2) {
          srvLog('[错误] ' + ipcMsg(e2));
          toast('Java 部署或启动失败：' + ipcMsg(e2), 6000);
        }
      } else {
        toast('启动失败：' + msg, 5000);
      }
    }
    renderSrvState();
  }

  async function srvCmd() {
    const el = $('#srvCmd');
    const line = (el && el.value || '').trim();
    if (!line) return;
    if (!state.srv.running) { toast('服务端还没启动'); return; }
    try {
      const r = await L.serverCmd(line);
      if (r && r.ok) {
        srvLog('> ' + line);
        el.value = '';
        el.focus();
      } else {
        toast('命令发送失败');
      }
    } catch (e) {
      toast('命令发送失败：' + ipcMsg(e), 4000);
    }
  }

  async function srvStop() {
    if (!hasElectron) return;
    try {
      await L.serverStop();
      srvLog('[FCL] 已发送停止指令');
    } catch (e) {
      srvLog('[错误] ' + (e.message || e));
    }
    state.srv.running = false;
    renderSrvState();
  }

  /* ---------------- 启动页 ---------------- */
  function renderHero() {
    $('#verName').textContent = state.version;
    $('#verSub').textContent = `${isInstalled(state.version) ? '已安装' : '未安装'} · 点击切换`;
    $('#sideVer').textContent = state.version;

    const a = curAcc();
    $('#accAvatar').src = a ? (a.avatar || makeAvatar(a.name, 'random', 8)) : '';
    $('#accAvatar').style.display = a ? '' : 'none';
    $('#accName').textContent = a ? a.name : '未登录';
    $('#accSub').textContent = a ? `${a.type === 'microsoft' ? '微软账号' : '离线模式'} · 点击切换` : '尚未添加账号，点击前往添加';
    $('#sideUser').textContent = a ? a.name : '-';
  }

  function renderEnv() {
    const e = state.env, s = state.settings;
    const chips = [];
    const dot = (ok) => `<i class="dot ${ok ? 'ok' : 'bad'}"></i>`;
    if (e) {
      chips.push(`<span class="chip">${dot(!!e.java)}Java <b>${e.java ? esc(e.java) : '未检测到'}</b></span>`);
      chips.push(`<span class="chip">${dot(e.gameDirExists)}游戏目录 <b>${e.gameDirExists ? '已就绪' : '不存在'}</b></span>`);
      chips.push(`<span class="chip">内存 <b>${e.totalMemGB} GB</b></span>`);
      if (e.installedVersions && e.installedVersions.length) chips.push(`<span class="chip">本地版本 <b>${e.installedVersions.length} 个</b></span>`);
      chips.push(`<button type="button" class="chip jump" data-act="open-sub" data-id="saves">打开存档目录 <b>${(e.saves || []).length} 个</b></button>`);
      chips.push(`<button type="button" class="chip jump" data-act="open-sub" data-id="mods">打开模组目录 <b>${(e.localMods || []).length} 个</b></button>`);
      chips.push(`<button type="button" class="chip jump" data-act="open-sub" data-id=".">打开游戏目录</button>`);
    } else {
      chips.push(`<span class="chip">${dot(false)}<b>演示模式（未连接本机）</b></span>`);
    }
    chips.push(`<span class="chip">分配 <b>${(s.mem / 1024).toFixed(1)} GB</b></span>`);
    chips.push(`<span class="chip">窗口 <b>${s.winW}×${s.winH}</b></span>`);
    $('#envBar').innerHTML = chips.join('');

    const be = $('#brandEnv');
    if (e) {
      be.textContent = `Java ${e.java ? '就绪' : '缺失'} · ${e.totalMemGB}G 内存`;
      be.title = `Java ${e.java ? '已就绪' : '未检测到'}，系统内存 ${e.totalMemGB} GB`;
    } else be.textContent = '演示模式';
    $('#aboutEnv').textContent = e ? `${esc(e.gameDir)} · ${esc(e.cpu)}` : '浏览器中打开时无法读取本机信息，请运行 npm start。';
  }

  function renderNews() {
    // 不再用写死的示例新闻：有在线清单就展示真实版本动态，否则回退到离线数据
    const items = [];
    const releases = (state.manifest || []).filter((v) => v.type === 'release').slice(0, 3);
    if (releases.length) {
      releases.forEach((v, i) => {
        const inst = isInstalled(v.id);
        items.push({
          tag: i === 0 ? '最新' : '正式版',
          title: v.id,
          desc: `${String(v.time || '').slice(0, 10)} · ${inst ? '本机已安装' : '可一键下载'}`
        });
      });
      const snaps = (state.manifest || []).filter((v) => v.type === 'snapshot').slice(0, 2);
      snaps.forEach((v) => items.push({ tag: '快照', title: v.id, desc: `${String(v.time || '').slice(0, 10)} · 预览版` }));
    } else {
      NEWS.forEach((n) => items.push(n));
    }
    $('#news').innerHTML = items.map((n) =>
      `<li><span class="tag">${esc(n.tag)}</span><span class="txt"><b>${esc(n.title)}</b><span>${esc(n.desc)}</span></span></li>`).join('');
  }

  /* ---------------- 版本页 ---------------- */
  let verTab = 'all';

  /** 正式版列表：优先用在线官方清单（含 26.x 新版），离线时用内置回退 */
  function releaseVersions() {
    if (state.manifest && state.manifest.length) {
      return state.manifest.filter((v) => v.type === 'release').map((v) => v.id).slice(0, 16);
    }
    return VERSIONS.filter((v) => v.type === 'release').map((v) => v.id);
  }

  /** 本机已装版本 + 最新正式版，用于加载器安装 / 资源筛选 */
  function latestMcList() {
    const local = ((state.env && state.env.installedVersions) || []).filter((v) => /^\d+(\.\d+)+/.test(v));
    return local.concat(releaseVersions()).filter((v, i, a) => a.indexOf(v) === i).slice(0, 14);
  }


  /** 版本类型的中文名 */
  const TYPE_LABEL = {
    release: '正式版',
    snapshot: '快照',
    old_alpha: '远古 Alpha',
    old_beta: '远古 Beta',
    local: '本地',
    april: '愚人节',
  };

  /** 愚人节版本（官方清单里类型都是 snapshot，只能按 id 认） */
  const APRIL_FOOLS = new Set([
    '2.0', '15w14a', '1.RV-Pre1', '3D Shareware v1.34', '20w14infinite',
    '22w13oneBlockAtATime', '23w13a_or_b', '24w14potato', '25w14craftmine',
  ]);
  function isAprilFools(id) {
    const s = String(id || '');
    if (APRIL_FOOLS.has(s)) return true;
    return /craftmine|potato|oneBlockAtATime|3D Shareware|RV-Pre|20w14infinite|23w13a_or_b/i.test(s);
  }
  /** 远古版本：old_alpha / old_beta */
  function isAncient(v) {
    return v && (v.type === 'old_alpha' || v.type === 'old_beta');
  }
  function vanillaList() {
    if (state.manifest) return state.manifest;
    return VERSIONS.filter((v) => ['release', 'snapshot', 'old_alpha', 'old_beta'].includes(v.type))
      .map((v) => ({ id: v.id, type: v.type, time: v.date }));
  }

  function renderVersions() {
    const tabs = [['all', '全部'], ['release', '正式版'], ['snapshot', '快照'], ['ancient', '远古版'], ['april', '愚人节'], ['fabric', 'Fabric'], ['forge', 'Forge'], ['installed', '已安装']];
    $('#verTabs').innerHTML = tabs.map(([k, l]) =>
      `<button type="button" class="tab ${verTab === k ? 'active' : ''}" data-act="ver-tab" data-id="${k}">${l}</button>`).join('');

    const q = ($('#verSearch').value || '').toLowerCase();
    let rows = '';

    if (verTab === 'fabric' || verTab === 'forge') {
      const mcs = latestMcList().filter((v) => !q || v.includes(q));
      rows = mcs.map((mc) => `
        <div class="row-item">
          <div class="row-main">
            <div class="row-title">${esc(mc)} <span class="badge ${verTab}">${verTab === 'fabric' ? 'Fabric' : 'Forge'}</span></div>
            <div class="row-sub">安装适用于 ${esc(mc)} 的最新${verTab === 'fabric' ? ' Fabric Loader' : ' Forge'}</div>
          </div>
          <div class="row-actions"><button type="button" class="btn sm" data-act="install-${verTab}" data-id="${esc(mc)}">安装</button></div>
        </div>`).join('');
    } else {
      let list = vanillaList();
      if (verTab === 'ancient') list = list.filter(isAncient);
      else if (verTab === 'april') list = list.filter((v) => isAprilFools(v.id));
      else if (verTab !== 'all') list = list.filter((v) => v.type === verTab);
      if (verTab === 'installed') {
        const inst = (state.env ? state.env.installedVersions : state.installed) || [];
        list = inst.map((id) => ({ id, type: 'local', time: '-' }));
      }
      if (q) list = list.filter((v) => v.id.toLowerCase().includes(q));
      if (verTab === 'all') list = list.slice(0, 60);

      rows = list.map((v) => {
        const inst = isInstalled(v.id);
        const cur = state.version === v.id;
        const task = (state.queue || []).find((t) => t.title === v.id && (t.status === 'queued' || t.status === 'running'));
        const april = isAprilFools(v.id) && verTab !== 'april';
        const badge = april
          ? '<span class="badge april">愚人节</span>'
          : `<span class="badge ${v.type}">${TYPE_LABEL[v.type] || v.type}</span>`;
        let act;
        if (task) act = `<button type="button" class="btn sm" disabled>${task.status === 'queued' ? '排队中' : taskProgress(task) + '%'}</button>`;
        else if (cur) act = '<button type="button" class="btn sm primary" disabled>当前版本</button>';
        else if (inst) act = `<button type="button" class="btn sm" data-act="use-version" data-id="${esc(v.id)}">设为当前</button>`;
        else act = `<button type="button" class="btn sm" data-act="install-vanilla" data-id="${esc(v.id)}">下载</button>`;
        if (inst && !task) {
          act += `<button type="button" class="icon-btn danger" data-act="del-version" data-id="${esc(v.id)}" aria-label="删除版本 ${esc(v.id)}" title="删除这个版本"><svg class="ic" aria-hidden="true"><use href="#i-trash"/></svg></button>`;
        }
        return `<div class="row-item">
          <div class="row-main">
            <div class="row-title">${esc(v.id)} ${badge}</div>
            <div class="row-sub">${esc(String(v.time || '-').slice(0, 10))}${isAncient(v) ? ' · 需要 Java 8（旧版游戏不兼容新版 Java）' : ''}${isAprilFools(v.id) ? ' · 愚人节版本，玩法与正式版不同' : ''}</div>
          </div>${act}</div>`;
      }).join('');
    }

    $('#verList').innerHTML = rows || '<div class="empty">没有匹配的版本</div>';
    $('#verLocal').textContent = state.env
      ? `游戏目录：${gameDir()}`
      : '演示模式：未连接本机目录，请用 npm start 启动以安装/启动真实版本。';
  }

  /* ---------------- 背景（壁纸 + 蒙版，文字不受影响） ---------------- */
  function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex).trim());
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
  }

  function toFileUrl(p) {
    return 'file:///' + encodeURI(String(p).replace(/\\/g, '/')).replace(/#/g, '%23');
  }

  // 卡片/侧边栏的“原始”颜色（换主题时要重新取）
  let baseColors = { key: '', card: '', side: '' };

  function rgbaOf(hex, alpha) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex).trim());
    if (!m) return hex;
    const r = parseInt(m[1], 16);
    const g = parseInt(m[2], 16);
    const b = parseInt(m[3], 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
  }

  function applyBackdrop() {
    const s = state.settings;
    const photo = $('#bgPhoto');
    const blur = $('#bgBlur');
    const tint = $('#bgTint');
    if (!photo || !tint) return;
    const alpha = typeof s.opacity === 'number' ? s.opacity : 1;
    const url = s.bgImage ? `url("${toFileUrl(s.bgImage)}")` : 'none';

    for (const el of [photo, blur]) {
      if (!el) continue;
      el.style.display = s.bgImage ? 'block' : 'none';
      el.style.backgroundImage = url;
    }

    const rgb = hexToRgb(getComputedStyle(document.body).getPropertyValue('--bg')) || [244, 246, 249];
    // 变量声明在 body 上，覆盖也必须写在 body 上（写在 <html> 上会被 body.dark 盖掉）
    const root = document.body;

    if (s.bgImage) {
      const imgAlpha = 0.25 + 0.75 * alpha;
      if (photo) photo.style.opacity = String(imgAlpha.toFixed(3));
      if (blur) blur.style.opacity = String((imgAlpha * 0.95).toFixed(3));
      const a = 0.04 + 0.22 * alpha;
      tint.style.background = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a.toFixed(3)})`;
    } else {
      if (photo) photo.style.opacity = '1';
      if (blur) blur.style.opacity = '1';
      const a = 0.22 + 0.78 * alpha;
      tint.style.background = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a.toFixed(3)})`;
    }

    // 卡片与侧边栏也跟着变透：这才是「整窗毛玻璃」的关键（否则只有卡片缝里透桌面，几乎看不出来）
    const key = document.body.className + '|' + root.style.getPropertyValue('--accent');
    if (key !== baseColors.key) {
      root.style.removeProperty('--surface');
      root.style.removeProperty('--surface-2');
      const cs = getComputedStyle(root);
      baseColors = {
        key,
        card: cs.getPropertyValue('--surface').trim(),
        side: cs.getPropertyValue('--surface-2').trim(),
      };
    }
    const cardA = 0.30 + 0.70 * alpha;
    const sideA = 0.40 + 0.60 * alpha;
    root.style.setProperty('--surface', rgbaOf(baseColors.card, cardA));
    root.style.setProperty('--surface-2', rgbaOf(baseColors.side, sideA));
  }

  async function pickBackground() {
    const input = $('#bgFile');
    if (!input || !hasElectron) { toast('需要桌面版'); return; }
    input.value = '';
    input.click();
  }

  async function onBgFileChosen() {
    const input = $('#bgFile');
    const file = input && input.files && input.files[0];
    if (!file) return;
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('读取图片失败'));
        reader.onload = () => resolve(String(reader.result || ''));
        reader.readAsDataURL(file);
      });
      const r = await L.saveBackground({ dataUrl, name: file.name });
      state.settings.bgImage = r.path;
      save();
      applyBackdrop();
      renderSettings();
      toast('背景已设置：' + r.name);
    } catch (e) {
      toast('设置背景失败：' + (e.message || e));
    } finally {
      input.value = '';
    }
  }

  function clearBackground() {
    state.settings.bgImage = '';
    save();
    applyBackdrop();
    renderSettings();
    toast('已恢复纯色背景');
  }

  /* ---------------- 便携根目录 ---------------- */
  async function refreshPaths() {
    if (!hasElectron || !L.appRoot) return null;
    try {
      state.paths = await L.appRoot();
    } catch (e) {
      state.paths = null;
    }
    if ($('#appRoot')) $('#appRoot').value = (state.paths && state.paths.root) || '';
    if (state.paths && state.paths.version) {
      const sub = document.querySelector('.tb-sub');
      if (sub) sub.textContent = 'FishCraftLauncher v' + state.paths.version;
    }
    return state.paths;
  }

  async function changeRoot() {
    if (!hasElectron) { toast('需要桌面版'); return; }
    const dir = await L.pickFolder();
    if (!dir) return;
    try {
      const r = await L.setAppRoot({ root: dir });
      state.paths = Object.assign({}, state.paths, { root: r.root });
      if ($('#appRoot')) $('#appRoot').value = r.root;
      appendLog('info', `启动器根目录已改为：${r.root}（重启后生效）`);
      toast('根目录已保存，重启启动器后生效', 4200);
      openModal('需要重启', `
        <div class="confirm-box">
          <p class="confirm-title">根目录已改为 <b>${esc(r.root)}</b></p>
          <p class="tip">新的 <code>data\</code>、<code>game\</code>、<code>java\</code> 会在重启后建到新位置；原有数据仍留在旧目录，可手动搬过去。</p>
          <div class="confirm-actions">
            <button type="button" class="btn ghost" data-act="modal-close">稍后重启</button>
            <button type="button" class="btn primary" data-act="restart-app">立即重启</button>
          </div>
        </div>`);
    } catch (e) {
      toast('设置失败：' + (e.message || e));
    }
  }

  /* ---------------- 模组页（只显示真实文件） ---------------- */
  function renderMods() {
    const q = ($('#modSearch').value || '').toLowerCase();
    const real = (state.env && state.env.localMods) || [];
    const list = real.filter((m) => !q || m.name.toLowerCase().includes(q));

    if (list.length) {
      $('#modList').innerHTML = list.map((m) => `
        <div class="row-item">
          <div class="mod-icon" aria-hidden="true">${esc(m.name.slice(0, 1).toUpperCase())}</div>
          <div class="row-main">
            <div class="row-title">${esc(m.name.replace(/\.jar$/, ''))} ${m.enabled ? '' : '<span class="badge">已禁用</span>'}</div>
            <div class="row-sub">${m.size} KB · 本机 mods 目录</div>
          </div>
          <div class="row-actions">
            <button type="button" class="switch ${m.enabled ? 'on' : ''}" role="switch" aria-checked="${m.enabled ? 'true' : 'false'}" aria-label="启用 ${esc(m.name)}" data-act="real-mod-toggle" data-id="${esc(m.name)}"></button>
            <button type="button" class="icon-btn" data-act="real-mod-del" data-id="${esc(m.name)}" aria-label="删除模组 ${esc(m.name)}" title="删除"><svg class="ic" aria-hidden="true"><use href="#i-trash"/></svg></button>
          </div>
        </div>`).join('');
    } else if (real.length) {
      $('#modList').innerHTML = '<div class="empty">没有匹配的模组</div>';
    } else {
      $('#modList').innerHTML = `<div class="empty">${hasElectron
        ? '本机 mods 目录还没有模组，从下面的「在线模组」一键下载即可'
        : '演示模式：浏览器里读不到本机模组目录'}</div>`;
    }

    const on = real.filter((m) => m.enabled).length;
    $('#modStat').textContent = real.length
      ? `本机共 ${real.length} 个模组，启用 ${on} 个，禁用 ${real.length - on} 个。`
      : (hasElectron ? '本机还没有模组。' : '演示模式：未连接本机目录。');
  }

  /* ---------------- 在线模组（Modrinth + MC百科） ---------------- */
  const CN_HOT_TAGS = ['机械动力', '暮色森林', '工业时代2', '拔刀剑', '神秘时代', '虚无世界', '通用机械', '匠魂'];

  function fillModFilters() {
    const list = latestMcList();
    const mcSel = $('#modOnlineMc');
    const cur = /^\d+(\.\d+)+/.test(state.version) ? state.version : (list[0] || '');
    mcSel.innerHTML = list.map((v) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${v}</option>`).join('');
    const loaderSel = $('#modOnlineLoader');
    const v = String(state.version || '');
    const guess = v.startsWith('fabric-') ? 'fabric' : v.startsWith('forge-') ? 'forge' : '';
    if (guess) loaderSel.value = guess;
  }

  function renderModSourceUi() {
    const cn = state.modSource === 'mcmod';
    $$('#modSourceTabs .tab').forEach((b) => b.classList.toggle('active', b.dataset.id === state.modSource));
    $$('.only-modrinth').forEach((el) => el.classList.toggle('hidden', cn));
    $('#modCnTags').classList.toggle('hidden', !cn);
    $('#modOnlineSearch').placeholder = cn ? '输入中文模组名，如：机械动力' : '搜索模组，留空显示热门';
    if (cn) {
      $('#modCnTags').innerHTML = CN_HOT_TAGS.map((t) => `<button type="button" class="tag-btn" data-act="cn-tag" data-id="${esc(t)}">${esc(t)}</button>`).join('');
    }
  }

  function renderOnlineMods() {
    const box = $('#modOnlineList');
    if (state.modSource === 'mcmod') {
      const items = state.cnMods || [];
      if (!items.length) {
        box.innerHTML = `<div class="empty">${hasElectron ? '输入中文名搜索 MC百科，或点上方热门标签' : '演示模式无法访问 MC百科'}</div>`;
        return;
      }
      box.innerHTML = items.map((it, i) => `
        <div class="row-item cn-row">
          <div class="cn-badge">${esc((it.title || '?').slice(0, 1))}</div>
          <div class="row-main">
            <div class="cn-title">
              <span class="cn-name">${esc(it.title)}</span>
              ${it.en ? `<span class="cn-en">${esc(it.en)}</span>` : ''}
            </div>
            <div class="cn-desc">${esc(it.desc || '（MC百科暂无摘要）')}</div>
            <div class="cn-meta">MC百科 · 快照 ${esc(it.time || '-')}</div>
          </div>
          <div class="row-actions">
            <button type="button" class="btn sm ghost" data-act="cn-open" data-id="${i}">百科</button>
            <button type="button" class="btn sm" data-act="cn-download" data-id="${i}">一键下载</button>
          </div>
        </div>`).join('');
      return;
    }

    const items = state.onlineMods || [];
    if (!items.length) {
      box.innerHTML = `<div class="empty">${hasElectron ? '没有匹配的模组' : '演示模式无法访问 Modrinth'}</div>`;
      return;
    }
    box.innerHTML = items.map((it) => `
      <div class="row-item">
        <img class="store-icon" src="${esc(it.icon || '')}" alt="" onerror="this.style.visibility='hidden'">
        <div class="row-main">
          <div class="row-title">${esc(it.title)}</div>
          <div class="row-sub">下载 ${fmtNum(it.downloads)} · 支持 ${esc((it.versions || []).slice(-3).join(' / ') || '多版本')}</div>
          <div class="store-desc">${esc(it.desc || '')}</div>
        </div>
        <div class="row-actions"><button type="button" class="btn sm" data-act="mod-download" data-id="${esc(it.id)}" data-title="${esc(it.title)}">一键下载</button></div>
      </div>`).join('');
  }

  async function modOnlineSearch() {
    if (!hasElectron) { renderOnlineMods(); return; }
    const box = $('#modOnlineList');
    const q = ($('#modOnlineSearch').value || '').trim();

    if (state.modSource === 'mcmod') {
      if (!q) { renderOnlineMods(); $('#modOnlineHint').textContent = '· 输入中文名或点热门标签'; return; }
      box.innerHTML = '<div class="empty">正在 MC百科 搜索…</div>';
      try {
        state.cnMods = await L.cnmodSearch({ query: q, limit: 20 });
        $('#modOnlineHint').textContent = `· MC百科 ${state.cnMods.length} 条 · ${q}`;
        renderOnlineMods();
      } catch (e) {
        box.innerHTML = `<div class="empty">${esc(e.message || e)}</div>`;
      }
      return;
    }

    box.innerHTML = '<div class="empty">搜索中…</div>';
    const req = {
      query: q,
      type: 'mod',
      mc: $('#modOnlineMc').value || undefined,
      loader: $('#modOnlineLoader').value || undefined,
      limit: 20
    };
    try {
      state.onlineMods = await L.storeSearch(req);
      $('#modOnlineHint').textContent = `· ${state.onlineMods.length} 条` +
        (req.mc ? ` · MC ${req.mc}` : '') + (req.loader ? ` · ${req.loader}` : '');
      renderOnlineMods();
    } catch (e) {
      box.innerHTML = `<div class="empty">搜索失败：${esc(e.message || e)}</div>`;
    }
  }

  async function modDownloadById(id, title, btn) {
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = '准备…';
    const off = L.onInstallProgress((p) => {
      btn.textContent = p.total ? Math.round((p.done / Math.max(p.total, 1)) * 100) + '%' : (p.phase || '下载中');
    });
    try {
      const r = await L.storeInstall({
        id, type: 'mod', mc: $('#modOnlineMc').value,
        loader: $('#modOnlineLoader').value, gameDir: gameDir(), title
      });
      btn.textContent = '已安装';
      toast(`已安装：${r.file}`);
      appendLog('info', `已下载模组 ${r.dir}/${r.file}（${r.version}）`);
      await refreshEnv();
      renderMods();
    } catch (e) {
      btn.textContent = old;
      toast('下载失败：' + (e.message || e));
      appendLog('error', e.message || String(e));
    } finally {
      btn.disabled = false;
      if (typeof off === 'function') off();
      if (L.offProgress) L.offProgress();
    }
  }

  async function modDownload(id, btn) {
    if (!hasElectron) { toast('演示模式无法下载，请用 npm start 启动'); return; }
    if (!gameDir()) { toast('请先设置游戏目录'); return; }
    await modDownloadById(id, btn.dataset.title, btn);
  }

  /** MC百科条目 → 用英文名在 Modrinth 精确匹配后一键下载 */
  async function modDownloadFromCn(index, btn) {
    if (!hasElectron) { toast('演示模式无法下载'); return; }
    if (!gameDir()) { toast('请先设置游戏目录'); return; }
    const it = (state.cnMods || [])[index];
    if (!it) return;
    const query = it.en || it.title;
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = '匹配中…';
    try {
      const hits = await L.storeSearch({
        query, type: 'mod', mc: $('#modOnlineMc').value || undefined,
        loader: $('#modOnlineLoader').value || undefined, limit: 10
      });
      const norm = (s) => String(s || '').toLowerCase().replace(/[\s_-]+/g, '');
      const exact = hits.find((h) => norm(h.slug) === norm(query) || norm(h.title) === norm(query)) || hits.find((h) => norm(h.title).includes(norm(query)));
      if (exact) {
        btn.textContent = '下载中…';
        await modDownloadById(exact.id, it.title, btn);
      } else if (hits.length) {
        state.modSource = 'modrinth';
        $('#modOnlineSearch').value = query;
        renderModSourceUi();
        await modOnlineSearch();
        toast(`「${it.title}」未精确匹配，已切到 Modrinth 结果，请挑一个下载`);
        btn.disabled = false;
        btn.textContent = old;
      } else {
        throw new Error('Modrinth 上没找到同名项目，可点「百科」查看下载地址');
      }
    } catch (e) {
      btn.disabled = false;
      btn.textContent = old;
      toast('下载失败：' + (e.message || e));
    }
  }

  /* ---------------- 下载中心（Modrinth） ---------------- */
  const fmtNum = (n) => (n >= 1e8 ? (n / 1e8).toFixed(1) + '亿' : n >= 1e4 ? (n / 1e4).toFixed(1) + '万' : String(n || 0));

  function fillStoreMc() {
    const sel = $('#storeMc');
    const list = latestMcList();
    const cur = /^\d+(\.\d+)+/.test(state.version) ? state.version : (list[0] || '');
    sel.innerHTML = list.map((v) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${v}</option>`).join('');
  }

  function renderStore() {
    const items = state.store.items;
    // 模组下载已经统一放在「模组管理」页，这里只保留材质包 / 光影，避免两处重复
    if (state.store.type === 'mod') state.store.type = 'resourcepack';
    $('#storeTabs').innerHTML = [['resourcepack', '材质包'], ['shader', '光影']]
      .map(([k, l]) => `<button type="button" class="tab ${state.store.type === k ? 'active' : ''}" data-act="store-tab" data-id="${k}">${l}</button>`).join('');
    renderPacks();

    if (!items.length) {
      $('#storeList').innerHTML = '<div class="empty">' +
        (hasElectron ? '输入关键词或点击「搜索」查看热门资源' : '演示模式无法访问 Modrinth，请用 npm start 启动') + '</div>';
      return;
    }
    const btnLabel = '一键部署';
    $('#storeList').innerHTML = items.map((it) => `
      <div class="row-item">
        <img class="store-icon" src="${esc(it.icon || '')}" alt="" onerror="this.style.visibility='hidden'">
        <div class="row-main">
          <div class="row-title">${esc(it.title)} <span class="badge">${esc(it.type)}</span></div>
          <div class="row-sub">下载 ${fmtNum(it.downloads)} · 支持 ${esc((it.versions || []).slice(-4).join(' / ') || '多版本')}</div>
          <div class="store-desc">${esc(it.desc || '')}</div>
        </div>
        <div class="row-actions"><button type="button" class="btn sm" data-act="store-install" data-id="${esc(it.id)}" data-title="${esc(it.title)}">${btnLabel}</button></div>
      </div>`).join('');
  }

  /* ---------------- 材质包 / 光影：已安装 + 启用状态 ---------------- */
  function packInfo() {
    const e = state.env || {};
    const isShader = state.store.type === 'shader';
    const list = (isShader ? e.shaderPacks : e.resourcePacks) || [];
    const enabled = e.enabledPacks || [];
    return { isShader, list, enabled };
  }

  function renderPacks() {
    const panel = $('#packPanel');
    if (!panel) return;
    if (state.store.type === 'mod') {
      panel.classList.add('hidden');
      return;
    }
    const { isShader, list, enabled } = packInfo();
    panel.classList.remove('hidden');
    $('#packTitle').textContent = `${isShader ? '已安装光影' : '已安装材质包'} · ${list.length} 个`;
    $('#irisBtn').classList.toggle('hidden', !isShader || !/^fabric/i.test(String(state.version)));
    if (!list.length) {
      $('#packList').innerHTML = `<div class="empty">${hasElectron
        ? (isShader ? '还没有光影。注意：光影需要 Iris（Fabric）或 OptiFine 才能生效' : '还没有材质包，下面一键部署即可')
        : '演示模式：读不到本机目录'}</div>`;
      return;
    }
    $('#packList').innerHTML = list.map((p) => {
      const on = !isShader && enabled.includes(p.name);
      return `<div class="row-item">
        <div class="row-main">
          <div class="row-title">${esc(p.name.replace(/\.(zip|jar)$/i, ''))} ${on ? '<span class="badge on">已启用</span>' : ''}</div>
          <div class="row-sub">${p.size} KB · ${isShader ? 'shaderpacks' : 'resourcepacks'}</div>
        </div>
        <div class="row-actions">
          ${isShader ? '' : `<button type="button" class="switch ${on ? 'on' : ''}" role="switch" aria-checked="${on ? 'true' : 'false'}" aria-label="${on ? '停用' : '启用'} ${esc(p.name)}" data-act="pack-toggle" data-id="${esc(p.name)}"></button>`}
          <button type="button" class="icon-btn danger" data-act="pack-del" data-id="${esc(p.name)}" aria-label="删除 ${esc(p.name)}" title="删除"><svg class="ic" aria-hidden="true"><use href="#i-trash"/></svg></button>
        </div>
      </div>`;
    }).join('');
  }

  async function togglePack(name) {
    if (!hasElectron) return;
    try {
      await L.packToggle({ gameDir: gameDir(), name });
      await refreshEnv();
      renderPacks();
      toast(`已${(state.env.enabledPacks || []).includes(name) ? '启用' : '停用'}：${name.replace(/\.zip$/i, '')}`);
    } catch (e) {
      toast('操作失败：' + (e.message || e));
    }
  }

  async function deletePack(name) {
    if (!hasElectron) return;
    try {
      await L.packDelete({ gameDir: gameDir(), name, type: state.store.type === 'shader' ? 'shader' : 'resourcepack' });
      await refreshEnv();
      renderPacks();
      toast('已删除：' + name);
    } catch (e) {
      toast('删除失败：' + (e.message || e));
    }
  }

  /** 光影前置：给当前 Fabric 版本一键装 Iris */
  async function installIris(btn) {
    if (!hasElectron) { toast('需要桌面版'); return; }
    if (!/^fabric/i.test(String(state.version))) { toast('当前版本不是 Fabric，请用 OptiFine 或切换到 Fabric 版本'); return; }
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = '匹配中…';
    try {
      const hits = await L.storeSearch({ query: 'iris', type: 'mod', mc: $('#storeMc').value, loader: 'fabric', limit: 10 });
      const hit = hits.find((h) => /(^|[^a-z])iris([^a-z]|$)/i.test(h.slug || '')) || hits[0];
      if (!hit) throw new Error('没有找到可用的 Iris 版本');
      btn.textContent = '安装中…';
      await modDownloadById(hit.id, 'Iris', btn);
      toast('Iris 已安装，重新启动游戏后即可选择光影');
    } catch (e) {
      toast('安装 Iris 失败：' + (e.message || e));
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  }


  async function doStoreSearch() {
    if (!hasElectron) { renderStore(); return; }
    $('#storeList').innerHTML = '<div class="empty">搜索中…</div>';
    try {
      const req = {
        query: ($('#storeSearch').value || '').trim(),
        type: state.store.type,
        mc: $('#storeMc').value || undefined,
        loader: $('#storeLoader').value || undefined,
        limit: 20
      };
      state.store.items = await L.storeSearch(req);
      $('#storeHint').textContent = `来源：Modrinth 开放 API · 共 ${state.store.items.length} 条结果` +
        (req.mc ? ` · MC ${req.mc}` : '') + (req.loader ? ` · ${req.loader}` : '');
      renderStore();
    } catch (e) {
      $('#storeList').innerHTML = `<div class="empty">搜索失败：${esc(e.message || e)}</div>`;
    }
  }

  async function storeInstall(id, btn) {
    if (!hasElectron) { toast('演示模式无法下载，请用 npm start 启动'); return; }
    if (!gameDir()) { toast('请先设置游戏目录'); return; }
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = '准备…';
    L.onInstallProgress((p) => {
      btn.textContent = p.total ? Math.round((p.done / Math.max(p.total, 1)) * 100) + '%' : p.phase;
    });
    try {
      const r = await L.storeInstall({
        id, type: state.store.type, mc: $('#storeMc').value,
        loader: $('#storeLoader').value, gameDir: gameDir(), title: btn.dataset.title
      });
      btn.textContent = state.store.type === 'mod' ? '已安装' : '已部署';
      if (state.store.type === 'resourcepack') {
        toast(`材质包已部署并启用：${r.file}`);
        appendLog('info', `材质包已放入 resourcepacks 并写入 options.txt：${r.file}`);
      } else if (state.store.type === 'shader') {
        const fabric = /^fabric/i.test(String(state.version));
        toast(`光影已部署到 shaderpacks。${fabric ? '需要 Iris（可点上「安装 Iris」）' : '需要 OptiFine 才能启用'}`, 5200);
        appendLog('info', `光影已放入 shaderpacks：${r.file}${fabric ? '（Fabric 版本请安装 Iris 后在 选项→光影 中选择）' : '（需要 OptiFine）'}`);
      } else {
        toast(`已安装：${r.file}`);
        appendLog('info', `已下载 ${r.dir}/${r.file}（${r.version}）`);
      }
      if (state.store.type === 'mod') await refreshEnv();
      else { await refreshEnv(); renderPacks(); }
    } catch (e) {
      btn.textContent = old;
      toast('安装失败：' + (e.message || e));
      appendLog('error', e.message || String(e));
    } finally {
      btn.disabled = false;
      L.offProgress();
    }
  }

  /* ---------------- 皮肤 ---------------- */
  const SKIN_NAMES = {
    '01-steve-blue': '史蒂夫 · 蓝',
    '02-alex-orange': '艾莉克斯 · 橙',
    '03-green-hoodie': '绿帽连帽衫',
    '04-red-hoodie': '红卫衣',
    '05-gold-knight': '黄金骑士',
    '06-fatfish': '肥鱼 · FCL',
  };
  const skinTitle = (name) => SKIN_NAMES[String(name).replace(/\.png$/i, '')] || name;
    function skinOf(a) {
    return (a && a.skin) || { variant: 'classic', dataUrl: '' };
  }

  function renderSkin() {
    const a = curAcc();
    const skin = skinOf(a);
    const isMs = !!(a && a.type === 'microsoft');

    // 标题与预览下方
    const who = $('#skinWho');
    if (who) who.textContent = a ? a.name + (isMs ? ' · 正版账号' : ' · 离线账号') : '未选择账号';
    const heroName = $('#skinHeroName');
    if (heroName) heroName.textContent = a ? a.name : '未选择账号';

    // 皮肤来源
    const src = $('#skinSourceTxt');
    if (src) {
      if (!a) src.textContent = '—';
      else if (!skin.dataUrl) src.textContent = '默认皮肤（未设置）';
      else if (skin.name) src.textContent = '来自皮肤库 · ' + skin.name;
      else if (isMs) src.textContent = '已同步自微软账号';
      else src.textContent = '本地文件';
    }

    // 模型分段
    const variant = skin.variant || 'classic';
    $$('[data-act="skin-variant"]').forEach((b) => {
      const on = b.dataset.id === variant;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });

    // 上传到微软：正版账号且有皮肤数据时才显示
    const up = $('#skinUploadBtn');
    if (up) up.classList.toggle('hidden', !(isMs && a.accessToken && skin.dataUrl));

    // 说明文字
    const hint = $('#skinHint');
    if (hint) {
      hint.textContent = !a
        ? '先在上方添加或选中一个账号，再给它设置皮肤。'
        : isMs
          ? '正版账号：登录时已自动同步官方皮肤；换好皮肤和模型后点「上传到微软」，官方服务器立即生效。'
          : '离线账号：点「在游戏内生效」会自动装 CustomSkinLoader 并写入皮肤；如果当前是原版版本，会先自动装一个同版本 Fabric 并切过去。装好后先进一次游戏让 CSL 生成配置。';
    }

    drawSkin(a);
    refreshLocalSkin();
    renderSkinLib();
  }

  /** 皮肤预览：3D 模型（CSS 3D + 皮肤 UV），可拖拽旋转 / 滚轮缩放 */
  function drawSkin(a) {
    const host = $('#skinPreview');
    if (!host) return;
    const skin = skinOf(a);
    if (!skin.dataUrl) {
      if (window.Skin3D) window.Skin3D.clear(host);
      host.innerHTML = '<div class="skin3d-empty">未设置皮肤</div>';
      return;
    }
    if (window.Skin3D) window.Skin3D.build(host, skin.dataUrl, skin.variant || 'classic');
  }

  /** 读本地图片：直接用 <input type=file>，不依赖系统文件对话框（无边框/透明窗口下对话框可能弹不出来） */
  function readImageFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('读取文件失败'));
      reader.onload = () => {
        const dataUrl = String(reader.result || '');
        const img = new Image();
        img.onerror = () => reject(new Error('这不是有效的 PNG 图片'));
        img.onload = () => resolve({ dataUrl, width: img.naturalWidth, height: img.naturalHeight });
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    });
  }

  /** 统一成 64×64 皮肤（大图按最近邻缩小，保留像素感） */
  function normalizeSkin(dataUrl, width, height) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onerror = () => resolve(dataUrl);
      img.onload = () => {
        const base = height > 32 ? 64 : 64; // 统一按 64 宽输出
        const cw = 64;
        const ch = height === width ? 64 : 32;
        const c = document.createElement('canvas');
        c.width = cw;
        c.height = ch;
        const ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, cw, ch);
        ctx.drawImage(img, 0, 0, cw, ch);
        resolve(c.toDataURL('image/png'));
      };
      img.src = dataUrl;
    });
  }

  async function onSkinFileChosen() {
    const input = $('#skinFile');
    const file = input && input.files && input.files[0];
    if (!file) return;
    const a = curAcc();
    if (!a) { toast('请先选择一个账号'); return; }
    try {
      const img = await readImageFile(file);
      const okSize =
        (img.width === 64 && (img.height === 64 || img.height === 32)) ||
        (img.width === 128 && img.height === 128) ||
        (img.width >= 64 && img.width % 64 === 0 && img.height === img.width) ||
        (img.width >= 64 && img.width % 64 === 0 && img.height * 2 === img.width);
      if (!okSize) {
        throw new Error(`皮肤尺寸应为 64×64 / 64×32（或其整数倍），当前是 ${img.width}×${img.height}`);
      }
      const dataUrl = await normalizeSkin(img.dataUrl, img.width, img.height);
      a.skin = { variant: skinOf(a).variant || 'classic', dataUrl, name: file.name };
      save();
      renderSkin();
      toast(`皮肤已设置：${file.name}`);
      try {
        await L.skinsAdd({ dataUrl, name: file.name });
        await refreshSkinLib();
      } catch (e) {}
    } catch (e) {
      toast('选择皮肤失败：' + (e.message || e));
    } finally {
      input.value = '';
    }
  }

  function pickSkin() {
    const a = curAcc();
    if (!a) { toast('请先选择一个账号'); return; }
    const input = $('#skinFile');
    if (!input) { toast('界面缺少文件输入控件'); return; }
    input.value = '';
    input.click();
  }

  function setSkinVariant(variant) {
    const a = curAcc();
    if (!a) { toast('请先选择一个账号'); return; }
    a.skin = Object.assign({}, skinOf(a), { variant });
    save();
    renderSkin();
  }

  function resetSkin() {
    const a = curAcc();
    if (!a) { toast('请先选择一个账号'); return; }
    a.skin = Object.assign({}, skinOf(a), { dataUrl: '', name: '' });
    save();
    renderSkin();
    toast('已恢复默认皮肤');
  }

  async function uploadSkin() {
    const a = curAcc();
    if (!a) { toast('请先选择一个账号'); return; }
    if (a.type !== 'microsoft') { toast('只有微软账号能上传到官方服务器'); return; }
    if (!skinOf(a).dataUrl) { toast('请先选择一个皮肤文件'); return; }
    try {
      await L.uploadSkin({ accessToken: a.accessToken, variant: skinOf(a).variant, dataUrl: skinOf(a).dataUrl });
      toast('皮肤已上传，重新进入游戏即可看到');
      appendLog('info', `皮肤已上传到微软账号（${skinOf(a).variant === 'slim' ? '纤细' : '经典'}）`);
    } catch (e) {
      toast('上传失败：' + (e.message || e));
      appendLog('error', '皮肤上传失败：' + (e.message || e));
    }
  }

    /** 找一个同 MC 版本的 Fabric；没有就装一个，并切换过去 */
  async function ensureFabricForSkin(mc) {
    const existing = installedList().find((v) => /^fabric-loader-/.test(v) && mcOf(v) === mc);
    if (existing) return existing;
    toast(`正在安装 Fabric（${mc}）…`, 6000);
    appendLog('info', `为皮肤安装 Fabric：${mc}`);
    await L.install({ kind: 'fabric', mc, gameDir: gameDir(), assets: false, javaPath: state.settings.javaPath });
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      await refreshEnv();
      const v = installedList().find((x) => /^fabric-loader-/.test(x) && mcOf(x) === mc);
      if (v) return v;
    }
    throw new Error('Fabric 安装超时，请到「版本管理」里手动安装');
  }

  async function enableLocalSkin() {
    const a = curAcc();
    if (!a) { toast('请先选择一个账号'); return; }
    if (!skinOf(a).dataUrl) { toast('请先选择一个皮肤文件'); return; }
    if (!hasElectron) { toast('需要桌面版'); return; }
    let mc = mcOf(state.version);
    let loader = loaderOf(state.version);
    if (!loader) {
      // 原版加载不了皮肤模组：自动装一个同版本 Fabric 并切过去
      const btn0 = $('#localSkinBtn');
      const old0 = btn0.textContent;
      btn0.disabled = true;
      btn0.textContent = '准备 Fabric…';
      try {
        const v = await ensureFabricForSkin(mc);
        state.version = v;
        save();
        renderHero();
        renderVersions();
        mc = mcOf(v);
        loader = loaderOf(v);
        toast('已切到 ' + v + '，继续应用皮肤', 4000);
      } catch (e) {
        toast(ipcMsg(e), 6000);
        btn0.disabled = false;
        btn0.textContent = old0;
        return;
      } finally {
        btn0.disabled = false;
        btn0.textContent = old0;
      }
    }
    const btn = $('#localSkinBtn');
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = '准备中…';
    const off = L.onInstallProgress((p) => {
      btn.textContent = p.total ? `安装 ${Math.round((p.done / Math.max(p.total, 1)) * 100)}%` : (p.phase || '准备中');
    });
    try {
      const r = await L.enableLocalSkin({
        gameDir: gameDir(),
        playerName: a.name,
        mc,
        loader,
        dataUrl: skinOf(a).dataUrl,
      });
      if (r.localFirst) {
        toast('已就绪：进游戏就能看到你的皮肤了', 4200);
      } else if (r.configExists && !r.hasLocalEntry) {
        toast('皮肤和模组已就绪，但 CSL 配置里没有 LocalSkin 条目，需要在 CustomSkinLoader.json 里手动加一条', 6000);
      } else {
        toast('模组和皮肤已就绪：先进一次游戏让 CSL 生成配置，之后再进游戏就会生效', 6000);
      }
      appendLog('info', `离线皮肤：模组${r.modInstalled ? '已装' : '缺失'} · 配置${r.configExists ? '已生成' : '未生成'} · LocalSkin优先${r.localFirst ? '是' : '否'}`);
      await refreshLocalSkin();
    } catch (e) {
      toast('启用失败：' + (e.message || e));
      appendLog('error', '离线皮肤启用失败：' + (e.message || e));
    } finally {
      btn.disabled = false;
      btn.textContent = old;
      if (typeof off === 'function') off();
      if (L.offProgress) L.offProgress();
    }
  }

  async function refreshLocalSkin() {
    const a = curAcc();
    const el = $('#localSkinState');
    if (!el) return;
    if (!a || !hasElectron || !gameDir()) { el.textContent = ''; return; }
    try {
      const st = await L.localSkinStatus({ gameDir: gameDir(), playerName: a.name });
      const bits = [
        `CSL 模组 ${st.modInstalled ? '✓' : '—'}`,
        `配置 ${st.configExists ? '✓' : '—'}`,
        `LocalSkin 优先 ${st.localFirst ? '✓' : '—'}`,
        `皮肤文件 ${st.skinExists ? '✓' : '—'}`,
      ];
      el.textContent = bits.join(' · ');
    } catch (e) {
      el.textContent = '';
    }
  }

  /** 日志里别写完整用户目录，截图/分享时更干净 */
  function shortPath(p) {
    return String(p || '').replace(/^[A-Za-z]:\\Users\\[^\\]+/i, '~').replace(/^[A-Za-z]:\\Documents and Settings\\[^\\]+/i, '~');
  }

  function mcOf(v) {
    const s = String(v || '');
    let m = s.match(/^fabric-loader-[^-]+-(.+)$/);
    if (m) return m[1];
    m = s.match(/^fabric-(.+?)(?:-\d|$)/);
    if (m) return m[1];
    m = s.match(/^(?:forge|neoforge)-(.+?)(?:-\d|$)/);
    if (m) return m[1];
    return s;
  }

  function loaderOf(v) {
    const s = String(v || '');
    if (/^fabric/i.test(s)) return 'fabric';
    if (/^neoforge/i.test(s)) return 'neoforge';
    if (/^forge/i.test(s)) return 'forge';
    return '';
  }

  /* ---------------- 皮肤库（一键换肤） ---------------- */
  // 皮肤库缩略图：裁出「头部正面」放大成头像，比直接显示整张纹理好看得多
  const faceThumbCache = new Map();
  /** 从皮肤贴图裁出头部头像（32x32 底的正面 + 帽子层），返回 dataURL */
  function skinHeadDataUrl(dataUrl, size = 64) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = size;
          c.height = size;
          const ctx = c.getContext('2d');
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(img, 8, 8, 8, 8, 0, 0, size, size);
          ctx.drawImage(img, 40, 8, 8, 8, 0, 0, size, size);
          resolve(c.toDataURL('image/png'));
        } catch (e) {
          resolve('');
        }
      };
      img.onerror = () => resolve('');
      img.src = dataUrl;
    });
  }

  function faceThumb(it) {
    if (faceThumbCache.has(it.id)) return faceThumbCache.get(it.id);
    const p = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = 64;
          c.height = 64;
          const ctx = c.getContext('2d');
          ctx.imageSmoothingEnabled = false;
          ctx.clearRect(0, 0, 64, 64);
          ctx.drawImage(img, 8, 8, 8, 8, 0, 0, 64, 64); // 头正面
          ctx.drawImage(img, 40, 8, 8, 8, 0, 0, 64, 64); // 头饰层（有就叠上去）
          resolve(c.toDataURL('image/png'));
        } catch (e) {
          resolve(it.dataUrl);
        }
      };
      img.onerror = () => resolve(it.dataUrl);
      img.src = it.dataUrl;
    });
    faceThumbCache.set(it.id, p);
    return p;
  }

  async function renderSkinLib() {
    const box = $('#skinLib');
    if (!box) return;
    const items = state.skinLib || [];
    const cur = skinOf(curAcc()).dataUrl || '';
    const thumbs = await Promise.all(items.map(faceThumb));
    const tiles = items.map((it, i) => `
      <div class="skin-tile ${cur === it.dataUrl ? 'on' : ''}">
        <button type="button" class="skin-pick" aria-pressed="${cur === it.dataUrl ? 'true' : 'false'}" data-act="use-skin" data-id="${esc(it.id)}" title="${esc(skinTitle(it.name))}（点击更换）"><img src="${thumbs[i]}" alt="${esc(skinTitle(it.name))}"></button>
        <button type="button" class="skin-del" data-act="del-skin" data-id="${esc(it.id)}" aria-label="从皮肤库删除 ${esc(skinTitle(it.name))}" title="从皮肤库删除">×</button>
      </div>`).join('');
    box.innerHTML = tiles + `<button type="button" class="skin-tile add" data-act="pick-skin" title="从文件添加皮肤" aria-label="从文件添加皮肤">＋</button>`;
    const cnt = $('#skinLibCount');
    if (cnt) cnt.textContent = items.length ? `（${items.length} 张）` : '（空）';
  }

  async function refreshSkinLib() {
    if (!hasElectron) return;
    try {
      state.skinLib = await L.skinsList();
    } catch (e) {
      state.skinLib = [];
    }
    renderSkinLib();
  }

  /** 点皮肤库里的皮肤 = 一键更换（顺带同步到 CustomSkinLoader） */
  async function applySkinFromLib(id) {
    const a = curAcc();
    if (!a) { toast('请先选择一个账号'); return; }
    const it = (state.skinLib || []).find((x) => x.id === id);
    if (!it) return;
    a.skin = Object.assign({}, skinOf(a), { dataUrl: it.dataUrl, name: it.name });
    save();
    renderSkin();
    renderSkinLib();
    // 已经启用过 CSL 的话，立刻把新皮肤同步进去，下次进游戏就是新皮肤
    try {
      const cur = state.settings.version || '';
      const r = await L.skinsApply({
        gameDir: gameDir(),
        playerName: a.name,
        dataUrl: it.dataUrl,
        mc: mcOf(cur),
        loader: loaderOf(cur),
      });
      if (r.synced) {
        toast(r.autoInstalled ? '皮肤已换好，并自动装好 CustomSkinLoader，进游戏就能看到' : '皮肤已更换并同步到游戏', 3200);
        await refreshLocalSkin();
      } else {
        toast('皮肤已换好；当前版本不是 Fabric/Forge，原版没法加载皮肤模组（游戏内仍是默认皮肤）', 5200);
      }
    } catch (e) {
      toast('皮肤已更换，但同步到游戏失败：' + (e.message || e));
    }
  }

  async function deleteSkinFromLib(id) {
    if (!hasElectron) return;
    try {
      await L.skinsDelete({ id });
      await refreshSkinLib();
      toast('已从皮肤库删除');
    } catch (e) {
      toast('删除失败：' + (e.message || e));
    }
  }

  /* ---------------- 账号页 ---------------- */
  function renderAccounts() {
    $('#accList').innerHTML = state.accounts.length ? state.accounts.map((a) => `
      <div class="acc-item ${a.id === state.currentAccount ? 'current' : ''}">
        <img class="avatar" src="${a.avatar || makeAvatar(a.name, 'random', 8)}" alt="">
        <div class="acc-meta">
          <b>${esc(a.name)}</b>
          <span>${a.type === 'microsoft' ? '微软账号' : '离线账号'} · ${esc((a.uuid || '').slice(0, 18))}</span>
        </div>
        <div class="row-actions">
          ${a.id === state.currentAccount ? '<span class="badge">使用中</span>'
            : `<button type="button" class="btn sm" data-act="use-acc" data-id="${esc(a.id)}">使用</button>`}
          <button type="button" class="icon-btn" data-act="del-acc" data-id="${esc(a.id)}" aria-label="删除账号 ${esc(a.name)}" title="删除账号"><svg class="ic" aria-hidden="true"><use href="#i-trash"/></svg></button>
        </div>
      </div>`).join('') : '<div class="empty">还没有账号，请在右侧添加。</div>';
    // 账号列表里的头像优先用皮肤头部
    $('#accCount').textContent = `${state.accounts.length} 个`;
    renderSkin();
  }

  /* ---------------- 设置页 ---------------- */
  /** 关闭行为三选一的状态与点击（唯一入口，避免和弹窗里的"记住选择"打架） */
  function renderCloseBehavior() {
    const cur = (state.paths && state.paths.closeBehavior) || 'ask';
    $$('[data-act="close-behavior"]').forEach((b) => {
      const on = b.dataset.id === cur;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  /** 让 range 的轨道按当前值涂色：--fill = 已选比例 */
  function paintRange(el) {
    if (!el) return;
    const min = Number(el.min) || 0;
    const max = Number(el.max) || 100;
    const val = Number(el.value) || min;
    const pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
    el.style.setProperty('--fill', Math.max(0, Math.min(100, pct)).toFixed(2) + '%');
  }

  function renderSettings() {
    const s = state.settings;
    if (document.activeElement !== $('#memRange')) $('#memRange').value = s.mem;
    $('#memText').textContent = `${s.mem} MB（${(s.mem / 1024).toFixed(1)} GB）`;
    const op = Math.round((s.opacity || 1) * 100);
    $('#opacityRange').value = op;
    $('#opacityText').textContent = op + '%';
    $('#javaPath').value = s.javaPath;
    $('#gameDir').value = gameDir();
    if ($('#appRoot')) $('#appRoot').value = (state.paths && state.paths.root) || '';
    if ($('#bgImage')) $('#bgImage').value = s.bgImage ? String(s.bgImage).split(/[\\/]/).pop() : '';
    if (state.paths && state.paths.version) {
      const sub = document.querySelector('.tb-sub');
      if (sub) sub.textContent = 'FishCraftLauncher v' + state.paths.version;
    }
    $('#winW').value = s.winW; $('#winH').value = s.winH;
    $('#jvmArgs').value = s.jvm;
    if ($('#optOptimizedJvm')) $('#optOptimizedJvm').checked = s.optimizedJvm !== false;
    $('#clientId').value = s.clientId;
    $('#optFullscreen').checked = s.fullscreen;
    $('#optCloseLauncher').checked = s.closeLauncher;
    $('#optCheckAssets').checked = s.checkAssets;
    $('#optIsolate').checked = s.isolate;
    paintRange($('#memRange'));
    paintRange($('#opacityRange'));
    renderThemeFab();
    renderJavaState();
    renderUpdateState();
  }

  /* ---------------- 外观切换：右下角悬浮按钮 ---------------- */
  const MODE_ORDER = ['light', 'dark', 'system'];
  const MODE_META = {
    light: { icon: '#i-sun', label: '浅色' },
    dark: { icon: '#i-moon', label: '深色' },
    system: { icon: '#i-auto', label: '跟随系统' }
  };

  function renderThemeFab() {
    const fab = $('#themeFab');
    if (!fab) return;
    const mode = MODE_ORDER.includes(state.settings.mode) ? state.settings.mode : 'light';
    const meta = MODE_META[mode];
    const use = $('#themeFabIcon');
    if (use) use.setAttribute('href', meta.icon);
    const label = mode === 'system' ? `跟随系统（当前${sysDark() ? '深色' : '浅色'}）` : meta.label;
    fab.setAttribute('aria-label', `切换明暗外观，当前为${label}`);
    fab.setAttribute('title', `切换明暗外观 · ${label}`);
    fab.dataset.mode = mode;
  }

  function cycleMode() {
    const cur = MODE_ORDER.includes(state.settings.mode) ? state.settings.mode : 'light';
    const next = MODE_ORDER[(MODE_ORDER.indexOf(cur) + 1) % MODE_ORDER.length];
    state.settings.mode = next;
    state.settings.modeTouched = true;
    save();
    applyTheme();
    renderSettings();
    const label = MODE_META[next].label;
    toast('外观：' + label + (next === 'system' ? `（系统为${sysDark() ? '深色' : '浅色'}）` : ''));
  }

  const sysMedia = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const sysDark = () => !!(sysMedia && sysMedia.matches);

  /* ---- 强调色派生：填充色与文字色分开，各自保证 ≥ 4.5:1 ----
     唯一强调色固定为品牌蓝，不再提供色相选择。
     --accent-fill 与 --accent-text 由本函数按当前表面推导，CSS 不硬编码。 */
  const MIN_CONTRAST = 4.5;
  const ON_DARK = '#0b0f14';
  const ON_LIGHT = '#ffffff';
  const ACCENT = '#2b7bf0';

  function relLum(hex) {
    const n = String(hex).replace('#', '');
    const ch = n.length === 3 ? n.split('').map((c) => c + c) : n.match(/../g) || ['00', '00', '00'];
    const [r, g, b] = ch.slice(0, 3).map((h) => parseInt(h, 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function contrast(a, b) {
    const la = relLum(a), lb = relLum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }
  function mixHex(a, b, t) {
    const pa = String(a).replace('#', '').match(/../g).map((h) => parseInt(h, 16));
    const pb = String(b).replace('#', '').match(/../g).map((h) => parseInt(h, 16));
    return '#' + pa.map((v, i) => Math.round(v * t + pb[i] * (1 - t)).toString(16).padStart(2, '0')).join('');
  }
  /** 在 accent 基础上向 toward 方向逐步混合，直到与 against 的对比度达标 */
  function pushContrast(color, against, toward, min) {
    const target = min || MIN_CONTRAST;
    for (let i = 0; i <= 50; i++) {
      const t = 1 - i * 0.02;
      const c = i === 0 ? color : mixHex(color, toward, t);
      if (contrast(c, against) >= target) return c;
    }
    return toward;
  }

  function applyAccent(color, dark) {
    // 变量声明在 body 上，覆盖也必须写在 body 上：写在 <html> 上会被 body.dark 的声明盖掉
    const host = document.body;
    const surface = (getComputedStyle(host).getPropertyValue('--surface') || '#ffffff').trim();
    const on = dark ? ON_DARK : ON_LIGHT;
    const away = dark ? '#ffffff' : '#000000';
    // 填充色：承载 on 色文字的实心块（主按钮、选中的分段控件）
    const fill = pushContrast(color, on, away);
    const fillHover = pushContrast(mixHex(fill, away, 0.86), on, away);
    // 文字色：既要落在 surface 上，也要落在 accent-soft 软底上（选中态标签），
    // 所以按软底合成后的背景求一个更严的阈值
    const softOver = mixHex(color, surface, dark ? 0.24 : 0.11);
    const text = pushContrast(color, softOver, away, 5.2);
    host.style.setProperty('--accent', color);
    host.style.setProperty('--accent-fill', fill);
    host.style.setProperty('--accent-fill-hover', fillHover);
    host.style.setProperty('--on-accent', on);
    host.style.setProperty('--accent-text', text);
    host.style.setProperty('--accent-soft', `color-mix(in srgb, ${color} ${dark ? 24 : 11}%, transparent)`);
    host.style.setProperty('--accent-line', `color-mix(in srgb, ${color} ${dark ? 46 : 34}%, transparent)`);
    host.style.setProperty('--focus', `color-mix(in srgb, ${color} ${dark ? 52 : 42}%, transparent)`);
  }

  function applyTheme() {
    const s = state.settings;
    // 兼容旧存档：只有 dark 布尔值时迁移为 mode
    if (!s.mode) s.mode = s.dark ? 'dark' : 'light';
    // 没主动选过外观时，默认浅色（老版本存的是「跟随系统」，这里统一拉回浅色一次）
    if (!s.modeTouched && s.mode === 'system') s.mode = 'light';
    const dark = s.mode === 'system' ? sysDark() : s.mode === 'dark';
    s.dark = dark;
    document.body.classList.toggle('dark', dark);
    // 强调色按当前表面推导
    applyAccent(ACCENT, dark);
    // 明暗变了，背景蒙版要跟着换色
    if (typeof applyBackdrop === 'function') applyBackdrop();
  }

  /* ---------------- 下载队列（最多同时 3 个） ---------------- */
  const STATUS_TEXT = { queued: '排队中', running: '下载中', done: '已完成', error: '失败' };
  const KIND_LABEL = { vanilla: '官方', fabric: 'Fabric', forge: 'Forge' };

  function taskProgress(t) {
    const p = t.progress || {};
    if (t.status === 'done') return 100;
    if (p.percent != null) return p.percent;
    return p.total ? Math.round((p.done / p.total) * 100) : 0;
  }

  function renderQueue() {
    const list = state.queue || [];
    const panel = $('#queuePanel');
    if (!panel) return;
    if (!list.length) {
      panel.classList.add('hidden');
      $('#queueList').innerHTML = '';
      return;
    }
    panel.classList.remove('hidden');
    const running = list.filter((t) => t.status === 'running').length;
    const queued = list.filter((t) => t.status === 'queued').length;
    $('#queueStat').textContent = `运行 ${running}/3 · 排队 ${queued}`;
    $('#queueList').innerHTML = list.map((t) => {
      const p = t.progress || {};
      const pct = taskProgress(t);
      const label = t.status === 'error'
        ? (t.error || '失败')
        : `${STATUS_TEXT[t.status] || ''}${t.status === 'running' && p.phase ? ' ' + p.phase : ''}${t.status === 'running' ? ' ' + pct + '%' : ''}`.trim();
      const cls = t.status === 'done' ? 'ok' : t.status === 'error' ? 'err' : t.status === 'running' ? 'run' : '';
      const barCls = t.status === 'done' ? 'done' : t.status === 'error' ? 'error' : '';
      return `<div class="q-row">
        <div class="q-main">
          <div class="q-title">${esc(t.title)} <span class="badge">${KIND_LABEL[t.kind] || esc(t.kind)}</span></div>
          <div class="q-sub">${esc(t.status === 'running' && p.name ? p.phase + ' · ' + p.name : label)}</div>
          <div class="q-track"><div class="q-bar ${barCls}" style="width:${Math.min(100, pct)}%"></div></div>
        </div>
        <div class="q-state ${cls}">${esc(label)}</div>
        ${t.status === 'queued' ? `<button type="button" class="q-x" data-act="queue-drop" data-id="${t.id}" title="移出队列">×</button>` : ''}
      </div>`;
    }).join('');
  }

  function applyQueueUpdate(list) {
    state.queue = list || [];
    renderQueue();
    renderVersions();
    if (launching) {
      const t = state.queue.find((x) => x.title === state.version && x.status === 'running');
      if (t && t.progress) {
        const pct = taskProgress(t);
        setProgress(8 + pct * 0.55);
        setLaunchText(`${t.progress.phase || '下载'} ${pct}%`);
      }
    }
  }

  async function refreshQueue() {
    if (!hasElectron) return;
    try {
      applyQueueUpdate(await L.queueList());
    } catch (e) {}
  }

  /* ---------------- Java 一键部署 ---------------- */
  const JAVA_SOURCE = { bundled: '启动器自带', custom: '手动指定', system: '系统安装', path: 'PATH' };

  function renderJavaState() {
    const el = $('#javaState');
    if (!el) return;
    if (!hasElectron) { el.textContent = '演示模式'; return; }
    const j = state.java;
    el.textContent = j && j.path
      ? `已就绪 ${j.version || ''}${JAVA_SOURCE[j.source] ? '（' + JAVA_SOURCE[j.source] + '）' : ''}`
      : '未检测到，点右侧一键部署';
  }

  async function refreshJava() {
    if (!hasElectron) return null;
    try {
      state.java = await L.javaDetect({ javaPath: state.settings.javaPath });
    } catch (e) {
      state.java = null;
    }
    renderJavaState();
    renderEnv();
    return state.java;
  }

  let deployingJava = false;

  async function deployJava(majorHint) {
    if (!hasElectron) { toast('演示模式：需要桌面版'); return null; }
    if (deployingJava) { toast('Java 正在部署中，请稍候…'); return null; }
    deployingJava = true;
    let major = majorHint;
    try {
      if (!major) {
        try {
          major = (await L.javaRequire({ gameDir: gameDir(), version: state.version })).major;
        } catch (e) {
          major = 21;
        }
      }
      appendLog('info', `开始一键部署 Java ${major}…`);
      toast(`开始部署 Java ${major}，约 50 MB`);
      setProgress(4);
      const off = L.onJavaProgress ? L.onJavaProgress((p) => {
        const pct = p.percent || 0;
        setProgress(4 + pct * 0.9);
        if (launching) setLaunchText(p.phase === '解压 Java' ? '解压 Java…' : `部署 Java ${pct}%`);
        if (p.label && p.phase === '下载 Java' && pct === 0) appendLog('info', `Java 下载源：${p.label}`);
      }) : null;
      try {
        const r = await L.javaInstall({ major });
        state.settings.javaPath = r.path;
        save();
        appendLog('info', `Java 就绪：${r.path}${r.version ? '（' + r.version + '）' : ''}`);
        toast(`Java ${r.version || major} 已就绪`);
        await refreshJava();
        return r;
      } finally {
        if (typeof off === 'function') off();
        if (L.offJavaProgress) L.offJavaProgress();
      }
    } catch (e) {
      appendLog('error', 'Java 部署失败：' + (e.message || e));
      toast('Java 部署失败：' + (e.message || e));
      return null;
    } finally {
      deployingJava = false;
      setProgress(0);
    }
  }

  /* ---------------- 安装 / 启动 ---------------- */
  async function refreshEnv() {
    if (!hasElectron) return;
    state.env = await L.env({ gameDir: state.settings.gameDir || undefined, javaPath: state.settings.javaPath || undefined });
    renderEnv(); renderVersions(); renderMods(); renderSettings(); renderHero(); renderPacks(); renderSkin();
  }

  /** 只改启动按钮里的文字，保留图标与 #launchText 结构 */
  function setLaunchText(t) {
    const el = $('#launchText');
    if (el) el.textContent = t;
    else $('#launchBtn').textContent = t;
  }

  function setProgress(pct) {
    const bar = $('#progressBar');
    const box = $('#progress');
    if (!bar || !box) return;
    if (pct > 0) box.classList.add('show');
    bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
  }

  /** 安装：加入下载队列后立即返回，进度看队列面板 */
  async function doInstall(kind, id, btn) {
    if (!hasElectron) { toast('演示模式：请运行 npm start 后安装真实版本'); return; }
    if (!gameDir()) { toast('请先设置游戏目录'); return; }
    const req = Object.assign({
      kind, gameDir: gameDir(), javaPath: state.settings.javaPath, assets: state.settings.checkAssets
    }, kind === 'vanilla' ? { id } : { mc: id });
    try {
      const r = await L.queueAdd(req);
      const running = state.queue.filter((t) => t.status === 'running').length;
      toast(r.duplicated ? `${id} 已在队列中` : `已加入下载队列${running >= 3 ? '（排队等待）' : ''}`);
      appendLog('info', `加入下载队列：${id}（${KIND_LABEL[kind] || kind}）`);
      await refreshQueue();
      if (btn) btn.textContent = r.duplicated ? '已排队' : '排队中';
    } catch (e) {
      toast('加入队列失败：' + (e.message || e));
    }
  }

  /** 没有账号时自动建一个离线号，保证「一键启动」不被打断 */
  function ensureAccount() {
    if (curAcc()) return curAcc();
    let name = 'Player';
    let i = 1;
    while (state.accounts.some((a) => a.name.toLowerCase() === name.toLowerCase())) name = 'Player' + ++i;
    const acc = { id: 'a' + Date.now(), name, type: 'offline', uuid: uuidFromName(name), avatar: makeAvatar(name, 'random', 8) };
    state.accounts.push(acc);
    state.currentAccount = acc.id;
    save(); renderAccounts(); renderHero();
    appendLog('info', `已自动创建离线账号：${name}`);
    return acc;
  }

  let launching = false, running = false;

  /** 一键启动：自动建账号 → 自动补版本 → 自动部署 Java → 启动 */
  async function doLaunch() {
    if (launching || running) return;

    const btn = $('#launchBtn');
    launching = true;
    btn.disabled = true;
    setLaunchText('准备中…');
    $('#progress').classList.add('show');
    setProgress(5);

    if (!hasElectron) { demoLaunch(); return; }

    try {
      if (!gameDir()) throw new Error('未设置游戏目录，请到设置里选择 .minecraft');

      // 1) 账号：没有就自动建
      ensureAccount();

      // 2) 版本：没装就自动下载（进下载队列并等它完成）
      if (!isInstalled(state.version)) {
        appendLog('info', `版本 ${state.version} 未安装，自动开始下载…`);
        toast(`正在自动下载 ${state.version}…`);
        setLaunchText('下载游戏文件…');
        await L.install({
          kind: 'vanilla', id: state.version, gameDir: gameDir(),
          assets: state.settings.checkAssets, javaPath: state.settings.javaPath
        });
        appendLog('info', `版本 ${state.version} 下载完成`);
        await refreshEnv();
      } else if (state.settings.checkAssets) {
        // 2b) 已安装也要校验：中断过的安装会缺资源文件，直接启动会闪退
        setLaunchText('校验游戏文件…');
        const offV = L.onVerifyProgress ? L.onVerifyProgress((p) => {
          const pct = p.percent != null ? p.percent : (p.total ? Math.round((p.done / p.total) * 100) : 0);
          setLaunchText(`${p.phase || '校验'} ${pct}%`);
          setProgress(10 + pct * 0.5);
        }) : null;
        try {
          await L.verify({ version: state.version, gameDir: gameDir(), assets: true });
        } finally {
          if (typeof offV === 'function') offV();
          if (L.offVerifyProgress) L.offVerifyProgress();
        }
        await refreshEnv();
      }

      // 3) Java：没有就一键部署
      await refreshJava();
      if (!state.java || !state.java.path) {
        appendLog('info', '未检测到 Java，自动一键部署…');
        setLaunchText('部署 Java…');
        const r = await deployJava();
        if (!r) throw new Error('Java 部署失败，可在设置里手动指定 java.exe');
      } else {
        state.settings.javaPath = state.java.path;
        save();
      }

      // 4) 启动
      setProgress(92);
      setLaunchText('正在启动…');
      const a = curAcc();
      const r = await L.launch({
        gameDir: gameDir(), version: state.version, javaPath: state.settings.javaPath,
        maxMemory: state.settings.mem, width: state.settings.winW, height: state.settings.winH,
        fullscreen: state.settings.fullscreen, jvmArgs: state.settings.jvm, optimizedJvm: state.settings.optimizedJvm !== false,
        account: { name: a.name, uuid: a.uuid, accessToken: a.accessToken || '' }
      });
      if (!r.ok) throw new Error(r.error || '启动失败');
      launching = false; running = true;
      btn.disabled = false;
      btn.classList.add('running');
      setLaunchText('结束游戏');
      setProgress(100);
      if (state.settings.closeLauncher && L.minimize) L.minimize();
    } catch (e) {
      launching = false;
      btn.disabled = false;
      btn.classList.remove('running');
      setLaunchText('启动游戏');
      $('#progress').classList.remove('show');
      appendLog('error', e.message || String(e));
      toast('启动失败：' + (e.message || e));
    }
  }

  function demoLaunch() {
    const steps = LAUNCH_STEPS.slice();
    let i = 0;
    (function next() {
      if (i >= steps.length) {
        launching = false; running = true;
        const btn = $('#launchBtn');
        btn.disabled = false; btn.classList.add('running');
        $('#launchText').textContent = '结束游戏';
        return;
      }
      const st = steps[i++];
      appendLog(st.lv, st.msg);
      $('#progressBar').style.width = Math.round((i / steps.length) * 100) + '%';
      setTimeout(next, st.d);
    })();
  }

  function stopGame() {
    if (hasElectron) L.kill();
    running = false;
    const btn = $('#launchBtn');
    btn.classList.remove('running');
    $('#launchText').textContent = '启动游戏';
    $('#progress').classList.remove('show');
  }

  /* ---------------- 账号 ---------------- */
  function addOffline() {
    const name = ($('#offlineName').value || '').trim();
    if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) { toast('名称需为 3-16 位字母、数字或下划线'); return; }
    if (state.accounts.some((a) => a.name.toLowerCase() === name.toLowerCase())) { toast('该账号已存在'); return; }
    const acc = { id: 'a' + Date.now(), name, type: 'offline', uuid: uuidFromName(name), avatar: makeAvatar(name, 'random', 8) };
    state.accounts.push(acc);
    state.currentAccount = acc.id;
    $('#offlineName').value = '';
    save(); renderAccounts(); renderHero();
    toast('已添加离线账号 ' + name);
  }

  let msTimer = null;
  /** 把主进程返回的微软登录结果整理成账号对象（两处登录入口共用） */
  async function setCloseBehavior(mode) {
    const v = mode === 'minimize' || mode === 'quit' ? mode : 'ask';
    try {
      const r = await L.setCloseBehavior(v);
      if (!r || !r.ok) {
        toast('保存失败：' + ((r && r.error) || '未知错误'));
        return;
      }
      state.paths = Object.assign({}, state.paths, { closeBehavior: v });
      renderCloseBehavior();
      toast(
        v === 'ask' ? '点 × 时会问你' : v === 'minimize' ? '点 × 时最小化到托盘' : '点 × 时直接退出',
        2600,
      );
    } catch (e) {
      toast('设置失败：' + (e.message || e));
    }
  }

  async function makeMicrosoftAccount(r) {
    const acc = {
      id: 'a' + Date.now(),
      name: (r && r.name && String(r.name).trim()) || (r && r.gamertag) || '微软账号',
      type: 'microsoft',
      uuid: r && r.uuid,
      accessToken: r && r.accessToken,
      avatar: (r && r.avatar) || makeAvatar((r && r.name) || 'MS', 'random', 8),
      skin: r && r.skinDataUrl ? { variant: r.skinVariant || 'classic', dataUrl: r.skinDataUrl } : undefined,
    };
    if (acc.skin && acc.skin.dataUrl) {
      const head = await skinHeadDataUrl(acc.skin.dataUrl, 64);
      if (head) acc.avatar = head;
    }
    return acc;
  }

  async function addMicrosoft() {
    if (!hasElectron) { toast('演示模式：微软登录需要桌面版'); return; }
    if (!L.msLogin) { toast('当前版本还不支持内嵌微软登录'); return; }
    const btn = $('[data-act="login-ms"]');
    const old = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '登录中…'; }
    try {
      appendLog('info', '正在打开微软登录窗口…');
      const r = await L.msLogin();
      const acc = await makeMicrosoftAccount(r);
      state.accounts.push(acc);
      state.currentAccount = acc.id;
      save();
      renderAccounts();
      renderHero();
      toast('微软账号登录成功：' + acc.name, 3600);
      appendLog('info', '微软账号登录成功：' + acc.name);
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      if (/已取消/.test(msg)) {
        appendLog('info', '已取消微软登录');
        toast('已取消微软登录');
      } else if (/server_error|matching cookie|contextID|没有返回授权码|没有 code/i.test(msg)) {
        appendLog('error', '微软登录失败：' + msg);
        openBrowserLogin(msg);
      } else {
        appendLog('error', '微软登录失败：' + msg);
        toast('登录失败：' + msg, 5000);
      }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = old; }
    }
  }

  /* 微软登录的浏览器兜底：内嵌窗口被安全策略拦掉时用 */
  function openBrowserLogin(reason) {
    openModal('微软登录（浏览器方式）', `
      <p style="margin:0 0 8px">内嵌窗口被微软的登录策略拦住了（${esc(String(reason).slice(0, 80))}）。</p>
      <p class="tip" style="margin:0 0 12px">改用系统浏览器登录：点下面的按钮打开授权页，登录后浏览器会跳到一个<br>
        <code>login.live.com/oauth20_desktop.srf?code=...</code> 的页面（<b>页面可能是空白或报错，这是正常的</b>），
        <b>把地址栏那一整段网址复制下来</b>，粘贴到下面的输入框。</p>
      <div class="row" style="gap:8px;margin-bottom:10px">
        <button type="button" class="btn" data-act="ms-open-browser">在浏览器中打开登录页</button>
      </div>
      <label class="muted" style="display:block;margin-bottom:4px">粘贴回调链接：</label>
      <input id="msUrl" placeholder="https://login.live.com/oauth20_desktop.srf?code=..." style="width:100%" />
      <div class="row" style="justify-content:flex-end;gap:8px;margin-top:12px">
        <button type="button" class="btn" data-act="ms-cancel">取消</button>
        <button type="button" class="btn primary" data-act="ms-submit">完成登录</button>
      </div>
    `);

    $$('#modalBody [data-act="ms-open-browser"]').forEach((el) => {
      el.onclick = async () => {
        try {
          await L.msBrowserLogin();
          toast('已用浏览器打开登录页，登录后复制地址栏链接贴回来', 5000);
        } catch (e) {
          toast('打开浏览器失败：' + (e.message || e));
        }
      };
    });
    $$('#modalBody [data-act="ms-cancel"]').forEach((el) => (el.onclick = () => closeModal()));
    $$('#modalBody [data-act="ms-submit"]').forEach((el) => {
      el.onclick = async () => {
        const url = ($('#msUrl') || {}).value || '';
        if (!url.trim()) { toast('请先粘贴回调链接'); return; }
        el.disabled = true;
        el.textContent = '登录中…';
        try {
          const acc = await L.msCompleteUrl(url);
          const account = await makeMicrosoftAccount(acc);
          state.accounts.push(account);
          state.currentAccount = account.id;
          save();
          renderAccounts();
          renderHero();
          closeModal();
          toast('微软账号登录成功：' + account.name, 4000);
          appendLog('info', '微软账号登录成功：' + account.name);
        } catch (e) {
          toast('登录失败：' + (e.message || e), 6000);
          el.disabled = false;
          el.textContent = '完成登录';
        }
      };
    });
  }

  /* ---------------- 导入本地内容 ---------------- */
  function reportImport(r, label) {
    const parts = [`${label}导入完成：成功 ${r.imported.length}`];
    if (r.skipped.length) parts.push(`已存在 ${r.skipped.length}`);
    if (r.failed.length) parts.push(`失败 ${r.failed.length}`);
    toast(parts.join(' · '), 4200);
    if (r.imported.length) appendLog('info', `已导入 ${label}：${r.imported.join(', ')}`);
    if (r.skipped.length) appendLog('warn', `已存在跳过：${r.skipped.join(', ')}`);
    if (r.failed.length) appendLog('error', `导入失败：${r.failed.join(', ')}`);
  }

  async function importContent(type) {
    if (!hasElectron) { toast('需要桌面版'); return; }
    if (!gameDir()) { toast('请先设置游戏目录'); return; }
    const files = await L.pickContent({ type });
    if (!files || !files.length) return;
    try {
      const r = await L.importContent({ gameDir: gameDir(), type, files });
      reportImport(r, type === 'mod' ? '模组' : type === 'shader' ? '光影' : '材质包');
      await refreshEnv();
      if (type === 'mod') renderMods();
      else renderPacks();
    } catch (e) {
      toast('导入失败：' + (e.message || e));
      appendLog('error', '导入失败：' + (e.message || e));
    }
  }

  /* ---------------- 删除已下载版本 ---------------- */
  function confirmDeleteVersion(id) {
    if (!hasElectron) { toast('需要桌面版'); return; }
    const busy = (state.queue || []).some((t) => t.title === id && (t.status === 'running' || t.status === 'queued'));
    const isCur = state.version === id;
    openModal('删除版本', `
      <div class="confirm-box">
        <p class="confirm-title">确定删除 <b>${esc(id)}</b> 吗？</p>
        <p class="tip">只删除 <code>versions\\${esc(id)}</code>（jar / json / natives）。依赖库和资源文件是各版本共用的，会保留。</p>
        <p class="tip">文件会先放进回收站，误删可以从回收站还原。</p>
        ${busy ? '<p class="tip warn-text">该版本正在下载队列中，建议等它结束再删。</p>' : ''}
        ${isCur ? '<p class="tip warn-text">这是当前使用的版本，删除后需要重新下载才能启动。</p>' : ''}
        <div class="confirm-actions">
          <button type="button" class="btn ghost" data-act="modal-close">取消</button>
          <button type="button" class="btn danger" data-act="del-version-ok" data-id="${esc(id)}">删除</button>
        </div>
      </div>`);
  }

  async function deleteVersion(id) {
    closeModal();
    try {
      await L.deleteVersion({ id, gameDir: gameDir() });
      appendLog('info', `已删除版本：${id}`);
      toast(`已删除版本：${id}`);
      if (state.version === id) {
        const rest = installedList().filter((v) => v !== id);
        if (rest.length) {
          state.version = rest[0];
          save();
        }
      }
      await refreshEnv();
      renderHero();
      renderVersions();
    } catch (e) {
      appendLog('error', '删除版本失败：' + (e.message || e));
      toast('删除失败：' + (e.message || e));
    }
  }

  /* ---------------- 弹窗 / 版本切换（只列已下载） ---------------- */
  function openModal(title, html) {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = html;
    $('#modal').classList.remove('hidden');
  }

  function closeModal() {
    $('#modal').classList.add('hidden');
  }

  function installedList() {
    const list = ((state.env && state.env.installedVersions) || state.installed || []).slice();
    return list.sort((a, b) => String(b).localeCompare(String(a), 'en', { numeric: true }));
  }

  function pickVersion() {
    if (!hasElectron) { switchPage('versions'); return; }
    const inst = installedList();
    if (!inst.length) {
      toast('还没有已下载的版本，先去「版本管理」下载一个');
      switchPage('versions');
      return;
    }
    const rows = inst.map((id) => {
      const cur = id === state.version;
      const kind = /^fabric-loader/i.test(id) ? 'Fabric' : /^forge/i.test(id) ? 'Forge' : '官方版本';
      return `<button type="button" class="pick-row ${cur ? 'on' : ''}" data-act="use-version" data-id="${esc(id)}">
        <span class="pick-info">
          <span class="pick-name">${esc(id)}</span>
          <span class="pick-sub">${kind} · 已下载</span>
        </span>
        ${cur ? '<span class="pick-tag">当前</span>' : ''}
      </button>`;
    }).join('');
    openModal(`切换版本（已下载 ${inst.length} 个）`, rows);
  }

  /* ---------------- 事件 ---------------- */
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act, id = el.dataset.id;

    switch (act) {
      case 'min': hasElectron ? L.minimize() : toast('桌面端才支持窗口控制'); break;
      case 'max': hasElectron ? L.maximize() : toast('桌面端才支持窗口控制'); break;
      case 'close': hasElectron ? L.close() : toast('桌面端才支持窗口控制'); break;
      case 'pick-version': pickVersion(); break;
      case 'pick-account': switchPage('accounts'); break;
      case 'deploy-java': deployJava(); break;
      case 'refresh-java': refreshJava().then(() => toast(state.java && state.java.path ? '已检测到 Java' : '仍未检测到 Java')); break;
      case 'queue-drop': if (hasElectron) L.queueRemove(+id).then(refreshQueue); break;
      case 'queue-clear': if (hasElectron) L.queueClear().then(refreshQueue); break;

      case 'store-tab': state.store.type = id; state.store.items = []; renderStore(); doStoreSearch(); break;
      case 'store-search': doStoreSearch(); break;
      case 'store-install': storeInstall(id, el); break;
      case 'pack-toggle': togglePack(id); break;
      case 'pack-del': deletePack(id); break;
      case 'import-mod': importContent('mod'); break;
      case 'import-pack': importContent(state.store.type === 'shader' ? 'shader' : 'resourcepack'); break;
      case 'srv-kind': state.srv.kind = id === 'vanilla' ? 'vanilla' : 'paper'; renderSrvState(); break;
      case 'p2p-gen': p2pGenRoom(); break;
      case 'p2p-start': p2pStart(); break;
      case 'p2p-stop': p2pStop(); break;
      case 'p2p-admin': if (hasElectron && L.relaunchAdmin) L.relaunchAdmin(); break;
      case 'p2p-copy': {
        const ip = (state.p2p && state.p2p.virtualIp) || '10.144.144.1';
        const port = +($('#srvPort') && $('#srvPort').value) || 25565;
        navigator.clipboard.writeText(ip + ':' + port).then(() => toast('已复制：' + ip + ':' + port, 4000)).catch(() => {});
        break;
      }
      case 'crash-export': crashExport(); break;
      case 'crash-open': if (hasElectron && state.lastCrash && state.lastCrash.report) L.open(state.lastCrash.report); break;
      case 'crash-close': closeModal(); break;
      case 'check-update': checkUpdate(); break;
      case 'download-update': downloadUpdate(); break;
      case 'open-update-page': if (hasElectron) L.open('https://github.com/Him-Wang/FCL/releases'); break;
      case 'srv-cmd': srvCmd(); break;
      case 'srv-clear': { const b = $('#srvConsole'); if (b) b.textContent = ''; break; }
      case 'lan-refresh': refreshLanInfo(); break;
      case 'lan-copy': lanCopy(id); break;
      case 'lan-firewall': lanFirewall(); break;
      case 'lan-upnp': lanUpnp(); break;
      case 'srv-create': srvCreate(); break;
      case 'srv-start': srvStart(); break;
      case 'srv-stop': srvStop(); break;
      case 'srv-open': if (hasElectron && L.open) L.open(state.srv.dir); break;
      case 'close-behavior': setCloseBehavior(id); break;
      case 'pick-skin': pickSkin(); break;
      case 'reset-skin': resetSkin(); break;
      case 'skin-variant': setSkinVariant(id); break;
      case 'upload-skin': uploadSkin(); break;
      case 'enable-local-skin': enableLocalSkin(); break;
      case 'use-skin': applySkinFromLib(id); break;
      case 'del-skin': deleteSkinFromLib(id); break;
      case 'open-packs':
        if (hasElectron && gameDir()) L.open(gameDir() + '\\' + (state.store.type === 'shader' ? 'shaderpacks' : 'resourcepacks'));
        break;
      case 'install-iris': installIris(el); break;

      case 'ver-tab': verTab = id; renderVersions(); break;
      case 'use-version': state.version = id; save(); renderHero(); renderVersions(); closeModal(); toast('当前版本：' + id); break;
      case 'install-vanilla': doInstall('vanilla', id, el); break;
      case 'install-fabric': doInstall('fabric', id, el); break;
      case 'install-forge': doInstall('forge', id, el); break;

      case 'mod-online-search': modOnlineSearch(); break;
      case 'mod-download': modDownload(id, el); break;
      case 'mod-source':
        state.modSource = id;
        renderModSourceUi();
        renderOnlineMods();
        if (id === 'modrinth') modOnlineSearch();
        else {
          $('#modOnlineHint').textContent = '· 输入中文名或点热门标签';
        }
        break;
      case 'cn-tag':
        $('#modOnlineSearch').value = id;
        modOnlineSearch();
        break;
      case 'cn-open': {
        const it = (state.cnMods || [])[+id];
        if (it && hasElectron) L.open(it.url);
        break;
      }
      case 'cn-download': modDownloadFromCn(+id, el); break;
      case 'del-version': confirmDeleteVersion(id); break;
      case 'del-version-ok': deleteVersion(id); break;
      case 'modal-close': closeModal(); break;
      case 'real-mod-toggle':
      case 'real-mod-del': {
        if (!hasElectron) { toast('桌面端才支持操作本机模组'); break; }
        const fn = act === 'real-mod-toggle' ? 'modToggle' : 'modDelete';
        ipcCall(fn, { gameDir: gameDir(), name: id }).then(async (r) => {
          toast(act === 'real-mod-toggle' ? '已切换模组状态' : '已删除到回收站');
          await refreshEnv();
        }).catch((err) => toast('操作失败：' + err.message));
        break;
      }
      case 'open-sub': {
        if (!hasElectron || !gameDir()) { toast('桌面端才支持打开目录'); break; }
        const p = id && id !== '.' ? gameDir() + '\\' + id : gameDir();
        L.open(p).then((ok) => { if (!ok) toast('打开失败：' + p); });
        break;
      }
      case 'browse-mods':
        if (hasElectron && gameDir()) L.open(gameDir() + '\\mods'); else toast('请先设置游戏目录'); break;
      case 'refresh-mods': refreshEnv().then(() => toast('已刷新')); break;

      case 'use-acc': state.currentAccount = id; save(); renderAccounts(); renderHero(); break;
      case 'del-acc':
        state.accounts = state.accounts.filter((a) => a.id !== id);
        if (state.currentAccount === id) state.currentAccount = state.accounts[0] ? state.accounts[0].id : null;
        save(); renderAccounts(); renderHero(); break;
      case 'login-offline': addOffline(); break;
      case 'login-ms': addMicrosoft(); break;

      case 'pick-java':
      case 'pick-dir': {
        if (!hasElectron) { toast('桌面端才支持选择文件夹'); break; }
        L.pickFolder().then((p) => {
          if (!p) return;
          if (act === 'pick-java') state.settings.javaPath = p; else state.settings.gameDir = p;
          save(); renderSettings(); refreshEnv();
        });
        break;
      }
      case 'open-gamedir':
        if (hasElectron && gameDir()) L.open(gameDir()); else toast('桌面端才支持打开目录'); break;
      case 'open-root':
        if (hasElectron && state.paths) L.open(state.paths.root); else toast('桌面端才支持打开目录'); break;
      case 'pick-root': changeRoot(); break;
      case 'pick-bg': pickBackground(); break;
      case 'clear-bg': clearBackground(); break;
      case 'restart-app': if (hasElectron && L.restart) L.restart(); break;
    }
  });

  function ipcCall(name, payload) {
    return name === 'modToggle' ? L.modToggle(payload) : L.modDelete(payload);
  }

  $('#launchBtn').addEventListener('click', () => (running ? stopGame() : doLaunch()));
  $('#modalClose').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', (e) => { if (e.target === $('#modal')) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
  $('#clearLog').addEventListener('click', () => { $('#log').innerHTML = '<div class="log-empty">日志已清空。</div>'; });
  $('#verSearch').addEventListener('input', renderVersions);
  $('#modSearch').addEventListener('input', renderMods);
  $('#modOnlineSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') modOnlineSearch(); });
  $('#modOnlineLoader').addEventListener('change', modOnlineSearch);
  $('#modOnlineMc').addEventListener('change', modOnlineSearch);

  $$('.nav-item').forEach((b) => b.addEventListener('click', () => switchPage(b.dataset.page)));
  $$('[data-login]').forEach((b) => b.addEventListener('click', () => {
    $$('[data-login]').forEach((x) => x.classList.toggle('active', x === b));
    const m = b.dataset.login === 'microsoft';
    $('#loginOffline').classList.toggle('hidden', m);
    $('#loginMs').classList.toggle('hidden', !m);
  }));

  if ($('#srvCmd')) {
    $('#srvCmd').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); srvCmd(); }
    });
  }

  $('#memRange').addEventListener('input', (e) => {
    const mem = +e.target.value;
    paintRange(e.target);
    state.settings.mem = mem;
    const txt = $('#memText');
    if (txt) txt.textContent = `${mem} MB（${(mem / 1024).toFixed(1)} GB）`;
    save();
  });
  $('#memRange').addEventListener('change', () => {
    // 松手后再刷新依赖内存的部分（侧栏、启动预估等）
    renderSettings();
    renderEnv();
  });
  if ($('#skinFile')) $('#skinFile').addEventListener('change', onSkinFileChosen);
  if ($('#bgFile')) $('#bgFile').addEventListener('change', onBgFileChosen);

  /* 拖拽兜底：不用任何文件对话框——把 PNG 拖到皮肤卡片 / 设置页 */
  function dropTargets(el, onFile) {
    if (!el) return;
    const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
    el.addEventListener('dragover', (e) => { stop(e); el.classList.add('drop-hot'); });
    el.addEventListener('dragleave', (e) => { stop(e); el.classList.remove('drop-hot'); });
    el.addEventListener('drop', async (e) => {
      stop(e);
      el.classList.remove('drop-hot');
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) onFile(f);
    });
  }
  dropTargets($('#skinPanel'), async (file) => {
    const input = $('#skinFile');
    if (!input) return;
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
  });
  dropTargets($('#page-settings'), async (file) => {
    const input = $('#bgFile');
    if (!input) return;
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
  });
  $('#opacityRange').addEventListener('input', (e) => {
    const pct = +e.target.value;
    paintRange(e.target);
    state.settings.opacity = pct / 100;
    $('#opacityText').textContent = pct + '%';
    save();
    applyBackdrop();
  });
  ['javaPath', 'winW', 'winH', 'jvmArgs', 'clientId'].forEach((k) => {
    $('#' + k).addEventListener('change', (e) => {
      state.settings[k] = (k === 'winW' || k === 'winH') ? +e.target.value || 0 : e.target.value;
      save(); renderEnv();
    });
  });
  $('#gameDir').addEventListener('change', (e) => { state.settings.gameDir = e.target.value; save(); refreshEnv(); });
  [['optFullscreen', 'fullscreen'], ['optCloseLauncher', 'closeLauncher'], ['optCheckAssets', 'checkAssets'], ['optIsolate', 'isolate'], ['optOptimizedJvm', 'optimizedJvm']]
    .forEach(([el, key]) => {
      $('#' + el).addEventListener('change', (e) => { state.settings[key] = e.target.checked; save(); });
    });
  $('#resetBtn').addEventListener('click', () => { localStorage.removeItem(KEY); toast('已重置，重启启动器后生效'); });
  $('#themeFab').addEventListener('click', cycleMode);

  // 开发辅助：Ctrl+R / F5 直接刷新界面，改完代码立即看效果
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey && (e.key === 'r' || e.key === 'R')) || e.key === 'F5') {
      e.preventDefault();
      location.reload();
    }
  });

  /* ---------------- 初始化 ---------------- */
  load();
  // 跟随系统：系统切换深浅色时实时生效（仅 mode=system 时响应）
  if (sysMedia) {
    const onSys = () => { if (state.settings.mode === 'system') { applyTheme(); renderSettings(); } };
    if (sysMedia.addEventListener) sysMedia.addEventListener('change', onSys);
    else if (sysMedia.addListener) sysMedia.addListener(onSys);
  }
  applyTheme();
  renderHero(); renderNews(); renderVersions(); renderMods(); renderAccounts(); renderSettings(); renderEnv();
  fillStoreMc(); fillModFilters(); renderModSourceUi(); renderStore(); renderOnlineMods();
  // 应用背景（壁纸 + 蒙版）与背景透明度
  applyBackdrop();

  if (hasElectron) {
    if (L.onP2pLog) L.onP2pLog((line) => {
      srvLog(line);
      if (p2pNeedAdmin(line)) state.p2p = Object.assign({ running: false }, state.p2p);
      if (/ipv4/i.test(line)) {
        const m = /(\d+\.\d+\.\d+\.\d+)/.exec(line);
        if (m) { state.p2p = Object.assign({ running: true }, state.p2p, { virtualIp: m[1] }); p2pRender(); }
      }
    });
    if (L.onP2pState) L.onP2pState((st) => {
      state.p2p = Object.assign({}, state.p2p, st);
      p2pRender();
      if (st && st.running === false) srvLog('[P2P] 进程已退出');
    });
    L.onLog((l) => appendLog(l.lv, l.msg));
    if (L.onCrash) L.onCrash((info) => showCrashDialog(info));
    L.onGameExit((e) => {
      if (!running) return;
      stopGameState();
      const code = e && e.code;
      if (code === 0) { toast('游戏已退出'); return; }
      const crash = e && e.crash;
      if (crash) {
        toast(`游戏崩溃：${crash.description || crash.error || '见日志'}`, 6000);
        appendLog('error', `游戏崩溃：${crash.description || ''} ${crash.error || ''}`.trim());
        appendLog('error', `崩溃报告：${crash.file}`);
      } else {
        toast(`游戏异常退出（代码 ${code}）`, 5000);
      }
    });
    L.onGameReady(() => {}); // 主进程已经往日志里写了「游戏窗口已就绪」，这里不再重复
    if (L.onQueue) L.onQueue(applyQueueUpdate);
    if (L.onTrayHint) L.onTrayHint(() => toast('已最小化到托盘，右键托盘图标可以退出', 4200));

    // 第一次点 × 时，主进程通知界面弹窗询问：最小化到托盘 or 直接退出
    if (L.onCloseTimeout) {
      L.onCloseTimeout(() => toast('界面刚才有点卡，这次没关成，请再点一次 ×', 4200));
    }

    if (L.onAskClose) {
      L.onAskClose(() => {
        openModal('关闭 FCL', `
          <p style="margin:0 0 10px">要把 FCL <b>最小化到托盘</b>，还是<b>直接退出</b>？</p>
          <p class="tip" style="margin:0 0 14px">最小化后可从任务栏托盘的小鱼图标重新打开；游戏正在运行时建议最小化。这个选择以后可以在「设置 → 偏好」里修改。</p>
          <label class="check" style="margin-bottom:14px"><input type="checkbox" id="closeRemember" checked /> 记住我的选择，以后不再询问</label>
          <div class="row" style="justify-content:flex-end;gap:8px">
            <button type="button" class="btn" data-act="close-quit">直接退出</button>
            <button type="button" class="btn primary" data-act="close-tray">最小化到托盘</button>
          </div>
        `);
        const ask = (minimize) => {
          const remember = $('#closeRemember') ? $('#closeRemember').checked : true;
          closeModal();
          if (L.closeChoice) L.closeChoice({ minimize, remember });
        };
        $$('#modalBody [data-act="close-tray"]').forEach((el) => (el.onclick = () => ask(true)));
        $$('#modalBody [data-act="close-quit"]').forEach((el) => (el.onclick = () => ask(false)));
      });
    }
    refreshQueue();
    refreshJava();
    refreshSkinLib();
    refreshPaths();

    refreshEnv().then(async () => {
      appendLog('info', `已连接本机环境：${shortPath(gameDir())}`);
      try {
        state.manifest = await L.manifest();
        renderVersions();
        fillStoreMc();
        renderNews();
        appendLog('info', `已获取官方版本清单（${state.manifest.length} 个版本）`);
        // 首次启动默认选中最新的正式版（含 26.x 等新版本）
        if (fresh) {
          const rel = state.manifest.find((v) => v.type === 'release');
          if (rel) {
            state.version = rel.id;
            save();
            renderHero();
            renderVersions();
            fillStoreMc();
          }
        }
      } catch (e) {
        appendLog('warn', '版本清单获取失败，使用内置示例数据：' + e.message);
      }
      doStoreSearch(); // 进入下载中心前先拉一次热门资源
      fillModFilters();
      modOnlineSearch(); // 模组页的「在线模组」也拉一次真实热门
    });
  } else {
    appendLog('warn', '当前在浏览器中打开，本机探测 / 下载 / 启动不可用，请运行 npm start。');
  }

  function stopGameState() {
    running = false;
    const btn = $('#launchBtn');
    btn.classList.remove('running');
    $('#launchText').textContent = '启动游戏';
    $('#progress').classList.remove('show');
  }
})();
