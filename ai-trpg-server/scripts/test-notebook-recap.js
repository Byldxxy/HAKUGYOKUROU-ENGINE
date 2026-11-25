const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trpg-recap-'));
process.env.TRPG_DATA_DIR = dir;
const { recapSources } = require('../src/repositories/roomLogRepository');
const memory = require('../src/domain/campaignMemory');
try {
  const scenario = { actors:[{ id:'npc-medic', name:'医生' }] };
  const campaign = { round:1, currentSceneId:'hall', inventory:[], memory:[],
    partyStats:{ alice:{characterId:'a',characterName:'甲'}, bob:{characterId:'b',characterName:'乙'} } };
  const lines = [{type:'dm_reply',content:'序章'}, {type:'campaign_state',campaign:{round:1}}];
  function record(text, changes) {
    const consented = changes.map(c => ({...c,evidenceParagraph:1}));
    memory.apply(campaign,scenario,consented,text);
    lines.push({type:'dm_reply',content:text}, {type:'campaign_state',campaign:{round:++campaign.round}});
  }
  record('甲把怀表交给了医生。', [{kind:'item',id:'watch',label:'怀表',holder:'npc-medic',witnesses:['pc:a']}]);
  record('医生把怀表藏进阁楼。', [{kind:'item',id:'watch',label:'怀表',location:'阁楼',witnesses:['npc-medic']}]);
  record('甲听说桥已经封了。', [{kind:'information',id:'bridge',label:'桥',statement:'桥已经封了',source:'传闻',basis:'heard',witnesses:['pc:a']}]);
  record('乙看见桥已经开通。', [{kind:'information',id:'bridge',label:'桥',statement:'桥已经开通',source:'目击',basis:'observed',witnesses:['pc:b']}]);
  record('医生答应明天归还怀表。', [{kind:'promise',id:'keep',label:'归还怀表',from:'npc-medic',to:'pc:a',terms:'明天归还怀表',status:'open',witnesses:['pc:a','npc-medic']}]);
  const view = who => memory.notebookRecap(campaign,scenario,who,recapSources(lines));
  const a = view('a');
  assert.deepEqual(a.map(r=>[r.round,r.kind]),[[5,'promise'],[3,'rumor'],[1,'event']]);
  assert.ok(a.every(row=>lines[row.logIndex].type === 'dm_reply'));
  assert.equal(a[2].text,lines[a[2].logIndex].content);
  assert.ok(!JSON.stringify(a).includes('阁楼') && !JSON.stringify(a).includes('开通'));
  assert.deepEqual(view('b').map(row=>row.text),['乙看见桥已经开通。']);
  assert.deepEqual(view('other'),[]);
  record('甲收回医生归还的怀表。', [{kind:'promise',id:'keep',label:'归还怀表',from:'npc-medic',to:'pc:a',terms:'明天归还怀表',status:'kept',witnesses:['pc:a']}]);
  assert.ok(!view('a').some(row=>row.kind==='promise'));
  console.log('PASS witnessed recap, stale knowledge, hearsay, resolved promises and message anchors');
} finally {
  fs.rmSync(dir,{recursive:true,force:true});
}
