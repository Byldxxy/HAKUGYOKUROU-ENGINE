const fs = require('node:fs');
const path = require('node:path');
const { StringDecoder } = require('node:string_decoder');
const { cleanKpNarration } = require('../domain/narration');
const config = require('../config');
const { appendJsonLine, ensureDir } = require('../storage/jsonFile');

ensureDir(config.paths.logsDir);
const getRoomLogPath = roomId => path.join(config.paths.logsDir, `room_${roomId}.jsonl`);
const active = new Map();
const recentRooms = new Map();

function indexEntry(index, entry) {
  const logIndex = index.nextIndex++;
  if (entry.type === 'campaign_state') {
    index.latestCampaignSeq = logIndex;
    index.latestCampaign = entry.campaign;
    const round = entry.campaign?.round - 1;
    if (index.pendingSource && round > 0) index.sources.set(round, index.pendingSource);
    index.pendingSource = null;
    return;
  }
  if (!['dm_reply', 'player_action'].includes(entry.type)) return;
  if (entry.type === 'dm_reply') {
    if (entry.roomId === index.roomId && Number.isSafeInteger(entry.sourceDmIndex)) {
      index.settled.set(entry.sourceDmIndex, logIndex);
    }
    index.lastDmIndex = logIndex;
    index.lastDm = entry;
    index.round = [];
    index.pendingSource = { logIndex, content: entry.content };
  } else {
    index.round.push(entry);
    if (entry.roomId === index.roomId && entry.clientActionId) {
      index.actions.set(JSON.stringify([entry.accountName, entry.clientActionId]), logIndex);
    }
  }
  index.recent.push(entry);
  if (index.recent.length > 15) index.recent.shift();
  index.messages.push({
    role: entry.type === 'dm_reply' ? 'dm' : entry.rollId || entry.content?.includes('D100 =') ? 'roll' : 'player',
    sender: entry.playerName,
    content: entry.type === 'dm_reply' ? cleanKpNarration(entry.content) : entry.content,
    ...(entry.rollId && { rollId: entry.rollId }),
    ...(entry.rollRules?.length && { rollRules: entry.rollRules }),
    logIndex,
  });
}

function buildIndex(roomId) {
  const index = { roomId, needsTerminator: false, nextIndex: 0, lastDmIndex: -1, lastDm: null, round: [], recent: [], messages: [],
    sources: new Map(), settled: new Map(), actions: new Map(), latestCampaign: null, pendingSource: null };
  const file = getRoomLogPath(roomId);
  if (!fs.existsSync(file)) return index;
  // Old snapshots may be large. Release each snapshot as soon as the next arrives.
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.alloc(64 * 1024);
  const decoder = new StringDecoder('utf8');
  let tail = '';
  try {
    let count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length)) > 0) {
      const lines = (tail + decoder.write(buffer.subarray(0, count))).split('\n');
      tail = lines.pop();
      for (const line of lines) if (line.trim()) indexEntry(index, JSON.parse(line));
    }
    tail += decoder.end();
    if (tail.trim()) indexEntry(index, JSON.parse(tail));
    index.needsTerminator = Boolean(tail);
  } finally {
    fs.closeSync(fd);
  }
  return index;
}

// Keep active rooms hot. A small LRU also allows paging through archived history
// without re-reading a long journal for every page. No empty lookup is cached.
function getRoomIndex(roomId) {
  if (active.has(roomId)) return active.get(roomId);
  const index = recentRooms.get(roomId) || buildIndex(roomId);
  if (index.nextIndex) {
    recentRooms.delete(roomId);
    recentRooms.set(roomId, index);
    if (recentRooms.size > 4) recentRooms.delete(recentRooms.keys().next().value);
  }
  return index;
}
function activate(roomId) {
  if (!active.has(roomId)) active.set(roomId, getRoomIndex(roomId));
  recentRooms.delete(roomId);
}
const release = roomId => active.delete(roomId);
function reload(roomId) {
  recentRooms.delete(roomId);
  if (active.has(roomId)) active.set(roomId, buildIndex(roomId));
}
const getLatestCampaignState = roomId => structuredClone(getRoomIndex(roomId).latestCampaign);

function appendEntry(entry) {
  const index = getRoomIndex(entry.roomId);
  const file = getRoomLogPath(entry.roomId);
  if (index.needsTerminator) {
    fs.appendFileSync(file, '\n');
    index.needsTerminator = false;
  }
  appendJsonLine(file, entry);
  const logIndex = index.nextIndex;
  indexEntry(index, entry);
  return logIndex;
}
const appendAction = ({ roomId, playerName, content, rollId, accountName, clientActionId }) =>
  appendEntry({ timestamp: new Date().toISOString(), type: 'player_action', roomId, playerName, accountName,
    ...(clientActionId && { clientActionId }), ...(rollId && { rollId }), content });
const appendDmReply = ({ roomId, content, rollRules }) =>
  appendEntry({ timestamp: new Date().toISOString(), type: 'dm_reply', roomId, playerName: '系统 DM', content,
    ...(rollRules?.length && { rollRules }) });
const appendCampaignState = ({ roomId, campaign }) =>
  appendEntry({ timestamp: new Date().toISOString(), type: 'campaign_state', roomId, campaign });
function indexSettlement(roomId, entries) {
  const index = active.get(roomId) || recentRooms.get(roomId);
  if (!index) return;
  index.needsTerminator = false;
  for (const entry of entries) indexEntry(index, entry);
}

function recapSources(lines) {
  const sources = new Map();
  let reply = null;
  for (const [logIndex, line] of lines.entries()) {
    if (line.type === 'dm_reply') reply = { logIndex, content: line.content };
    if (line.type !== 'campaign_state' || !reply) continue;
    const round = line.campaign?.round - 1;
    if (round > 0) sources.set(round, reply);
    reply = null;
  }
  return sources;
}

function resetRoomLog(roomId) {
  fs.rmSync(getRoomLogPath(roomId), { force: true });
  reload(roomId);
}
function copyLogTo(roomId, targetPath) {
  const source = getRoomLogPath(roomId);
  if (!fs.existsSync(source)) return false;
  ensureDir(path.dirname(targetPath));
  fs.copyFileSync(source, targetPath);
  return true;
}

module.exports = { getRoomLogPath, getRoomIndex, activate, release, reload, indexSettlement, getLatestCampaignState,
  appendAction, appendDmReply, appendCampaignState, recapSources, resetRoomLog, copyLogTo };
