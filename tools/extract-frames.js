// 用 Electron 自带 Chromium 解码 mp4 抽帧（无 ffmpeg 时的替代方案）
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const VIDEO = process.argv[2];
const OUT_DIR = process.argv[3] || path.join(__dirname, 'shots');
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 960, height: 760, show: true });
  const url = 'file:///' + VIDEO.replace(/\\/g, '/');
  const html = `<!doctype html><html><body style="margin:0;background:#000">
  <video id="v" src="${url}" preload="auto" muted playsinline style="width:940px"></video>
  <script>
    const v = document.getElementById('v');
    window.__state = { ready: false, err: null, w: 0, h: 0, dur: 0 };
    v.addEventListener('loadedmetadata', () => {
      window.__state.w = v.videoWidth; window.__state.h = v.videoHeight; window.__state.dur = v.duration;
    });
    v.addEventListener('error', () => { window.__state.err = (v.error && (v.error.code + ' ' + v.error.message)) || 'unknown'; });
    v.addEventListener('canplay', () => { window.__state.ready = true; v.play().catch(() => {}); });
    window.__grab = async (t) => {
      v.pause();
      await new Promise((r) => { v.currentTime = t; v.addEventListener('seeked', r, { once: true }); setTimeout(r, 1200); });
      const c = document.createElement('canvas');
      c.width = v.videoWidth || 1; c.height = v.videoHeight || 1;
      c.getContext('2d').drawImage(v, 0, 0);
      return { data: c.toDataURL('image/png'), w: c.width, h: c.height, state: window.__state };
    };
  </script></body></html>`;

  const tmpHtml = path.join(OUT_DIR, '.video.html');
  fs.writeFileSync(tmpHtml, html, 'utf8');
  await win.loadFile(tmpHtml);
  await new Promise((r) => setTimeout(r, 2500));

  const st = await win.webContents.executeJavaScript('window.__state');
  console.log('state:', JSON.stringify(st));
  if (!st.w) {
    console.log('无法解码（可能是 HEVC/H.265 或受保护编码）');
    fs.unlinkSync(tmpHtml);
    app.exit(3);
    return;
  }
  const times = [0.2, 1, 2, 3, 4].filter((t) => t < st.dur);
  for (const t of times) {
    const r = await win.webContents.executeJavaScript(`window.__grab(${t})`);
    const file = path.join(OUT_DIR, `frame-${String(t).replace('.', '_')}.png`);
    fs.writeFileSync(file, Buffer.from(String(r.data).split(',')[1], 'base64'));
    console.log('saved', file, r.w + 'x' + r.h);
  }
  fs.unlinkSync(tmpHtml);
  app.exit(0);
});
