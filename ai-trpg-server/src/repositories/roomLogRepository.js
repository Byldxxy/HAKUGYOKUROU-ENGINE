const fs = require('fs');
const path = require('path');
const config = require('../config');
const { appendJsonLine, ensureDir, readJsonLines } = require('../storage/jsonFile');

ensureDir(config.paths.logsDir);

const getRoomLogPath = (roomId) => path.join(config.paths.logsDir, `room_${roomId}.jsonl`);

const appendAction = ({ roomId, playerName, content }) => {
  const entry = {
    timestamp: new Date().toISOString(),
    type: 'player_action',
    roomId,
    playerName,
    content,
  };
  appendJsonLine(getRoomLogPath(roomId), entry);
  return entry;
};

const appendDmReply = ({ roomId, content }) => {
  const entry = {
    timestamp: new Date().toISOString(),
    type: 'dm_reply',
    roomId,
    playerName: '系统 DM',
    content,
  };
  appendJsonLine(getRoomLogPath(roomId), entry);
  return entry;
};

const readRoomLines = (roomId) => readJsonLines(getRoomLogPath(roomId));

const listRoomMessages = (roomId) => {
  return readRoomLines(roomId).map((line) => ({
    role: line.type === 'dm_reply' ? 'dm' : ((line.content || '').includes('D100 =') ? 'roll' : 'player'),
    sender: line.playerName,
    content: line.content,
  }));
};

const resetRoomLog = (roomId) => {
  const logPath = getRoomLogPath(roomId);
  if (fs.existsSync(logPath)) {
    fs.unlinkSync(logPath);
  }
};

const copyLogTo = (roomId, targetPath) => {
  const logPath = getRoomLogPath(roomId);
  if (!fs.existsSync(logPath)) return false;
  ensureDir(path.dirname(targetPath));
  fs.copyFileSync(logPath, targetPath);
  return true;
};

const loadLogFrom = (roomId, sourcePath) => {
  if (!fs.existsSync(sourcePath)) return false;
  fs.copyFileSync(sourcePath, getRoomLogPath(roomId));
  return true;
};

module.exports = {
  getRoomLogPath,
  appendAction,
  appendDmReply,
  readRoomLines,
  listRoomMessages,
  resetRoomLog,
  copyLogTo,
  loadLogFrom,
};
