/* 微软账号登录：OAuth2 设备码流 + @xmcl/user（Xbox Live / Minecraft Services） */

/* @xmcl/user 的 CJS 入口依赖纯 ESM 的 uuid，这里改用动态 import 加载其 ESM 构建 */
let userModule = null;
async function getUser() {
  if (!userModule) {
    const abs = require.resolve('@xmcl/user/dist/index.mjs');
    userModule = await import(require('url').pathToFileURL(abs).href);
  }
  return userModule;
}

const https = require('https');
const fs = require('fs');
const path = require('path');
const { postForm, getJSON } = require('./net');

/** 正版皮肤落盘目录，由主进程初始化时指定 */
let skinDir = '';
function setSkinDir(dir) {
  skinDir = dir || '';
}

const OAUTH = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';

/* 内嵌登录窗口用的「公开客户端」参数
 * 这是微软自家 Xbox / Minecraft 启动器的公开客户端 ID，HMCL 等启动器也用同一个，
 * 好处是玩家不需要自己注册 Azure 应用；想换成自己的应用，在设置里填 Client ID 即可。 */
const LIVE_CLIENT_ID = '00000000402b5328';
const LIVE_AUTHORIZE = 'https://login.live.com/oauth20_authorize.srf';
const LIVE_TOKEN = 'https://login.live.com/oauth20_token.srf';
const LIVE_REDIRECT = 'https://login.live.com/oauth20_desktop.srf';

/** 拼出微软登录页地址（在内嵌窗口里打开） */
function buildAuthUrl(clientId) {
  const q = new URLSearchParams({
    client_id: clientId || LIVE_CLIENT_ID,
    response_type: 'code',
    scope: 'XboxLive.signin offline_access',
    redirect_uri: LIVE_REDIRECT,
    prompt: 'select_account',
  });
  return `${LIVE_AUTHORIZE}?${q.toString()}`;
}

/** 用授权码换 access_token */
async function exchangeCode(code, clientId) {
  const j = await postForm(LIVE_TOKEN, {
    grant_type: 'authorization_code',
    client_id: clientId || LIVE_CLIENT_ID,
    code,
    redirect_uri: LIVE_REDIRECT,
    scope: 'XboxLive.signin offline_access',
  });
  if (!j.access_token) throw new Error(j.error_description || j.error || '换取令牌失败');
  return j;
}

/** 统一的 GET：优先用电子的 net（自动走系统代理，Clash 之类开着也能通），
 *  没有 Electron 环境时退回 https.get。返回 Buffer。 */
