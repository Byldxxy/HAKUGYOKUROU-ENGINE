// Explicit, small real-provider smoke check. No writes to account/game files.
process.env.AI_DEBUG_RAW = 'false';
const assert = require('node:assert/strict');
const campaignService = require('../src/services/campaignService');
const ai = require('../src/services/aiService');
(async () => {
  const settings = require('../src/config').openai;
  const custom = process.argv.includes('--custom');
  // Exercise the same configured provider through the room's HTTPS adapter.
  const provider = custom ? require('../src/services/customProvider').validate({
    url: settings.baseURL, key: settings.apiKey, model: settings.model,
  }) : undefined;
  for (const scriptId of ['peach', 'ontology']) {
    const campaign = campaignService.createCampaign(scriptId);
    const directorContext = campaignService.buildDirectorContext({campaign,players:[{name:'测试调查员',role:'记者'}]});
    const result = await ai.generateDirectorReply({provider,directorContext,lines:[{type:'player_action',playerName:'测试调查员',content:'我观察四周，先描述眼前可见的环境，不做任何冒险动作。'}]});
    assert.equal(typeof result.narration, 'string'); assert.ok(result.narration.length);
    assert.ok(Array.isArray(result.requestedRolls)); assert.ok(Array.isArray(result.statChanges));
    const applied = campaignService.applyDirectorResult({campaign,directorResult:result});
    assert.ok(applied.campaign.currentSceneId);
    console.log(`PASS live ${custom ? 'custom' : 'site'} AI: ${scriptId}; narration ${result.narration.length} chars; ${result.requestedRolls.length} rolls.`);
  }
})().catch(error=>{ console.error('Live AI failed:',error.message); process.exitCode=1; });
