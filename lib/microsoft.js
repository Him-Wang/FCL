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

const { postForm, getJSON } = require('./net');

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

/** 拿微软 access_token 走完 Xbox Live → XSTS → Minecraft 服务 */
async function finishWithToken(accessToken) {
  const { MicrosoftAuthenticator } = await getUser();
  const auth = new MicrosoftAuthenticator();
  const xbl = await auth.authenticateXboxLive(accessToken);
  const xsts = await auth.authorizeXboxLive(xbl.Token);
  const uhs = xsts.DisplayClaims.xui[0].uhs;
  const mc = await auth.loginMinecraftWithXBox(uhs, xsts.Token);

  let uuid = '';
  let skins = null;
  try {
    const p = await getJSON('https://api.minecraftservices.com/minecraft/profile', 15000, {
      Authorization: `Bearer ${mc.access_token}`,
    });
    uuid = p.id || '';
    skins = p.skins;
  } catch (e) {}

  return {
    name: mc.username,
    uuid,
    accessToken: mc.access_token,
    avatar: skins && skins.length ? skins[0].url : null,
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
  return { pending: false, account };
}

module.exports = {
  startDeviceLogin,
  pollLogin,
  buildAuthUrl,
  exchangeCode,
  finishWithToken,
  LIVE_REDIRECT,
  LIVE_CLIENT_ID,
};
