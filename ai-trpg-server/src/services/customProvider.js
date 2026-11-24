const https = require('node:https');
const dns = require('node:dns').promises;
const net = require('node:net');

const blocked = new net.BlockList();
const reservedRanges = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16], ['192.0.0.0', 24],
  ['192.0.2.0', 24], ['192.88.99.0', 24], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 3],
];
for (const [ip, prefix] of reservedRanges) blocked.addSubnet(ip, prefix);

const validate = ({ url, key, model }) => {
  let endpoint;
  try {
    endpoint = new URL(url);
  } catch {
    throw new Error('请输入有效的 HTTPS API URL。');
  }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search ||
      endpoint.hash || endpoint.hostname.includes(':') ||
      (net.isIPv4(endpoint.hostname) && blocked.check(endpoint.hostname))) {
    throw new Error('请使用公网 HTTPS API 地址。');
  }
  if (typeof key !== 'string' || !/^[!-~]{1,2048}$/.test(key) ||
      typeof model !== 'string' || !model.trim() || model.length > 200) {
    throw new Error('请填写有效的 Key 和模型名。');
  }
  const basePath = endpoint.pathname.replace(/\/+$/, '');
  endpoint.pathname = basePath.endsWith('/chat/completions') ? basePath : basePath + '/chat/completions';
  return { endpoint, key, model: model.trim() };
};

const complete = async ({ endpoint, key, model }, messages, timeout) => {
  const addresses = await dns.lookup(endpoint.hostname, { family: 4, all: true });
  if (!addresses.length || addresses.some(({ address }) => blocked.check(address))) {
    throw new Error('API 地址不可用。');
  }
  // Pin the vetted address while preserving the hostname for TLS and HTTP.
  const lookup = (_host, options, callback) => {
    if (options.all) callback(null, [addresses[0]]);
    else callback(null, addresses[0].address, 4);
  };
  return new Promise((resolve, reject) => {
    const request = https.request(endpoint, {
      method: 'POST', family: 4, autoSelectFamily: false, agent: false, lookup,
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    }, response => {
      if (response.statusCode !== 200) {
        response.destroy();
        reject(new Error('自有 API 返回 HTTP ' + response.statusCode));
        return;
      }
      const parts = [];
      let size = 0;
      response.on('data', part => {
        size += part.length;
        if (size > 1024 * 1024) request.destroy(new Error('API 回复过长。'));
        else parts.push(part);
      });
      response.on('error', () => reject(new Error('读取自有 API 回复失败。')));
      response.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(parts).toString());
          const content = data.choices?.[0]?.message?.content;
          if (typeof content !== 'string' || !content.trim()) throw new Error();
          resolve(content);
        } catch {
          reject(new Error('API 未返回有效的聊天回复。'));
        }
      });
    });
    const timer = setTimeout(() => request.destroy(new Error('API 响应超时。')), timeout);
    request.on('close', () => clearTimeout(timer));
    request.on('error', () => reject(new Error('无法连接自有 API，请检查配置。')));
    request.end(JSON.stringify({ model, messages, temperature: 0.5 }));
  });
};
module.exports = { validate, complete };
