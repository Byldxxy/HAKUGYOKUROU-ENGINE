const config = require('../config');
const { readJson, writeJson } = require('../storage/jsonFile');

const readCharacters = () => {
  const data = readJson(config.paths.charactersFile, {});
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
};

const writeCharacters = (data) => {
  writeJson(config.paths.charactersFile, data);
};

const listByUsername = (username) => {
  const db = readCharacters();
  return db[username] || [];
};

const deriveCharacterSummary = (cardData, id) => {
  const stats = cardData.stats || {};
  const basicInfo = cardData.basicInfo || {};
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
