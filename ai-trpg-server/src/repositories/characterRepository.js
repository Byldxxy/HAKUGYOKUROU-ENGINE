const config = require('../config');
const { readJson, writeJson } = require('../storage/jsonFile');

// SECTION: 角色库读取
// NOTE: characters.json 以 username 分桶；异常结构直接按空库处理，避免页面崩溃。
const readCharacters = () => {
  const data = readJson(config.paths.charactersFile, {});
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
};

// SECTION: 角色库写入
// NOTE: 统一经过 storage/jsonFile，保持所有 JSON 写入都是临时文件替换。
const writeCharacters = (data) => {
  writeJson(config.paths.charactersFile, data);
};

// SECTION: 账号角色列表
// NOTE: 登录账号只负责归档角色卡；游戏内展示名以后统一来自角色卡姓名。
const listByUsername = (username) => {
  const db = readCharacters();
  return db[username] || [];
};

// SECTION: 角色摘要生成
// NOTE: 大厅只需要姓名、职业和三项资源；完整角色卡放在 fullData 中供游戏页使用。
const deriveCharacterSummary = (cardData, id) => {
  const stats = cardData.stats || {};
  const basicInfo = cardData.basicInfo || {};
  // NOTE: HP/MP 采用当前表单里的 COC 派生规则，后续若改规则只改这一处。
  const hp = Math.floor(((stats.con || 0) + (stats.siz || 0)) / 10);
  const mp = Math.floor((stats.pow || 0) / 5);

  return {
    id,
    name: basicInfo.name,
    role: basicInfo.occupation || '未知职业',
    hp,
    san: stats.pow || 0,
    mp,
    fullData: { ...cardData, id },
  };
};

// SECTION: 新建或更新角色
// NOTE: 前端编辑旧角色时会带 id；没有 id 时才生成新角色。
const saveForUsername = (username, cardData) => {
  const db = readCharacters();
  if (!db[username]) db[username] = [];

  const existingIndex = db[username].findIndex((card) => card.id === cardData.id);

  if (existingIndex !== -1) {
    const id = db[username][existingIndex].id;
    db[username][existingIndex] = {
      ...db[username][existingIndex],
      ...deriveCharacterSummary(cardData, id),
    };
    writeCharacters(db);
    return { card: db[username][existingIndex], created: false };
  }

  const id = `char_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const newCard = deriveCharacterSummary(cardData, id);
  db[username].push(newCard);
  writeCharacters(db);
  return { card: newCard, created: true };
};

// SECTION: 删除角色
// NOTE: 返回布尔值给路由层决定 404 或成功响应。
const deleteForUsername = (username, id) => {
  const db = readCharacters();
  if (!db[username]) return false;

  const beforeCount = db[username].length;
  db[username] = db[username].filter((card) => card.id !== id);
  writeCharacters(db);
  return db[username].length !== beforeCount;
};

module.exports = {
  listByUsername,
  saveForUsername,
  deleteForUsername,
};
