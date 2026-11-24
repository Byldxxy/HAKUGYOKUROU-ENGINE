const crypto = require('crypto');
const fs = require('fs');
const config = require('../config');
const { readJson, writeJson } = require('../storage/jsonFile');
const logs = require('./roomLogRepository');
const { DEFAULT_ROOM_RULES } = require('../domain/roomRules');

const read = () => readJson(config.paths.roomsFile, {});
const get = (id) => {
  const db = read();
  if (Object.hasOwn(db, id)) return db[id];
  // Upgrade old campaigns only from server-persisted account identities.
  const campaign = logs.getLatestCampaignState(id);
  const members = Object.entries(campaign?.partyStats || {}).map(([accountName, value]) => ({
    accountName, characterId: value.characterId,
  }));
  if (!members.length) return null;
  const room = { id, ownerAccount: members[0].accountName, members,
    participants: members.map((member) => member.accountName), started: true,
    config: { scriptId: campaign.scriptId, rules: { ...DEFAULT_ROOM_RULES } } };
  db[id] = room;
  writeJson(config.paths.roomsFile, db);
  return room;
};
const save = (room) => {
  const db = read();
  db[room.id] = room;
  writeJson(config.paths.roomsFile, db);
};
const create = (username) => {
  const db = read();
  let id;
  do { id = String(crypto.randomInt(100000, 1000000)); }
  while (Object.hasOwn(db, id) || fs.existsSync(logs.getRoomLogPath(id)));
  const room = { id, ownerAccount: username, members: [], participants: [username], started: false,
    config: { scriptId: 'peach', rules: { ...DEFAULT_ROOM_RULES } } };
  db[id] = room;
  writeJson(config.paths.roomsFile, db);
  return room;
};
const canRead = (id, username) => get(id)?.participants.includes(username) === true;
const isMember = (id, username) => get(id)?.members.some((member) => member.accountName === username) === true;
const characterInUse = (username, id) => Object.values(read()).some(room => room.started && room.members.some(member => member.accountName === username && member.characterId === id));
module.exports = { characterInUse, get, save, create, canRead, isMember };
