const config = require('../config');
const { readJson, writeJson } = require('../storage/jsonFile');

// SECTION: 笔记默认结构
// NOTE: 新字段都应该在这里补默认值，避免旧存档读取后出现 undefined。
const emptyNotebook = () => ({
  freeNotes: '',
  clues: [],
  graphNodes: [],
  graphEdges: [],
  updatedAt: null,
});

// SECTION: 笔记库读取
// NOTE: notebooks.json 结构为 roomId -> username -> notebook。
const readNotebooks = () => {
  const data = readJson(config.paths.notebooksFile, {});
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
};

// SECTION: 笔记库写入
// NOTE: 通过统一 JSON 写入工具落盘，减少并发写到半截文件的风险。
const writeNotebooks = (data) => {
  writeJson(config.paths.notebooksFile, data);
};

// SECTION: 房间分桶
// NOTE: 读取和保存都通过这个函数创建 roomId 层级，避免路由层关心文件结构。
const getRoomBucket = (db, roomId) => {
  if (!db[roomId]) db[roomId] = {};
  return db[roomId];
};

// SECTION: 获取个人战役笔记
// NOTE: 同一房间不同账号的笔记互不覆盖，便于玩家保留私人线索。
const getNotebook = ({ roomId, username }) => {
  const db = readNotebooks();
  return getRoomBucket(db, roomId)[username] || emptyNotebook();
};

// SECTION: 保存个人战役笔记
// NOTE: 数组字段做类型兜底，避免前端异常 payload 破坏笔记结构。
const saveNotebook = ({ roomId, username, notebook }) => {
  const db = readNotebooks();
  const roomBucket = getRoomBucket(db, roomId);
  const savedNotebook = {
    ...emptyNotebook(),
    ...notebook,
    clues: Array.isArray(notebook.clues) ? notebook.clues : [],
    graphNodes: Array.isArray(notebook.graphNodes) ? notebook.graphNodes : [],
    graphEdges: Array.isArray(notebook.graphEdges) ? notebook.graphEdges : [],
    updatedAt: new Date().toISOString(),
  };

  roomBucket[username] = savedNotebook;
  writeNotebooks(db);
  return savedNotebook;
};

module.exports = {
  getNotebook,
  saveNotebook,
};
