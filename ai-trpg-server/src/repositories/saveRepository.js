const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const notebooks = require('./notebookRepository');
const rooms = require('./roomRepository');
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

const getNotebookPath = saveId => path.join(config.paths.savesDir, saveId + '.notebooks.json');

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

  const notePath = getNotebookPath(saveId);
  try {
    const accounts = rooms.get(roomId)?.participants || [];
    writeJson(notePath, { version: 1, accounts: notebooks.snapshotForRoom(roomId, accounts) });
    const meta = readMeta();
    if (!meta[username]) meta[username] = [];
    meta[username].push({
      id: saveId,
      name: saveName || '未命名战役',
      date: new Date().toISOString(),
      notebookVersion: 1,
    });
    writeMeta(meta);
    return saveId;
  } catch (error) {
    fs.rmSync(getSavePath(saveId), { force: true });
    fs.rmSync(notePath, { force: true });
    throw error;
  }
};

// Private documents stay outside the room log, model context and public history.
const restoreIntoRoom = (save, roomId, accounts) => {
  const target = roomLogRepository.getRoomLogPath(roomId);
  const staged = target + '.' + crypto.randomUUID() + '.tmp';
  let snapshot = {};
  if (save.notebookVersion !== undefined) {
    if (save.notebookVersion !== 1) return false;
    let bundle;
    try {
      bundle = JSON.parse(fs.readFileSync(getNotebookPath(save.id), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) return false;
      throw error;
    }
    if (bundle?.version !== 1 || !bundle.accounts || typeof bundle.accounts !== 'object' || Array.isArray(bundle.accounts)) return false;
    snapshot = Object.fromEntries(accounts.filter(account => Object.hasOwn(bundle.accounts, account))
      .map(account => [account, bundle.accounts[account]]));
  }
  let previous;
  try {
    fs.copyFileSync(getSavePath(save.id), staged);
    previous = notebooks.restoreForRoom(roomId, snapshot);
    fs.renameSync(staged, target);
    roomLogRepository.reload(roomId);
    return true;
  } catch (error) {
    if (previous) notebooks.restoreForRoom(roomId, previous);
    throw error;
  } finally {
    fs.rmSync(staged, { force: true });
  }
};

module.exports = {
  getSavePath,
  restoreIntoRoom,
  listByUsername,
  findOwnedSave,
  createSave,
};
