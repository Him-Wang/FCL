(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const KEY = 'craftlauncher.v1';
  const L = window.launcher || null;
  const hasElectron = !!L;

  /* ---------------- 状态 ---------------- */
  const state = {
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
      jvm: '-XX:+UseG1GC -XX:+ParallelRefProcEnabled',
      color: '#2b7bf0', dark: false, mode: 'light', theme: '', clientId: '',
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
    box.scrollTop = box.scrollHeight;
  }

  function switchPage(p) {
    state.page = p;
    $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.page === p));
    $$('.page').forEach((s) => s.classList.toggle('active', s.id === 'page-' + p));
    $('.content').scrollTop = 0;
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
      chips.push(`<button class="chip jump" data-act="open-sub" data-id="saves">打开存档目录 <b>${(e.saves || []).length} 个</b></button>`);
      chips.push(`<button class="chip jump" data-act="open-sub" data-id="mods">打开模组目录 <b>${(e.localMods || []).length} 个</b></button>`);
      chips.push(`<button class="chip jump" data-act="open-sub" data-id=".">打开游戏目录</button>`);
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

  function vanillaList() {
    if (state.manifest) return state.manifest;
    return VERSIONS.filter((v) => v.type === 'release' || v.type === 'snapshot')
      .map((v) => ({ id: v.id, type: v.type, time: v.date }));
  }

  function renderVersions() {
    const tabs = [['all', '全部'], ['release', '正式版'], ['snapshot', '快照'], ['fabric', 'Fabric'], ['forge', 'Forge'], ['installed', '已安装']];
    $('#verTabs').innerHTML = tabs.map(([k, l]) =>
      `<button class="tab ${verTab === k ? 'active' : ''}" data-act="ver-tab" data-id="${k}">${l}</button>`).join('');

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
          <button class="btn sm" data-act="install-${verTab}" data-id="${esc(mc)}">安装</button>
        </div>`).join('');
    } else {
      let list = vanillaList().filter((v) => verTab === 'all' || v.type === verTab);
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
        const badge = `<span class="badge ${v.type}">${TYPE_LABEL[v.type] || v.type}</span>`;
        let act;
        if (task) act = `<button class="btn sm" disabled>${task.status === 'queued' ? '排队中' : taskProgress(task) + '%'}</button>`;
        else if (cur) act = '<button class="btn sm primary" disabled>当前版本</button>';
        else if (inst) act = `<button class="btn sm" data-act="use-version" data-id="${esc(v.id)}">设为当前</button>`;
        else act = `<button class="btn sm" data-act="install-vanilla" data-id="${esc(v.id)}">下载</button>`;
        if (inst && !task) {
          act += `<button class="icon-btn danger" data-act="del-version" data-id="${esc(v.id)}" title="删除这个版本"><svg class="ic"><use href="#i-trash"/></svg></button>`;
        }
        return `<div class="row-item">
          <div class="row-main">
            <div class="row-title">${esc(v.id)} ${badge}</div>
            <div class="row-sub">${esc(String(v.time || '-').slice(0, 10))}</div>
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

  function applyBackdrop() {
    const s = state.settings;
    const photo = $('#bgPhoto');
    const tint = $('#bgTint');
    if (!photo || !tint) return;
    const alpha = typeof s.opacity === 'number' ? s.opacity : 1;

    if (s.bgImage) {
      photo.style.display = 'block';
      photo.style.backgroundImage = `url("${toFileUrl(s.bgImage)}")`;
    } else {
      photo.style.display = 'none';
      photo.style.backgroundImage = 'none';
    }

    const rgb = hexToRgb(getComputedStyle(document.body).getPropertyValue('--bg')) || [244, 246, 249];
    // 有壁纸时蒙版更重一点，保证文字可读；没有壁纸时就是整个窗口的背景透明度
    const a = s.bgImage ? 0.42 + 0.5 * alpha : alpha;
    tint.style.background = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a.toFixed(3)})`;
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
            <button class="btn ghost" data-act="modal-close">稍后重启</button>
            <button class="btn primary" data-act="restart-app">立即重启</button>
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
          <div class="mod-icon" style="background:${modColor(m.name)}">${esc(m.name.slice(0, 1).toUpperCase())}</div>
          <div class="row-main">
            <div class="row-title">${esc(m.name.replace(/\.jar$/, ''))} ${m.enabled ? '' : '<span class="badge">已禁用</span>'}</div>
            <div class="row-sub">${m.size} KB · 本机 mods 目录</div>
          </div>
          <div class="switch ${m.enabled ? 'on' : ''}" data-act="real-mod-toggle" data-id="${esc(m.name)}"></div>
          <button class="icon-btn" data-act="real-mod-del" data-id="${esc(m.name)}"><svg class="ic"><use href="#i-trash"/></svg></button>
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
      $('#modCnTags').innerHTML = CN_HOT_TAGS.map((t) => `<button class="tag-btn" data-act="cn-tag" data-id="${esc(t)}">${esc(t)}</button>`).join('');
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
          <div class="cn-actions">
            <button class="btn sm ghost" data-act="cn-open" data-id="${i}">百科</button>
            <button class="btn sm" data-act="cn-download" data-id="${i}">一键下载</button>
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
        <button class="btn sm" data-act="mod-download" data-id="${esc(it.id)}" data-title="${esc(it.title)}">一键下载</button>
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

  function modColor(name) {
    return `hsl(${hashStr(name) % 360} 55% 46%)`;
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
      .map(([k, l]) => `<button class="tab ${state.store.type === k ? 'active' : ''}" data-act="store-tab" data-id="${k}">${l}</button>`).join('');
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
        <button class="btn sm" data-act="store-install" data-id="${esc(it.id)}" data-title="${esc(it.title)}">${btnLabel}</button>
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
        ${isShader ? '' : `<div class="switch ${on ? 'on' : ''}" data-act="pack-toggle" data-id="${esc(p.name)}" title="${on ? '停用' : '启用'}"></div>`}
        <button class="icon-btn danger" data-act="pack-del" data-id="${esc(p.name)}" title="删除"><svg class="ic"><use href="#i-trash"/></svg></button>
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
    '06-fatfish': '肥鱼 · FMCL',
  };
  const skinTitle = (name) => SKIN_NAMES[String(name).replace(/\.png$/i, '')] || name;
    function skinOf(a) {
    return (a && a.skin) || { variant: 'classic', dataUrl: '' };
  }

  function renderSkin() {
    const a = curAcc();
    const who = $('#skinWho');
    if (who) who.textContent = a ? `· ${a.name}（${a.type === 'microsoft' ? '微软账号' : '离线账号'}）` : '· 先选择一个账号';
    const variant = skinOf(a).variant || 'classic';
    $$('[data-act="skin-variant"]').forEach((b) => b.classList.toggle('active', b.dataset.id === variant));
    const btn = $('#skinUploadBtn');
    if (btn) btn.classList.toggle('hidden', !(a && a.type === 'microsoft' && a.accessToken && skinOf(a).dataUrl));
    const hint = $('#skinHint');
    if (hint) {
      hint.textContent = !a
        ? '先在上方添加 / 选中一个账号，再给这个账号设置皮肤。'
        : a.type === 'microsoft'
          ? '选好皮肤和身材后点「上传到微软账号」，官方服务器上立即生效；令牌过期时重新登录一次即可。'
          : '离线账号：点「在游戏内生效」会自动装 CustomSkinLoader（Fabric/Forge 版本）并把皮肤写进它的本地皮肤目录；装好后先进一次游戏让 CSL 生成配置，之后再进游戏就能看到自己的皮肤。';
    }
    drawSkin(a);
    refreshLocalSkin();
    renderSkinLib();
  }

  /** 用皮肤贴图拼一个 2D 小人预览（不依赖 three.js） */
  function drawSkin(a) {
    const canvas = $('#skinPreview');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const S = 6; // 每个皮肤像素放大 6 倍
    const ox = Math.round((W - 16 * S) / 2);
    const oy = Math.round((H - 32 * S) / 2);
    const slim = skinOf(a).variant === 'slim';

    const placeholder = () => {
      const cols = { head: '#e0b48f', body: '#4a7ed8', limb: '#3f6cc0', eye: '#2b3440' };
      ctx.fillStyle = cols.head;
      ctx.fillRect(ox + 4 * S, oy, 8 * S, 8 * S);
      ctx.fillStyle = cols.body;
      ctx.fillRect(ox + 4 * S, oy + 8 * S, 8 * S, 12 * S);
      ctx.fillStyle = cols.limb;
      ctx.fillRect(ox + 0 * S, oy + 8 * S, 4 * S, 12 * S);
      ctx.fillRect(ox + 12 * S, oy + 8 * S, 4 * S, 12 * S);
      ctx.fillStyle = '#2f3f63';
      ctx.fillRect(ox + 4 * S, oy + 20 * S, 4 * S, 12 * S);
      ctx.fillRect(ox + 8 * S, oy + 20 * S, 4 * S, 12 * S);
      ctx.fillStyle = cols.eye;
      ctx.fillRect(ox + 6 * S, oy + 3 * S, 1 * S, 1 * S);
      ctx.fillRect(ox + 9 * S, oy + 3 * S, 1 * S, 1 * S);
    };

    const dataUrl = skinOf(a).dataUrl;
    if (!dataUrl) {
      placeholder();
      return;
    }

    const img = new Image();
    img.onload = () => {
      const legacy = img.height < 64; // 老版 64×32 皮肤没有左侧手臂/腿的贴图
      const aw = slim ? 3 : 4;
      const blit = (sx, sy, sw, sh, dx, dy, flip) => {
        ctx.save();
        if (flip) {
          ctx.translate(dx + sw * S, dy);
          ctx.scale(-1, 1);
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw * S, sh * S);
        } else {
          ctx.drawImage(img, sx, sy, sw, sh, dx, dy, sw * S, sh * S);
        }
        ctx.restore();
      };
      // 头 / 身体
      blit(8, 8, 8, 8, ox + 4 * S, oy);
      blit(20, 20, 8, 12, ox + 4 * S, oy + 8 * S);
      // 手臂（角色右臂在画面左侧）
      blit(44, 20, aw, 12, ox + (4 - aw) * S, oy + 8 * S);
      if (legacy) blit(44, 20, aw, 12, ox + 12 * S, oy + 8 * S, true);
      else blit(36, 52, aw, 12, ox + 12 * S, oy + 8 * S);
      // 腿
      blit(4, 20, 4, 12, ox + 4 * S, oy + 20 * S);
      if (legacy) blit(4, 20, 4, 12, ox + 8 * S, oy + 20 * S, true);
      else blit(20, 52, 4, 12, ox + 8 * S, oy + 20 * S);
    };
    img.onerror = placeholder;
    img.src = dataUrl;
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

  async function enableLocalSkin() {
    const a = curAcc();
    if (!a) { toast('请先选择一个账号'); return; }
    if (!skinOf(a).dataUrl) { toast('请先选择一个皮肤文件'); return; }
    if (!hasElectron) { toast('需要桌面版'); return; }
    const mc = mcOf(state.version);
    const loader = loaderOf(state.version);
    if (!loader) {
      toast('当前是原版版本，皮肤需要 Fabric / Forge 版本；先装个 Fabric 版本再切换过来', 5000);
      return;
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
      <div class="skin-tile ${cur === it.dataUrl ? 'on' : ''}" data-act="use-skin" data-id="${esc(it.id)}" title="${esc(skinTitle(it.name))}（点击更换）">
        <img src="${thumbs[i]}" alt="">
        <button class="skin-del" data-act="del-skin" data-id="${esc(it.id)}" title="从皮肤库删除">×</button>
      </div>`).join('');
    box.innerHTML = tiles + `<button class="skin-tile add" data-act="pick-skin" title="从文件添加皮肤">＋</button>`;
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
        ${a.id === state.currentAccount ? '<button class="btn sm primary" disabled>使用中</button>'
          : `<button class="btn sm" data-act="use-acc" data-id="${esc(a.id)}">使用</button>`}
        <button class="icon-btn" data-act="del-acc" data-id="${esc(a.id)}"><svg class="ic"><use href="#i-trash"/></svg></button>
      </div>`).join('') : '<div class="empty">还没有账号，请在右侧添加。</div>';
    // 账号列表里的头像优先用皮肤头部
    $('#accCount').textContent = `${state.accounts.length} 个`;
    renderSkin();
  }

  /* ---------------- 设置页 ---------------- */
  const COLORS = ['#2b7bf0', '#4d6bfe', '#7c4dff', '#e2483d', '#2fa84f', '#e0a300', '#00a8a8'];
  const PRESETS = {
    classic: { color: '#4d6bfe', theme: 'classic', label: 'DeepSeek 经典主题' },
    workbuddy: { color: '#00c29a', theme: 'workbuddy', label: 'WorkBuddy 经典主题' },
    default: { color: '#2b7bf0', theme: '', label: '默认主题' }
  };

  function renderSettings() {
    const s = state.settings;
    $('#memRange').value = s.mem;
    $('#memText').textContent = `${s.mem} MB（${(s.mem / 1024).toFixed(1)} GB）`;
    const op = Math.round((s.opacity || 1) * 100);
    $('#opacityRange').value = op;
    $('#opacityText').textContent = op + '%';
    $('#javaPath').value = s.javaPath;
    $('#gameDir').value = gameDir();
    if ($('#appRoot')) $('#appRoot').value = (state.paths && state.paths.root) || '';
    if ($('#bgImage')) $('#bgImage').value = s.bgImage ? String(s.bgImage).split(/[\\/]/).pop() : '';
    $('#winW').value = s.winW; $('#winH').value = s.winH;
    $('#jvmArgs').value = s.jvm;
    $('#clientId').value = s.clientId;
    $('#optFullscreen').checked = s.fullscreen;
    $('#optCloseLauncher').checked = s.closeLauncher;
    $('#optCheckAssets').checked = s.checkAssets;
    $('#optIsolate').checked = s.isolate;
    $('#swatches').innerHTML = COLORS.map((c) =>
      `<button class="swatch ${c === s.color ? 'on' : ''}" style="background:${c}" data-act="set-color" data-id="${c}"></button>`).join('');

    const cur = s.theme || 'default';
    $$('[data-act="preset"]').forEach((b) => b.classList.toggle('active', b.dataset.id === cur));
    $$('[data-act="mode"]').forEach((b) => b.classList.toggle('active', b.dataset.id === (s.mode || 'light')));
    renderJavaState();
  }

  const sysMedia = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const sysDark = () => !!(sysMedia && sysMedia.matches);

  function applyTheme() {
    const s = state.settings;
    // 兼容旧存档：只有 dark 布尔值时迁移为 mode
    if (!s.mode) s.mode = s.dark ? 'dark' : 'light';
    // 没主动选过外观时，默认浅色（老版本存的是「跟随系统」，这里统一拉回浅色一次）
    if (!s.modeTouched && s.mode === 'system') s.mode = 'light';
    const dark = s.mode === 'system' ? sysDark() : s.mode === 'dark';
    s.dark = dark;
    document.documentElement.style.setProperty('--primary', s.color);
    document.body.classList.toggle('dark', dark);
    // 清掉上一个主题的类，避免残留（新增主题无需改这里）
    Array.from(document.body.classList)
      .filter((c) => c.indexOf('theme-') === 0)
      .forEach((c) => document.body.classList.remove(c));
    if (s.theme) document.body.classList.add('theme-' + s.theme);
    // 主题色变了，背景蒙版要跟着换色
    if (typeof applyBackdrop === 'function') applyBackdrop();
  }

  function applyPreset(name) {
    const p = PRESETS[name];
    if (!p) return;
    // 预设只改配色与主题类，不再强制明暗，深浅由用户独立选择
    Object.assign(state.settings, { color: p.color, theme: p.theme });
    save();
    applyTheme();
    renderSettings();
    toast('已应用：' + p.label);
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
        ${t.status === 'queued' ? `<button class="q-x" data-act="queue-drop" data-id="${t.id}" title="移出队列">×</button>` : ''}
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
        fullscreen: state.settings.fullscreen, jvmArgs: state.settings.jvm,
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
  async function addMicrosoft() {
    if (!hasElectron) { toast('演示模式：微软登录需要桌面版'); return; }
    if (!state.settings.clientId) {
      toast('请先在设置中填写微软登录 Client ID');
      switchPage('settings');
      return;
    }
    const box = $('#msCode');
    if (msTimer) { clearInterval(msTimer); msTimer = null; box.classList.add('hidden'); return; }

    try {
      const s = await L.msStart(state.settings.clientId);
      $('#msCodeText').textContent = s.userCode;
      $('#msVerify').textContent = s.verifyUrl;
      box.classList.remove('hidden');
      appendLog('info', `请在浏览器打开 ${s.verifyUrl} 并输入 ${s.userCode}`);
      if (L.open) L.open(s.verifyUrl);

      msTimer = setInterval(async () => {
        try {
          const r = await L.msPoll({ clientId: state.settings.clientId, deviceCode: s.deviceCode, expires: s.expires });
          if (r.pending) return;
          clearInterval(msTimer); msTimer = null;
          box.classList.add('hidden');
          const acc = {
            id: 'a' + Date.now(), name: r.account.name, type: 'microsoft',
            uuid: r.account.uuid, accessToken: r.account.accessToken,
            avatar: r.account.avatar || makeAvatar(r.account.name, 'random', 8)
          };
          state.accounts.push(acc);
          state.currentAccount = acc.id;
          save(); renderAccounts(); renderHero();
          toast('微软账号登录成功：' + acc.name);
          appendLog('info', '微软账号登录成功：' + acc.name);
        } catch (e) {
          clearInterval(msTimer); msTimer = null;
          box.classList.add('hidden');
          appendLog('error', '微软登录失败：' + (e.message || e));
          toast('登录失败：' + (e.message || e));
        }
      }, s.interval);
    } catch (e) {
      toast('登录发起失败：' + (e.message || e));
      appendLog('error', e.message || String(e));
    }
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
          <button class="btn ghost" data-act="modal-close">取消</button>
          <button class="btn danger" data-act="del-version-ok" data-id="${esc(id)}">删除</button>
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
      return `<button class="pick-row ${cur ? 'on' : ''}" data-act="use-version" data-id="${esc(id)}">
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

      case 'set-color':
        state.settings.color = id;
        state.settings.theme = '';
        save(); applyTheme(); renderSettings(); break;
      case 'preset': applyPreset(id); break;
      case 'mode': {
        state.settings.mode = id;
        state.settings.modeTouched = true;
        save(); applyTheme(); renderSettings();
        const label = { light: '浅色', dark: '深色', system: '跟随系统' }[id] || id;
        toast('外观：' + label + (id === 'system' ? `（当前系统为${sysDark() ? '深色' : '浅色'}）` : ''));
        break;
      }
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

  $('#memRange').addEventListener('input', (e) => {
    state.settings.mem = +e.target.value; save(); renderSettings(); renderEnv();
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
  [['optFullscreen', 'fullscreen'], ['optCloseLauncher', 'closeLauncher'], ['optCheckAssets', 'checkAssets'], ['optIsolate', 'isolate']]
    .forEach(([el, key]) => {
      $('#' + el).addEventListener('change', (e) => { state.settings[key] = e.target.checked; save(); });
    });
  $('#resetBtn').addEventListener('click', () => { localStorage.removeItem(KEY); toast('已重置，重启启动器后生效'); });

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
    L.onLog((l) => appendLog(l.lv, l.msg));
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
