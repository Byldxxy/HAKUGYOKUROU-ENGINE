// Two real site-model replies. All players, actions and campaign state are in memory.
process.env.AI_DEBUG_RAW = 'false';
process.env.DOTENV_CONFIG_QUIET = 'true';

const { performance } = require('node:perf_hooks');
const campaignService = require('../src/services/campaignService');
const { generateDirectorReply } = require('../src/services/aiService');

async function run() {
  const player = { name: '林宁', role: '编目志愿者', characterId: 'harbour-qa', accountName: 'qa' };
  const players = [player];
  let campaign = campaignService.createCampaign('harbour');
  campaignService.syncPartyStats(campaign, players);
  const scenario = campaignService.getScenario(campaign);
  const counter = campaignService.getCurrentScene(scenario, campaign);
  if (counter.id !== 'counter') throw new Error('unexpected_fixture');
  const history = [{ type: 'dm_reply', content: counter.entryNarration }];
  const moves = [
    { to: 'archive', action: '我推开档案室虚掩的门，走进档案室。' },
    { to: 'counter', action: '我放下手头的事，沿走廊原路返回门厅的编目台。' },
  ];
  for (const { to, action } of moves) {
    const from = campaign.currentSceneId;
    const start = performance.now();
    console.log('REQUEST', from, '->', to);
    history.push({ type: 'player_action', playerName: player.name, content: action });
    const directorContext = campaignService.buildDirectorContext({ campaign, players, lines: history });
    const reply = await generateDirectorReply({ lines: history, directorContext });
    const applied = campaignService.applyDirectorResult({ campaign, directorResult: reply });
    // Only print registered IDs. Never log provider text, error bodies, URLs, headers or credentials.
    const proposed = scenario.scenes.find(scene => scene.id === reply.proposedTransition)?.id || 'none/unknown';
    console.log('RESULT', { from, expected: to, proposed, actual: applied.campaign.currentSceneId,
      rolls: applied.result.requestedRolls.length, elapsedMs: Math.round(performance.now() - start) });
    if (applied.transition?.id !== to || applied.campaign.currentSceneId !== to || applied.result.requestedRolls.length) {
      process.exitCode = 1;
      return;
    }

    history.push({ type: 'dm_reply', content: [applied.result.narration, applied.transition.entryNarration].filter(Boolean).join('\n\n') });
    campaign = applied.campaign;
    if (to === 'counter' && (!counter.revisitNarration || applied.transition.entryNarration !== counter.revisitNarration)) {
      console.error('FAIL counter revisit narration');
      process.exitCode = 1;
      return;
    }
  }
  console.log('PASS harbour round trip with the return entry.');
}

run().catch(error => {
  const status = Number.isInteger(error.status) ? error.status : 'unavailable';
  console.error('FAIL harbour smoke', { status, timeout: error.name === 'APIConnectionTimeoutError' });
  process.exitCode = 1;
});
