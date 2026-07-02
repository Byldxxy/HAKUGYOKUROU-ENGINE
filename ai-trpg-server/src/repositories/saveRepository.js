const path = require('path');
const config = require('../config');
const { ensureDir, readJson, writeJson } = require('../storage/jsonFile');
const roomLogRepository = require('./roomLogRepository');

ensureDir(config.paths.savesDir);

const readMeta = () => {
  const data = readJson(config.paths.savesMetaFile, {});
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
};

const writeMeta = (meta) => {
  writeJson(config.paths.savesMetaFile, meta);
};

const getSavePath = (saveId) => path.join(config.paths.savesDir, `${saveId}.jsonl`);

const listByUsername = (username) => {
  const meta = readMeta();
  return meta[username] || [];
};

const createSave = ({ username, roomId, saveName }) => {
  const saveId = `save_${Date.now()}`;
  const copied = roomLogRepository.copyLogTo(roomId, getSavePath(saveId));
  if (!copied) {
    const error = new Error('房间尚无行动记录，无法存档。');
    error.statusCode = 400;
    throw error;
  }

  const meta = readMeta();
  if (!meta[username]) meta[username] = [];
  meta[username].push({
    id: saveId,
    name: saveName || '未命名战役',
    date: new Date().toISOString(),
  });
  writeMeta(meta);
  return saveId;
};

module.exports = {
  getSavePath,
  listByUsername,
  createSave,
};
