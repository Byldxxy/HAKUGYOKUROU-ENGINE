const assert = require('assert');
const campaignService = require('../src/services/campaignService');

const apply = (campaign, { facts = {}, clues = [], transition = null, rolls = [], clockDeltas = {} }) => {
  return campaignService.applyDirectorResult({
    campaign,
    directorResult: {
      narration: '测试叙述',
      requestedRolls: rolls,
      statChanges: [],
      revealedClueIds: clues,
      proposedStateChanges: { facts, clockDeltas },
      proposedTransition: transition,
      pacing: transition ? 'advance' : 'hold',
    },
  }).campaign;
};

let campaign = campaignService.createCampaign('peach');
assert.equal(campaign.currentSceneId, 'forest-awakening');
assert.equal(Object.hasOwn(campaign.clocks, 'injury'), false, '战役不得使用与角色 HP 重复的伤势时钟');

campaign = apply(campaign, {
  facts: { rootIdentified: true, yuwenTimeGapKnown: true },
  clockDeltas: { healerSuspicion: 2 },
  transition: 'dry-river-patrol',
});
assert.equal(campaign.facts.rootIdentified, false, '当前场景不得修改未授权事实');
assert.equal(campaign.clocks.healerSuspicion.value, 0, '当前场景不得修改未授权时钟');
assert.equal(campaign.currentSceneId, 'forest-awakening', '前置事实不完整时不得转场');
assert.equal(Object.hasOwn(campaignService.getPublicCampaign(campaign), 'clocks'), false, '导演时钟不得广播给玩家');

campaign = apply(campaign, {
  facts: { yuwenTimeGapKnown: true, greylineChosen: true },
  clues: ['clue-yuwen-time-gap'],
  transition: 'dry-river-patrol',
  rolls: [{ player: '测试角色', skill: '心理学' }],
});
assert.equal(campaign.currentSceneId, 'forest-awakening', '等待检定时不得提前转场');
assert.equal(campaign.revealedClueIds.length, 0, '等待检定时不得提前公开线索');

const steps = [
  {
    facts: { yuwenTimeGapKnown: true, greylineChosen: true },
    clues: ['clue-yuwen-time-gap'],
    transition: 'dry-river-patrol',
  },
  {
    facts: { patrolPassed: true },
    clues: ['clue-root-disrupts-scan'],
    transition: 'greyline-arrival',
  },
  {
    facts: { healerFound: true },
    transition: 'healer-negotiation',
  },
  {
    facts: { rootIdentified: true, treatmentCompleted: true },
    clues: ['clue-root-identity'],
    transition: 'cai-boshi-bargain',
  },
  {
    facts: { deliveryAccepted: true, eastRouteSecured: true },
    clues: ['clue-mask-material'],
    transition: 'eastward-departure',
  },
];

for (const step of steps) campaign = apply(campaign, step);

assert.equal(campaign.currentSceneId, 'eastward-departure');
assert.equal(campaign.phase, 'completed');
assert.equal(campaign.endingId, 'chapter-success-delivery');
assert.equal(campaign.revealedClueIds.length, 4);

const publicState = campaignService.getPublicCampaign(campaign);
assert.equal(publicState.ending.label, '带着交易前往东海岸');
assert.equal(Object.hasOwn(publicState, 'facts'), false, '内部事实不得广播给玩家');
assert.equal(Object.hasOwn(publicState, 'protectedSecrets'), false, '导演秘密不得广播给玩家');
assert.equal(Object.hasOwn(publicState, 'scene'), false, '当前场景不得作为玩家 HUD 广播');
assert.equal(Object.hasOwn(publicState, 'clocks'), false, '导演时钟不得广播给玩家');

const players = [{
  accountName: 'tester', characterId: 'character-1', name: '测试角色',
  hp: 10, san: 50, mp: 10, fullData: { stats: { pow: 50 } },
}];
campaignService.syncPartyStats(campaign, players);
campaignService.applyPartyStatChanges(campaign, [{ accountName: 'tester', type: 'HP', value: -3 }]);
campaignService.applyPartyStatsToPlayers(campaign, players);
assert.equal(players[0].hp, 7, '动态 HP 应写入战役状态并同步到玩家');
assert.equal(campaign.partyStats.tester.hp.current, 7);

console.log('Campaign state machine tests passed.');
