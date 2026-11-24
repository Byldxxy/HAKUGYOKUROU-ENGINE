const assert = require('node:assert/strict');
const engine = require('../src/services/campaignService');

let state = engine.createCampaign('ontology');
const players = [{ name: '林宁', characterId: 'lin', accountName: 'tester' }];
engine.syncPartyStats(state, players);
function turn(narration, changes = [], extra = {}) {
  state = engine.applyDirectorResult({ campaign: state,
    directorResult: { narration, memoryChanges: changes, ...extra } }).campaign;
}
const mirror = { kind: 'item', id: 'pocket-mirror', label: '怀表镜', holder: 'pc:lin',
  condition: '绒布包裹', witnesses: ['林宁', 'npc-kpc'], evidence: '林宁用绒布裹好怀表镜。' };
turn(mirror.evidence, [mirror]);
const handover = { ...mirror, holder: 'npc-kpc', evidence: 'KPC收下包好的怀表镜。' };
const before = JSON.stringify(state.memory);
turn(handover.evidence, [handover], { requestedRolls: [{ player: '林宁', skill: '潜行' }] });
assert.equal(JSON.stringify(state.memory), before);
turn('绒布打了个滑，怀表镜仍在原处。', [handover]);
assert.equal(JSON.stringify(state.memory), before);
const pledge = { kind: 'promise', id: 'mirror-secret', label: '保密约定', from: 'npc-kpc', to: 'pc:lin',
  terms: '保密怀表镜的下落', status: 'open', witnesses: ['KPC','林宁'], evidence: '他轻声答应保密。' };
turn(handover.evidence + pledge.evidence, [handover, pledge]);
assert.ok(!state.inventory.includes(mirror.id));
const hide = { ...mirror, id: 'a-new-model-id', holder: undefined, location: '旧柜夹层',
  witnesses: ['npc-kpc'], evidence: 'KPC独自将怀表镜放入旧柜夹层。' };
turn('柜门被轻轻拉开。\n\n' + hide.evidence, [{ ...hide, evidence: undefined, evidenceParagraph: 2 }]);
let entry = state.memory.find(e => e.id === mirror.id);
assert.equal(state.memory.filter(e => e.kind === 'item').length, 1);
assert.equal(entry.state.location, '旧柜夹层');
assert.equal(entry.observers.find(o => o.who === 'pc:lin').state.holder, 'npc-kpc');
assert.ok(!entry.observers.some(o => o.who === 'npc-cain'));
const rumor = { kind: 'information', id: 'mirror-rumor', label: '失物传言', statement: '镜子已运走',
  source: '走廊传言', basis: 'heard', witnesses: ['npc-cain'], evidence: '凯恩听说镜子已运走。' };
turn(rumor.evidence, [rumor]);
const verify = { ...rumor, statement: '镜子在旧柜里', source: '柜中实物', basis: 'observed',
  witnesses: ['npc-kpc'], evidence: 'KPC看见柜中的怀表镜。' };
turn(verify.evidence, [verify]);
assert.equal(state.memory.find(e => e.id === rumor.id).observers.find(o => o.who === 'npc-cain').state.basis, 'heard');
for (let i = 0; i < 22; i++) {
  const evidence = '桌上放着编号为' + i + '的卡片。';
  turn(evidence, [{ kind:'item', id:'card-' + i, label:'编号' + i + '卡片', location:'桌面', witnesses:[], evidence }]);
}
state = JSON.parse(JSON.stringify(state));
const ctx = engine.buildDirectorContext({ campaign: state, players,
  lines: [{type:'player_action', content:'那份保密约定和怀表镜后来怎么样了？'}] });
assert.equal(ctx.recalledMemory.length, 12);
assert.ok(!Object.hasOwn(ctx.campaignState, 'memory'));
entry = ctx.recalledMemory.find(e => e.id === mirror.id);
assert.equal(entry.state.location, '旧柜夹层');
assert.equal(entry.round, 5);
assert.equal(ctx.recalledMemory.find(e => e.id === pledge.id).state.status, 'open');
assert.ok(!JSON.stringify(engine.getPublicCampaign(state)).includes('旧柜夹层'));
const old = engine.createCampaign('peach');
delete old.memory;
assert.equal(engine.migrateCampaign(old).memory[0].state.holder, 'party');
console.log('PASS memory: custody, secret transfer, promise, hearsay, failed and pending rolls, legacy inventory, recall after 22 turns.');
