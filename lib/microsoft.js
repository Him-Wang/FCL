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
    device_code: deviceCode
  });
  if (j.error) return { pending: true, detail: j.error_description || j.error };

  const { MicrosoftAuthenticator } = await getUser();
  const auth = new MicrosoftAuthenticator();
  const xbl = await auth.authenticateXboxLive(j.access_token);
  const xsts = await auth.authorizeXboxLive(xbl.Token);
  const uhs = xsts.DisplayClaims.xui[0].uhs;
  const mc = await auth.loginMinecraftWithXBox(uhs, xsts.Token);

  let uuid = '', skins = null;
  try {
    const p = await getJSON('https://api.minecraftservices.com/minecraft/profile', 15000,
      { Authorization: `Bearer ${mc.access_token}` });
    uuid = p.id || '';
    skins = p.skins;
  } catch (e) {}

  return {
    pending: false,
    account: {
      name: mc.username,
      uuid: uuid,
      accessToken: mc.access_token,
      avatar: skins && skins.length ? skins[0].url : null
    }
  };
}

module.exports = { startDeviceLogin, pollLogin };