async function httpGetBuffer(url, headers) {
  let electronNet = null;
  try {
    electronNet = require('electron').net;
  } catch (e) {}
  if (electronNet && typeof electronNet.fetch === 'function') {
    const res = await electronNet.fetch(url, { headers: headers || {} });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  }
  return await new Promise((resolve, reject) => {
    const req = https.get(url, { headers: headers || {}, timeout: 15000 }, (res) => {
      if ((res.statusCode || 0) >= 400) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
  });
}

async function httpGetJSON(url, headers) {
  const buf = await httpGetBuffer(url, headers);
  return JSON.parse(buf.toString('utf8'));
}

/** 拿微软 access_token 走完 Xbox Live → XSTS → Minecraft 服务 */
async function finishWithToken(accessToken) {
  const { MicrosoftAuthenticator } = await getUser();
  const auth = new MicrosoftAuthenticator();
  const xbl = await auth.authenticateXboxLive(accessToken);
  const xsts = await auth.authorizeXboxLive(xbl.Token);
  const claims = (xsts.DisplayClaims && xsts.DisplayClaims.xui && xsts.DisplayClaims.xui[0]) || {};
  const uhs = claims.uhs;
  const gamertag = claims.gtg || '';
  const mc = await auth.loginMinecraftWithXBox(uhs, xsts.Token);

  const diag = { profileOk: false, profileErr: '', skins: 0, nameSource: '' };

  let uuid = '';
  let skins = null;
  let profileName = '';
  try {
    const p = await httpGetJSON('https://api.minecraftservices.com/minecraft/profile', {
      Authorization: 'Bearer ' + mc.access_token,
    });
    uuid = p.id || '';
    skins = p.skins || null;
    profileName = p.name || '';
    diag.profileOk = true;
    diag.skins = Array.isArray(skins) ? skins.length : 0;
  } catch (e) {
    diag.profileErr = e.message || String(e);
  }

  // 账号名：档案名 → xmcl 返回的 username → Xbox gamertag → 兜底
  let name = profileName || mc.username || gamertag || '';
  diag.nameSource = profileName ? 'profile' : mc.username ? 'mc.username' : gamertag ? 'gamertag' : 'none';
  if (!name) name = '微软账号';

  // 皮肤：profile 里的 skins[0].url 就是 64x64 贴图
  let skinDataUrl = '';
  let skinVariant = 'classic';
  let skinFile = '';
  const active = (skins || []).find((s) => s && s.state === 'ACTIVE') || (skins || [])[0];
  if (active && active.url) {
    try {
      skinVariant = String(active.variant || '').toUpperCase() === 'SLIM' ? 'slim' : 'classic';
      const buf = await httpGetBuffer(active.url, {});
      if (buf && buf.length > 64) {
        skinDataUrl = 'data:image/png;base64,' + buf.toString('base64');
        try {
          if (skinDir) {
            fs.mkdirSync(skinDir, { recursive: true });
            skinFile = path.join(skinDir, 'ms-' + (uuid || 'unknown') + '.png');
            fs.writeFileSync(skinFile, buf);
          }
        } catch (e) {}
      }
    } catch (e) {
      diag.skinErr = e.message || String(e);
    }
  }

  return {
    name,
    uuid,
    accessToken: mc.access_token,
    gamertag,
    avatar: active && active.url ? active.url : null,
    skinDataUrl,
    skinVariant,
    skinFile,
    diag,
  };
}

const SCOPE = 'XboxLive.signin offline_access';

/** 第一步：申请设备码，返回给用户在浏览器输入的 user_code */
async function startDeviceLogin(clientId) {
  if (!clientId) throw new Error('未配置微软登录 Client ID');
  const j = await postForm(`${OAUTH}/devicecode`, { client_id: clientId, scope: SCOPE });
  if (!j.device_code) throw new Error(j.error_description || j.error || '设备码申请失败');
  return {
    userCode: j.user_code,
    deviceCode: j.device_code,
    verifyUrl: j.verification_uri || 'https://www.microsoft.com/link',
    interval: (j.interval || 5) * 1000,
    expires: Date.now() + (j.expires_in || 900) * 1000
  };
}

/** 第二步：轮询换取 access token，再经 Xbox Live 获取 Minecraft 账号 */
async function pollLogin(clientId, deviceCode, expires) {
  if (Date.now() > expires) throw new Error('登录已超时，请重新点击登录');
  const j = await postForm(`${OAUTH}/token`, {
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    client_id: clientId,
    device_code: deviceCode,
  });
  if (j.error) return { pending: true, detail: j.error_description || j.error };
  const account = await finishWithToken(j.access_token);
  account.msRefreshToken = j.refresh_token || '';
  account.msClientId = clientId || LIVE_CLIENT_ID;
  return { pending: false, account };
}

/** 用保存下来的微软 refresh_token 静默换新令牌（Minecraft 令牌 24 小时就过期） */
async function refreshToken(refreshToken, clientId) {
  const cid = clientId || LIVE_CLIENT_ID;
  if (!refreshToken) throw new Error('这个账号没有保存 refresh_token，请重新登录一次');
  const j = await postForm(LIVE_TOKEN, {
    grant_type: 'refresh_token',
    client_id: cid,
    refresh_token: refreshToken,
    scope: SCOPE,
  });
  if (!j.access_token) {
    const msg = j.error_description || j.error || '续期失败';
    throw new Error(/invalid_grant|expired|revoked/i.test(String(j.error || '')) ? '微软登录已过期，请重新登录' : msg);
  }
  const account = await finishWithToken(j.access_token);
  account.msRefreshToken = j.refresh_token || refreshToken;
  account.msClientId = cid;
  return account;
}

module.exports = {
  setSkinDir,
  startDeviceLogin,
  pollLogin,
  refreshToken,
  buildAuthUrl,
  exchangeCode,
  finishWithToken,
  LIVE_REDIRECT,
  LIVE_CLIENT_ID,
};
