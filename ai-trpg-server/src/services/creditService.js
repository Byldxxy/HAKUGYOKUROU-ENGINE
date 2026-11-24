// Single PM2 process: synchronous ledger updates and in-flight holds serialize spending.
const crypto = require('node:crypto');
const path = require('node:path');
const config = require('../config');
const { readJson, writeJson } = require('../storage/jsonFile');
const file = path.join(path.dirname(config.paths.roomsFile), 'credits.json');
const read = () => readJson(file, { accounts: {}, redeemed: {} });
const holds = new Map();
const accountKey = username => 'user:' + username;
const balance = username => read().accounts[accountKey(username)] || 0;
const signature = payload => crypto.createHmac('sha256', config.session.secret).update('trpg/cdk/v1/' + payload).digest('base64url');
const issue = amount => {
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1000000) throw new Error('额度必须为 1 至 1000000 的整数。');
  const payload = amount + '.' + crypto.randomBytes(18).toString('base64url');
  return payload + '.' + signature(payload);
};
const redeem = (username, input) => {
  const code = typeof input === 'string' ? input.trim() : '';
  const match = /^(\d{1,7})\.([\w-]{24})\.([\w-]{43})$/.exec(code);
  if (!match || !crypto.timingSafeEqual(Buffer.from(match[3]), Buffer.from(signature(match[1] + '.' + match[2])))) throw new Error('兑换码无效。');
  const ledger = read(), key = accountKey(username);
  if (ledger.redeemed[match[2]]) throw new Error('兑换码已使用。');
  ledger.accounts[key] = (ledger.accounts[key] || 0) + Number(match[1]);
  ledger.redeemed[match[2]] = { username, amount: Number(match[1]), at: new Date().toISOString() };
  writeJson(file, ledger);
  return ledger.accounts[key];
};
const reserve = username => {
  const count = holds.get(username) || 0;
  if (balance(username) <= count) throw new Error('站点额度不足，请房主兑换 CDK 或配置自有 API。');
  holds.set(username, count + 1);
  let settled = false;
  return success => {
    if (settled) return;
    settled = true;
    const remaining = holds.get(username) - 1;
    if (remaining) holds.set(username, remaining); else holds.delete(username);
    if (success) {
      const ledger = read();
      ledger.accounts[accountKey(username)] -= 1;
      writeJson(file, ledger);
    }
  };
};
module.exports = { issue, redeem, balance, reserve };
