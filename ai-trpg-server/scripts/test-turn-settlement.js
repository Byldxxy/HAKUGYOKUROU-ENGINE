const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const roomId = '000123';
const username = 'fixture_account';
const request = { roomId, sourceDmIndex: 0, payer: username, content: '检定已结算。',
  campaign: { round: 2, inventory: ['key'] } };

function stores() {
  return { logs: require('../src/repositories/roomLogRepository'), credits: require('../src/services/creditService'),
    settlements: require('../src/services/turnSettlement') };
}

function interruptedCommit(stage) {
  const { logs, credits, settlements } = stores();
  settlements.recover();
  credits.redeem(username, credits.issue(3));
  logs.activate(roomId);
  logs.appendDmReply({ roomId, content: '等待行动。' });
  logs.appendCampaignState({ roomId, campaign: { round: 1, inventory: [] } });
  logs.appendAction({ roomId, accountName: username, playerName: '小林', content: '打开柜子', clientActionId: 'act-1' });

  const rename = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (to.endsWith(roomId + '.json') && stage === 'before-decision') process.exit(47);
    rename(from, to);
    if (to.endsWith(roomId + '.json') && stage === 'after-decision') process.exit(47);
    if (to.endsWith('credits.json') && stage === 'after-charge') process.exit(47);
  };
  const write = fs.writeSync;
  fs.writeSync = (fd, buffer, offset, size, position) => {
    if (stage === 'partial-log' && Buffer.isBuffer(buffer) && position > 0) {
      write(fd, buffer, offset, Math.floor(size / 3), position);
      process.exit(47);
    }
    return write(fd, buffer, offset, size, position);
  };
  if (stage === 'before-charge') credits.applyCharge = () => process.exit(47);
  credits.reserve(username);
  settlements.commit(request);
}

function verify(stage) {
  const { logs, credits, settlements } = stores();
  settlements.recover();
  settlements.recover();
  logs.activate(roomId);
  const index = logs.getRoomIndex(roomId);
  const committed = stage !== 'before-decision';
  assert.equal(index.messages.length, committed ? 3 : 2);
  assert.equal(index.lastDmIndex, committed ? 3 : 0);
  assert.equal(index.actions.get(JSON.stringify([username, 'act-1'])), 2);
  assert.deepEqual(index.latestCampaign.inventory, committed ? ['key'] : []);
  assert.equal(credits.balance(username), committed ? 2 : 3);
  assert.equal(settlements.commit(request), 3);
  assert.equal(settlements.commit(request), 3);
  assert.equal(credits.balance(username), 2);
  // A subsequent reply to a dice check is a distinct settlement even when a
  // scenario keeps the same round number. A custom provider costs no site unit.
  assert.equal(settlements.commit({ ...request, sourceDmIndex: 3, campaign: { round: 2 } }), 5);
  assert.equal(credits.balance(username), 1);
  assert.equal(settlements.commit({ ...request, sourceDmIndex: 5, payer: null }), 7);
  assert.equal(credits.balance(username), 1);
  const release = credits.reserve(username);
  assert.throws(() => credits.reserve(username), /额度不足/);
  release();
  credits.reserve(username)();
  logs.release(roomId);
  assert.equal(logs.getRoomIndex(roomId).lastDmIndex, 7);
}

function checkLongRoom() {
  const { logs } = stores();
  const file = logs.getRoomLogPath(roomId);
  const rows = [];
  for (let i = 0; i < 1000; i++) {
    rows.push({ type: 'player_action', playerName: '玩家', content: '观察' });
    rows.push({ type: 'dm_reply', playerName: '系统 DM', content: '门开了。' });
    rows.push({ type: 'campaign_state', campaign: { round: i + 2, memory: ['一段记忆'.repeat(70)] } });
  }
  fs.writeFileSync(file, rows.map(row => JSON.stringify(row) + '\n').join(''));
  logs.activate(roomId);
  const opened = fs.openSync;
  let historyReads = 0;
  fs.openSync = (target, flags, ...args) => {
    if (target === file && flags === 'r') historyReads++;
    return opened(target, flags, ...args);
  };
  try {
    const index = logs.getRoomIndex(roomId);
    assert.equal(index.messages.length, 2000);
    assert.equal(index.sources.size, 1000);
    assert.equal(index.lastDmIndex, 2998);
    assert.equal(index.recent.length, 15);
    for (let i = 0; i < 8; i++) {
      assert.equal(logs.appendAction({ roomId, playerName: '新玩家', content: '行动' }), 3000 + i);
      assert.equal(logs.getRoomIndex(roomId).round.length, i + 1);
    }
    assert.equal(historyReads, 0);
  } finally { fs.openSync = opened; }
}

function checkRestore() {
  const { logs, credits, settlements } = stores();
  settlements.recover();
  credits.redeem(username, credits.issue(3));
  const file = logs.getRoomLogPath(roomId);
  // A valid old JSONL file can have no terminal newline.
  fs.writeFileSync(file, JSON.stringify({ type: 'dm_reply', roomId, content: '开场。' }));
  logs.activate(roomId);
  const branch = file + '.before';
  fs.copyFileSync(file, branch);
  assert.equal(settlements.commit(request), 1);
  assert.equal(credits.balance(username), 2);
  const secondRoom = '000124';
  fs.copyFileSync(file, logs.getRoomLogPath(secondRoom));
  const restored = logs.getRoomIndex(secondRoom);
  assert.equal(restored.lastDmIndex, 1);
  assert.equal(restored.settled.size, 0); // receipts never migrate with a save
  assert.equal(logs.getRoomIndex(secondRoom), restored); // archived paging reuses its index
  fs.copyFileSync(branch, file);
  logs.reload(roomId);
  assert.equal(settlements.commit(request), 1);
  assert.equal(credits.balance(username), 1); // a new timeline makes its own decision
  assert.equal(settlements.commit(request), 1);
  assert.equal(credits.balance(username), 1);
}

if (process.argv[2] === 'crash') interruptedCommit(process.argv[3]);
else if (process.argv[2] === 'verify') verify(process.argv[3]);
else if (process.argv[2] === 'long') checkLongRoom();
else if (process.argv[2] === 'restore') checkRestore();
else {
  for (const stage of ['before-decision', 'after-decision', 'partial-log', 'before-charge', 'after-charge', 'long', 'restore']) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trpg-settlement-'));
    function run(command, expected) {
      const child = spawnSync(process.execPath, [__filename, command, stage],
        { env: { ...process.env, TRPG_DATA_DIR: dir, NODE_ENV: 'test' }, encoding: 'utf8' });
      assert.equal(child.status, expected, stage + ': ' + child.stderr + child.stdout);
    }
    try {
      if (stage === 'long' || stage === 'restore') run(stage, 0);
      else { run('crash', 47); run('verify', 0); }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  console.log('PASS turn settlement restart recovery at five write boundaries, idempotent charges and indexed long campaigns.');
}
