const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const { readJson, writeJson } = require('../storage/jsonFile');
const custom = require('./customProvider');

const root = path.join(path.dirname(config.paths.roomsFile), 'provider-profiles');
const profilesFile = path.join(root, 'accounts.json');
const keyFile = path.join(root, 'encryption.key');
const read = () => {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  return readJson(profilesFile, {});
};
const slot = username => 'user:' + username;

const encryptionKey = (create) => {
  if (create && !fs.existsSync(keyFile)) {
    // Never replace a missing key for an existing encrypted database.
    if (Object.keys(read()).length) throw new Error('请联系站方恢复接口配置密钥。');
    fs.writeFileSync(keyFile, crypto.randomBytes(32), { flag: 'wx', mode: 0o600 });
  }
  return fs.readFileSync(keyFile);
};

const summary = username => {
  const record = read()[slot(username)];
  return record ? { url: record.url, model: record.model, preferred: record.preferred } : null;
};

const load = username => {
  const record = read()[slot(username)];
  if (!record) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(false), Buffer.from(record.iv, 'base64'));
    decipher.setAAD(Buffer.from(JSON.stringify([username, record.url])));
    decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
    const key = Buffer.concat([decipher.update(Buffer.from(record.secret, 'base64')), decipher.final()]).toString();
    return custom.validate({ url: record.url, model: record.model, key });
  } catch {
    throw new Error('无法读取已保存的 API Key，请联系站方检查配置。');
  }
};

const save = (username, data) => {
  const records = read();
  const url = typeof data.url === 'string' ? data.url.trim() : '';
  let key = data.key;
  if (key === '' || key === undefined) {
    if (records[slot(username)]?.url !== url) throw new Error('首次保存或更换接口地址时，请填写对应的 API Key。');
    key = load(username).key;
  }
  const validated = custom.validate({ url, key, model: data.model });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(true), iv);
  cipher.setAAD(Buffer.from(JSON.stringify([username, url])));
  const secret = Buffer.concat([cipher.update(validated.key, 'utf8'), cipher.final()]);
  records[slot(username)] = { url, model: validated.model, preferred: true, secret: secret.toString('base64'),
    iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
  writeJson(profilesFile, records);
};

const preferSite = username => {
  const records = read();
  if (records[slot(username)]?.preferred) {
    records[slot(username)].preferred = false;
    writeJson(profilesFile, records);
  }
};
const forget = username => {
  const records = read();
  delete records[slot(username)];
  writeJson(profilesFile, records);
};
module.exports = { summary, load, save, preferSite, forget };
