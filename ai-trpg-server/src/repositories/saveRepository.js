const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const { ensureDir, readJson, writeJson } = require('../storage/jsonFile');
const roomLogRepository = require('./roomLogRepository');

ensureDir(config.paths.savesDir);

// SECTION: 存档元数据读取
// NOTE: saves_meta.json 只记录列表信息，真正日志快照在 savesDir 的 JSONL 文件中。
const readMeta = () => {
  const data = readJson(config.paths.savesMetaFile, {});
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
};

// SECTION: 存档元数据写入
// NOTE: 元数据和日志文件分开，方便未来做分页、重命名或删除。
const writeMeta = (meta) => {
  writeJson(config.paths.savesMetaFile, meta);
};

// SECTION: 存档文件定位
// NOTE: saveId 由后端生成，避免前端直接决定文件名。
const getSavePath = (saveId) => path.join(config.paths.savesDir, `${saveId}.jsonl`);

// SECTION: 账号存档列表
// NOTE: 存档按登录账号归档，不按角色卡姓名归档。
const listByUsername = (username) => {
  const meta = readMeta();
  return meta[username] || [];
};

const findOwnedSave = (username, saveId) => {
  return listByUsername(username).find((save) => save.id === saveId) || null;
};

// SECTION: 创建存档
// NOTE: 先复制房间日志，再写元数据，防止列表里出现不存在的存档文件。
const createSave = ({ username, roomId, saveName }) => {
  const saveId = `save_${crypto.randomUUID()}`;
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
  findOwnedSave,
  createSave,
};
