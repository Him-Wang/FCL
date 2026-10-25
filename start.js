/* 启动引导：某些终端会注入 ELECTRON_RUN_AS_NODE=1（例如 IDE 自带终端），
 * 这会让 Electron 以纯 Node 模式运行、拿不到窗口 API。这里自动清理后重新启动。
 */
const e = require('electron');

if (typeof e === 'string') {
  delete process.env.ELECTRON_RUN_AS_NODE;
  const { spawn } = require('child_process');
  const child = spawn(e, [__dirname], {
    stdio: 'inherit',
    env: Object.assign({}, process.env)
  });
  child.on('exit', (code) => process.exit(code === null ? 0 : code));
} else {
  require('./main.js');
}
