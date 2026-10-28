/* 崩溃诊断：退出码非 0 或出现新的 crash-report / hs_err 时，生成结构化诊断 + 可导出 ZIP */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

/* 常见崩溃模式：命中后给一句人话 + 一条建议 */
const RULES = [
  { re: /Mixin apply failed|mixin.*failed|MixinTransformerError/i, tag: '模组兼容', hint: '模组注入失败，通常是模组之间或模组与游戏版本不匹配。先禁用最近装的模组再试。' },
  { re: /NoSuchMethodError|NoClassDefFoundError|ClassNotFoundException/i, tag: '模组/依赖', hint: '缺少类或方法：模组版本和游戏/加载器版本对不上，或缺少前置模组。' },
  { re: /java\.lang\.OutOfMemoryError|GC overhead limit exceeded/i, tag: '内存不足', hint: '在设置里把内存调大（建议 4096 MB 以上），或减少模组数量。' },
  { re: /UnsupportedClassVersionError|Unsupported major\.minor version/i, tag: 'Java 版本', hint: 'Java 版本太低或太高，换用与该 MC 版本匹配的 Java（26.x 用 25，1.20.5+ 用 21，1.17+ 用 17）。' },
  { re: /Pixel format not accelerated|Failed to create window|GLFW error|OpenGL/i, tag: '显卡驱动', hint: 'OpenGL 初始化失败：更新显卡驱动，或在设置里关闭全屏/降低渲染距离。' },
  { re: /Duplicate mods|duplicate (?:mod|entry)/i, tag: '模组重复', hint: 'mods 目录里有重复模组（同一个模组两个版本），删掉旧的。' },
  { re: /java\.io\.IOException:.*(?:access|denied)|AccessDeniedException/i, tag: '文件权限', hint: '文件被占用或无权限：关掉杀毒软件占用、确认游戏目录可写。' },
  { re: /Watchdog|Server thread.*hang|Timed out/i, tag: '卡死超时', hint: '游戏主线程卡住：多为模组死循环或磁盘/网络太慢。' },
  { re: /failed to find.*(?:asset|libraries)|Missing asset/i, tag: '文件缺失', hint: '游戏文件不完整：在版本管理里对当前版本点一次校验/重装。' },
];

function readIfExists(p, maxBytes = 400000) {
  try {
    const st = fs.statSync(p);
    if (!st.isFile()) return '';
    const fd = fs.openSync(p, 'r');
    const len = Math.min(st.size, maxBytes);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, 0);
    fs.closeSync(fd);
    return buf.toString('utf8');
  } catch (e) {
    return '';
  }
}

/** 找出启动之后新生成的崩溃报告 / hs_err 文件 */
function newCrashFiles(gameDir, sinceMs) {
  const out = [];
  const scan = (dir, re) => {
    try {
      for (const f of fs.readdirSync(dir)) {
        if (!re.test(f)) continue;
        const p = path.join(dir, f);
        try {
          const st = fs.statSync(p);
          if (st.isFile() && st.mtimeMs >= sinceMs) out.push(p);
        } catch (e) {}
      }
    } catch (e) {}
  };
  scan(path.join(gameDir, 'crash-reports'), /\.txt$/i);
  scan(gameDir, /^hs_err_pid\d+\.log$/i);
  return out.sort();
}

function diagnose(text) {
  const hits = [];
  for (const r of RULES) {
    if (r.re.test(text)) hits.push({ tag: r.tag, hint: r.hint });
    if (hits.length >= 3) break;
  }
  return hits;
}

function summarizeCrash(gameDir, sinceMs) {
  const files = newCrashFiles(gameDir, sinceMs);
  const report = files.find((f) => /crash-reports/i.test(f)) || '';
  const hsErr = files.find((f) => /hs_err_pid/i.test(f)) || '';
  const reportText = report ? readIfExists(report, 300000) : '';
  const hsText = hsErr ? readIfExists(hsErr, 60000) : '';
  const desc = (reportText.match(/Description:\s*(.+)/) || [])[1] || '';
  const ex = (reportText.match(/(?:Caused by: )?((?:java|net|com|org)\.[\w.$]+(?:Exception|Error))[^\n]*/) || [])[0] || '';
  const stackTop = (reportText.match(/at ([\w.$]+\([^)]*\))/) || [])[1] || '';
  const logPath = path.join(gameDir, 'logs', 'latest.log');
  const logTail = readIfExists(logPath, 200000).split(/\r?\n/).filter(Boolean).slice(-40).join('\n');
  const hits = diagnose([reportText, hsText, logTail].join('\n'));

  return {
    crashed: !!(report || hsErr),
    exitCode: null,
    report,
    hsErr,
    description: desc.trim(),
    exception: ex.trim(),
    stackTop,
    diagnosis: hits,
    logPath,
    logTail,
  };
}

/** 把崩溃相关文件打包成 zip（用 PowerShell 的 Compress-Archive，Windows 自带） */
async function exportZip({ gameDir, outFile, info, launcherLog }) {
  const staging = path.join(path.dirname(outFile), 'fcl-crash-' + Date.now());
  fs.mkdirSync(staging, { recursive: true });
  const copy = (src, name) => {
    try {
      if (src && fs.existsSync(src)) fs.copyFileSync(src, path.join(staging, name));
    } catch (e) {}
  };
  copy(info && info.report, 'crash-report.txt');
  copy(info && info.hsErr, 'hs_err.log');
  copy(info && info.logPath, 'latest.log');
  copy(launcherLog, 'launcher.log');

  const sys = [
    'FCL 崩溃报告',
    '时间: ' + new Date().toISOString(),
    '退出码: ' + ((info && info.exitCode) != null ? info.exitCode : '未知'),
    '描述: ' + ((info && info.description) || '(无)'),
    '异常: ' + ((info && info.exception) || '(无)'),
    '诊断: ' + ((info && info.diagnosis || []).map((d) => d.tag).join(' / ') || '(无)'),
    '',
    '系统: ' + process.platform + ' ' + process.arch,
    '版本: ' + (os.release ? os.release() : ''),
    '内存: ' + Math.round(os.totalmem() / 1024 / 1024) + ' MB',
    'CPU: ' + ((os.cpus()[0] || {}).model || '未知'),
    '游戏目录: ' + gameDir,
    '启动器版本: ' + require('./../package.json').version,
  ].join('\r\n');
  fs.writeFileSync(path.join(staging, 'system.txt'), sys, 'utf8');

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  await new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-Command', `Compress-Archive -Path '${staging}\\*' -DestinationPath '${outFile}' -Force`],
      { windowsHide: true, timeout: 60000 },
      (err) => (err ? reject(err) : resolve()),
    );
  });
  try {
    fs.rmSync(staging, { recursive: true, force: true });
  } catch (e) {}
  return outFile;
}

module.exports = { summarizeCrash, exportZip, diagnose, newCrashFiles };
