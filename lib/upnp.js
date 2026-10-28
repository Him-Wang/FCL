/* 极简 UPnP IGD 客户端：SSDP 发现 + SOAP AddPortMapping
 * 只做「尽力而为」的端口映射，路由器不支持就返回失败。 */
const dgram = require('dgram');
const http = require('http');
const os = require('os');

const SSDP_ADDR = '239.255.255.250';
const SSDP_PORT = 1900;

function udpProbe(timeout = 2500) {
  return new Promise((resolve) => {
    const found = [];
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const msg = Buffer.from(
      [
        'M-SEARCH * HTTP/1.1',
        `HOST: ${SSDP_ADDR}:${SSDP_PORT}`,
        'MAN: "ssdp:discover"',
        'MX: 2',
        'ST: urn:schemas-upnp-org:device:InternetGatewayDevice:1',
        '',
        '',
      ].join('\r\n'),
    );
    const done = () => {
      try { sock.close(); } catch (e) {}
      resolve(found);
    };
    sock.on('message', (buf, rinfo) => {
      const text = buf.toString('utf8');
      const loc = /LOCATION:\s*(.+)/i.exec(text);
      if (loc) found.push(loc[1].trim());
    });
    sock.on('error', done);
    sock.bind(() => {
      try {
        sock.setBroadcast(true);
        sock.send(msg, 0, msg.length, SSDP_PORT, SSDP_ADDR);
      } catch (e) {
        done();
        return;
      }
      setTimeout(done, timeout);
    });
  });
}

function httpGet(url, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(data));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

function pickControlUrl(xml, baseUrl) {
  // 找 WANIPConnection 或 WANPPPConnection 的 controlURL
  const services = xml.match(/<service>[\s\S]*?<\/service>/gi) || [];
  for (const svc of services) {
    if (/WANIPConnection|WANPPPConnection/i.test(svc)) {
      const m = /<controlURL>([^<]+)<\/controlURL>/i.exec(svc);
      if (m) {
        const u = m[1].trim();
        if (/^http/i.test(u)) return u;
        const base = new URL(baseUrl);
        return new URL(u, base.origin + '/').toString();
      }
    }
  }
  return '';
}

function soap(controlUrl, action, args, timeout = 6000) {
  const body =
    '<?xml version="1.0"?>' +
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
    `<s:Body><u:${action} xmlns:u="urn:schemas-upnp-org:service:WANIPConnection:1">` +
    Object.entries(args)
      .map(([k, v]) => `<${k}>${v}</${k}>`)
      .join('') +
    `</u:${action}></s:Body></s:Envelope>`;

  return new Promise((resolve, reject) => {
    const u = new URL(controlUrl);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port || 80,
        path: u.pathname + u.search,
        method: 'POST',
        timeout,
        headers: {
          'Content-Type': 'text/xml; charset="utf-8"',
          'Content-Length': Buffer.byteLength(body),
          SOAPAction: `"urn:schemas-upnp-org:service:WANIPConnection:1#${action}"`,
        },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(data);
          else reject(new Error('路由器返回 HTTP ' + res.statusCode));
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('路由器响应超时')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function localIp() {
  const ifs = os.networkInterfaces();
  const list = [];
  for (const name of Object.keys(ifs)) {
    for (const a of ifs[name] || []) {
      if (a.family === 'IPv4' && !a.internal) list.push(a.address);
    }
  }
  return list.find((ip) => ip.startsWith('192.168.')) || list.find((ip) => ip.startsWith('10.')) || list[0] || '192.168.1.2';
}

async function mapPort({ port = 25565, description = 'FCL' } = {}) {
  const locations = await udpProbe(2600);
  if (!locations.length) {
    return { ok: false, message: '路由器没有响应 UPnP（可能未开启），需要手动在路由器里做端口转发' };
  }
  let lastErr = '';
  for (const loc of locations.slice(0, 3)) {
    try {
      const xml = await httpGet(loc);
      const control = pickControlUrl(xml, loc);
      if (!control) { lastErr = '路由器不支持 WANIPConnection'; continue; }
      await soap(control, 'AddPortMapping', {
        NewRemoteHost: '',
        NewExternalPort: port,
        NewProtocol: 'TCP',
        NewInternalPort: port,
        NewInternalClient: localIp(),
        NewEnabled: 1,
        NewPortMappingDescription: description,
        NewLeaseDuration: 0,
      });
      return { ok: true, externalPort: port, message: '已通过 UPnP 映射 TCP ' + port + ' → ' + localIp() + ':' + port };
    } catch (e) {
      lastErr = String((e && e.message) || e);
    }
  }
  return { ok: false, message: 'UPnP 映射失败：' + (lastErr || '未知原因') };
}

module.exports = { mapPort, udpProbe };
