// Two real KP replies with synthetic campaign data. This never opens a room or writes a player save.
process.env.AI_DEBUG_RAW = 'false';
const assert = require('node:assert/strict');
const engine = require('../src/services/campaignService');
const ai = require('../src/services/aiService');

async function run() {
  const players = [{ name: '林宁', characterId: 'lin', accountName: 'qa', role: '调查员' }];
  let campaign = engine.createCampaign('ontology');
  engine.syncPartyStats(campaign, players);
  const evidence = '林宁手里拿着用蓝绒布包好的怀表镜。';
  campaign = engine.applyDirectorResult({ campaign, directorResult: { narration: evidence, memoryChanges: [{
    kind:'item', id:'pocket-mirror', label:'怀表镜', holder:'pc:lin', condition:'蓝绒布包好',
    witnesses:['pc:lin','npc-kpc'], evidence,
  }] } }).campaign;
  const history = [{ type:'dm_reply', content:'KPC摊开双手，点头答应替你保管。' + evidence }];
  async function play(action) {
    history.push({ type:'player_action', playerName:'林宁', content:action });
    const directorContext = engine.buildDirectorContext({campaign, players, lines:history});
    const reply = await ai.generateDirectorReply({lines:history, directorContext});
    assert.ok(reply.narration);
    console.log('行动：', action, '\nKP：', reply.narration);
    campaign = engine.applyDirectorResult({campaign, directorResult:reply}).campaign;
    history.push({type:'dm_reply',content:reply.narration});
    return reply;
  }
  await play('我暂时不参加仪式。我把包好的怀表镜交到KPC已经摊开的手里，请他照原样收好。');
  const mirror = () => campaign.memory.find(e => e.id === 'pocket-mirror');
  assert.equal(mirror().state.holder, 'npc-kpc', 'KP 应记录已同意的交接');
  assert.match(mirror().state.condition || '', /蓝|绒布/);
  for (let index = 0; index < 20; index++) {
    history.push({type:'player_action',playerName:'林宁',content:'我安静等着。'},
      {type:'dm_reply',content:'厅里只有细微的脚步声。'});
    campaign = engine.applyDirectorResult({campaign,directorResult:{narration:'厅里只有细微的脚步声。'}}).campaign;
  }
  campaign = JSON.parse(JSON.stringify(campaign));
  const reply = await play('我低声问KPC：“之前托你保管的那件东西还在吗？用什么包的？”');
  assert.match(reply.narration, /蓝|绒布/, '应从战役记忆中回忆包装');
  assert.equal(mirror().state.holder, 'npc-kpc');
  console.log('PASS real KP recorded handover and recalled wrapping after 20 simulated rounds.');
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
