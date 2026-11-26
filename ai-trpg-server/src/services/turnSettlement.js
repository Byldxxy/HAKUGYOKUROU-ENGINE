const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const config = require('../config');
const logs = require('../repositories/roomLogRepository');
const credits = require('./creditService');
const { replaceJson, syncDirectory } = require('../storage/durableFile');
const { isValidRoomId } = require('../domain/validation');

const directory = path.join(config.paths.logsDir, 'settlements');
const journalPath = roomId => path.join(directory, roomId + '.json');

// No awaits between preparing the journal and removing it. The single server
// process makes the two projections visible together to HTTP and socket readers.
function replay(transaction, file) {
  const { roomId, id, offset, entries, payer } = transaction;
  if (!isValidRoomId(roomId) || file !== journalPath(roomId) ||
      !Number.isSafeInteger(offset) || offset < 0 || entries?.length !== 2 ||
      entries[0].settlementId !== id || entries[1].settlementId !== id) throw new Error('无效的回合结算日志。');
  const bytes = Buffer.from((transaction.needsTerminator ? '\n' : '') + entries.map(entry => JSON.stringify(entry) + '\n').join(''));
  const fd = fs.openSync(logs.getRoomLogPath(roomId), 'r+');
  try {
    const present = fs.fstatSync(fd).size - offset;
    if (present < 0 || present > bytes.length) throw new Error('结算偏移与战役日志冲突。');
    if (present) {
      const existing = Buffer.alloc(present);
      const read = fs.readSync(fd, existing, 0, present, offset);
      if (read !== present || !existing.equals(bytes.subarray(0, present))) throw new Error('结算内容与战役日志冲突。');
    }
    let written = present;
    while (written < bytes.length) {
      written += fs.writeSync(fd, bytes, written, bytes.length - written, offset + written);
    }
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  if (payer) credits.applyCharge(payer, roomId, id);
  fs.unlinkSync(file);
  syncDirectory(directory);
}

function recover() {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  syncDirectory(config.paths.logsDir);
  for (const entry of fs.readdirSync(directory)) {
    if (!entry.endsWith('.json')) continue;
    const file = path.join(directory, entry);
    replay(JSON.parse(fs.readFileSync(file, 'utf8')), file);
  }
}

function commit({ roomId, sourceDmIndex, payer, content, rollRules, campaign }) {
  const index = logs.getRoomIndex(roomId);
  if (index.settled.has(sourceDmIndex)) return index.settled.get(sourceDmIndex);
  if (sourceDmIndex !== index.lastDmIndex) throw new Error('主持回复属于已结束的回合。');
  // The source cursor deduplicates a retry in this history. A new decision gets
  // a unique ledger ID even when an older backup is deliberately branched.
  const id = randomUUID();
  const timestamp = new Date().toISOString();
  const entries = [
    { type: 'dm_reply', timestamp, roomId, settlementId: id, sourceDmIndex, ...(payer && { billedAccount: payer }),
      playerName: '系统 DM', content, ...(rollRules?.length && { rollRules }) },
    { type: 'campaign_state', timestamp, roomId, settlementId: id, campaign },
  ];
  const logFile = logs.getRoomLogPath(roomId);
  const fd = fs.openSync(logFile, 'r+');
  let offset;
  try {
    fs.fsyncSync(fd); // the triggering action must precede the durable decision
    offset = fs.fstatSync(fd).size;
  } finally { fs.closeSync(fd); }
  const transaction = { roomId, id, offset, needsTerminator: index.needsTerminator, payer, entries };
  const file = journalPath(roomId);
  // Once this file is visible the outcome is committed. Before accepting another
  // request, either finish projecting it or restart and replay it at startup.
  let decided = false;
  try {
    replaceJson(file, transaction);
    decided = true;
    replay(transaction, file);
  } catch (error) {
    if (!decided && !fs.existsSync(file)) throw error;
    try {
      if (fs.existsSync(file)) replay(transaction, file);
      else syncDirectory(directory);
    } catch (recoveryError) {
      console.error('无法完成持久化回合结算，服务需重启恢复。', recoveryError.message);
      process.exit(1);
    }
  }
  const logIndex = index.nextIndex;
  logs.indexSettlement(roomId, entries);
  return logIndex;
}

module.exports = { recover, commit };
