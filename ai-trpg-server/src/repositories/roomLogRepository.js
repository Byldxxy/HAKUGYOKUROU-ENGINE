const fs = require('fs');
const path = require('path');
const config = require('../config');
const { appendJsonLine, ensureDir, readJsonLines } = require('../storage/jsonFile');

ensureDir(config.paths.logsDir);

// SECTION: 日志文件定位
// NOTE: 每个房间一个 JSONL 文件，roomId 直接参与文件名，之后上线前应增加白名单校验。
const getRoomLogPath = (roomId) => path.join(config.paths.logsDir, `room_${roomId}.jsonl`);

// SECTION: 玩家行动写入
// NOTE: rollId 只在检定结果上存在，用来防刷新重复投骰和回填结果框。
const appendAction = ({ roomId, playerName, content, rollId }) => {
  const entry = {
    timestamp: new Date().toISOString(),
    type: 'player_action',
    roomId,
    playerName,
    content,
  };
  if (rollId) entry.rollId = rollId;
  appendJsonLine(getRoomLogPath(roomId), entry);
  return entry;
};

// SECTION: DM 回复写入
// NOTE: DM 回复是回合切片的边界，turn_state 会从最后一条 dm_reply 开始计算当前轮。
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

// SECTION: 战役状态快照
// NOTE: 状态与聊天写入同一 JSONL，复制存档时能保持场景、线索、时钟和结局一致。
const appendCampaignState = ({ roomId, campaign }) => {
  const entry = {
    timestamp: new Date().toISOString(),
    type: 'campaign_state',
    roomId,
    campaign,
  };
  appendJsonLine(getRoomLogPath(roomId), entry);
  return entry;
};

const getLatestCampaignState = (roomId) => {
  const lines = readRoomLines(roomId);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].type === 'campaign_state' && lines[index].campaign) {
      return lines[index].campaign;
    }
  }
  return null;
};

// SECTION: 原始日志读取
// NOTE: Socket 层使用原始 lines 推导回合状态，路由层再转换成前端消息结构。
const readRoomLines = (roomId) => readJsonLines(getRoomLogPath(roomId));

// SECTION: 前端消息列表
// NOTE: 这里保留 rollId，刷新页面后前端才能把骰子结果放回对应 ROLL 卡片。
const listRoomMessages = (roomId) => {
  return readRoomLines(roomId)
    .map((line, logIndex) => ({ line, logIndex }))
    .filter(({ line }) => line.type === 'dm_reply' || line.type === 'player_action')
    .map(({ line, logIndex }) => ({
      role: line.type === 'dm_reply' ? 'dm' : ((line.content || '').includes('D100 =') ? 'roll' : 'player'),
      sender: line.playerName,
      content: line.content,
      rollId: line.rollId,
      logIndex,
    }));
};

// SECTION: 新游戏清场
// NOTE: 开全新战役时删除旧 JSONL；存档文件不会被这里影响。
const resetRoomLog = (roomId) => {
  const logPath = getRoomLogPath(roomId);
  if (fs.existsSync(logPath)) {
    fs.unlinkSync(logPath);
  }
};

// SECTION: 存档复制
// NOTE: 存档是房间日志的快照复制，不额外重写日志内容。
const copyLogTo = (roomId, targetPath) => {
  const logPath = getRoomLogPath(roomId);
  if (!fs.existsSync(logPath)) return false;
  ensureDir(path.dirname(targetPath));
  fs.copyFileSync(logPath, targetPath);
  return true;
};

// SECTION: 存档恢复
// NOTE: 加载存档会覆盖当前房间日志，因此调用方必须确认这是房主操作。
const loadLogFrom = (roomId, sourcePath) => {
  if (!fs.existsSync(sourcePath)) return false;
  fs.copyFileSync(sourcePath, getRoomLogPath(roomId));
  return true;
};

module.exports = {
  getRoomLogPath,
  appendAction,
  appendDmReply,
  appendCampaignState,
  getLatestCampaignState,
  readRoomLines,
  listRoomMessages,
  resetRoomLog,
  copyLogTo,
  loadLogFrom,
};
