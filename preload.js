const { contextBridge, ipcRenderer } = require('electron');

/** 注册监听并返回取消函数（直接返回 ipcRenderer 会导致调用方 off() 报错） */
function sub(channel, cb) {
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('launcher', {
  minimize: () => ipcRenderer.send('win:minimize'),
  setOpacity: (v) => ipcRenderer.send('win:setOpacity', v),
  maximize: () => ipcRenderer.send('win:maximize'),
  close: () => ipcRenderer.send('win:close'),
  onWinState: (cb) => sub('win:state', cb),

  env: (opt) => ipcRenderer.invoke('sys:env', opt),
  appRoot: () => ipcRenderer.invoke('app:root'),
  setAppRoot: (req) => ipcRenderer.invoke('app:set-root', req),
  restart: () => ipcRenderer.invoke('app:restart'),
  setTransparent: (v) => ipcRenderer.invoke('app:set-transparent', v),
  setTray: (v) => ipcRenderer.invoke('app:set-tray', v),
  onTrayHint: (cb) => sub('tray:hint', cb),
  migrateMinecraft: () => ipcRenderer.invoke('game:migrate'),
  legacyMinecraft: () => ipcRenderer.invoke('game:legacy'),
  pickBackground: () => ipcRenderer.invoke('bg:pick'),
  saveBackground: (req) => ipcRenderer.invoke('bg:save', req),
  manifest: () => ipcRenderer.invoke('mc:manifest'),
  install: (req) => ipcRenderer.invoke('mc:install', req),
  loaders: (req) => ipcRenderer.invoke('mc:loaders', req),
  verify: (req) => ipcRenderer.invoke('mc:verify', req),
  lastCrash: (req) => ipcRenderer.invoke('log:last-crash', req),
  launch: (req) => ipcRenderer.invoke('mc:launch', req),
  kill: () => ipcRenderer.invoke('mc:kill'),

  // 下载队列（最多同时 3 个）
  queueAdd: (req) => ipcRenderer.invoke('queue:add', req),
  queueList: () => ipcRenderer.invoke('queue:list'),
  queueRemove: (id) => ipcRenderer.invoke('queue:remove', id),
  queueClear: () => ipcRenderer.invoke('queue:clear'),
  onQueue: (cb) => sub('queue:update', cb),

  // Java 一键部署
  javaDetect: (opt) => ipcRenderer.invoke('java:detect', opt),
  javaRequire: (req) => ipcRenderer.invoke('java:require', req),
  javaInstall: (req) => ipcRenderer.invoke('java:install', req),
  onJavaProgress: (cb) => sub('java:progress', cb),
  offJavaProgress: () => ipcRenderer.removeAllListeners('java:progress'),

  // 启动前文件校验
  onVerifyProgress: (cb) => sub('mc:verify-progress', cb),
  offVerifyProgress: () => ipcRenderer.removeAllListeners('mc:verify-progress'),

  storeSearch: (req) => ipcRenderer.invoke('store:search', req),
  storeInstall: (req) => ipcRenderer.invoke('store:install', req),
  cnmodSearch: (req) => ipcRenderer.invoke('cnmod:search', req),

  deleteVersion: (req) => ipcRenderer.invoke('mc:delete-version', req),

  packToggle: (req) => ipcRenderer.invoke('pack:toggle', req),
  packDelete: (req) => ipcRenderer.invoke('pack:delete', req),

  msStart: (clientId) => ipcRenderer.invoke('ms:start', clientId),
  msPoll: (req) => ipcRenderer.invoke('ms:poll', req),
  msLogin: () => ipcRenderer.invoke('ms:login'),

  modToggle: (req) => ipcRenderer.invoke('mc:mod-toggle', req),
  modDelete: (req) => ipcRenderer.invoke('mc:mod-delete', req),

  pickFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  pickContent: (req) => ipcRenderer.invoke('dialog:pickContent', req),
  importContent: (req) => ipcRenderer.invoke('content:import', req),

  pickSkin: () => ipcRenderer.invoke('skin:pick'),
  uploadSkin: (req) => ipcRenderer.invoke('skin:upload', req),
  localSkinStatus: (req) => ipcRenderer.invoke('localskin:status', req),
  enableLocalSkin: (req) => ipcRenderer.invoke('localskin:enable', req),

  skinsList: () => ipcRenderer.invoke('skins:list'),
  skinsAdd: (req) => ipcRenderer.invoke('skins:add', req),
  skinsDelete: (req) => ipcRenderer.invoke('skins:delete', req),
  skinsApply: (req) => ipcRenderer.invoke('skins:apply', req),
  open: (p) => ipcRenderer.invoke('shell:open', p),

  offProgress: () => ipcRenderer.removeAllListeners('mc:install-progress'),
  onInstallProgress: (cb) => sub('mc:install-progress', cb),
  onLog: (cb) => sub('mc:log', cb),
  onGameExit: (cb) => sub('mc:game-exit', cb),
  onGameReady: (cb) => sub('mc:game-ready', cb)
});
