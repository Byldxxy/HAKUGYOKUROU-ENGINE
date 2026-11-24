const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const { readJson, writeJson } = require('../storage/jsonFile');

const pageSize = 50;
const directory = roomId => path.join(config.paths.logsDir, 'lobby-chat', roomId);
const pageFile = (roomId, page) => path.join(directory(roomId), page + '.json');
const latestPage = roomId => {
  const dir = directory(roomId);
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).reduce((latest, name) => {
    const match = /^(\d+)\.json$/.exec(name);
    return match ? Math.max(latest, Number(match[1])) : latest;
  }, 0);
};
const history = (roomId, page) => {
  const latest = latestPage(roomId);
  if (page !== undefined && (!Number.isSafeInteger(page) || page < 0 || page > latest)) {
    throw new Error('聊天记录页码无效。');
  }
  const current = page ?? latest;
  const file = pageFile(roomId, current);
  const messages = fs.existsSync(file) ? readJson(file, []) : [];
  // On joining, include the preceding page so a new page does not hide the recent conversation.
  if (page === undefined && current > 0) {
    return { messages: [...readJson(pageFile(roomId, current - 1), []), ...messages], previousPage: current > 1 ? current - 2 : null };
  }
  return { messages, previousPage: current > 0 ? current - 1 : null };
};
const append = (roomId, sender, text) => {
  let page = latestPage(roomId);
  let messages = readJson(pageFile(roomId, page), []);
  if (messages.length >= pageSize) { page++; messages = []; }
  const message = { id: page * pageSize + messages.length + 1, roomId, sender, text, isSystem: false };
  messages.push(message);
  writeJson(pageFile(roomId, page), messages);
  return message;
};
module.exports = { history, append };
