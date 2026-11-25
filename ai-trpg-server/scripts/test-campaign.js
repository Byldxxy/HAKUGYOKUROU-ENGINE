const assert = require('node:assert/strict');
const campaignService = require('../src/services/campaignService');
const apply = (campaign, {facts = {}, transition = null, clockDeltas = {}}) => campaignService.applyDirectorResult({campaign, directorResult: {proposedStateChanges: {facts, clockDeltas}, proposedTransition: transition}}).campaign;
const finish = (script, route, ending) => {
  const state = route.reduce((state, action) => apply(state, action), campaignService.createCampaign(script));
  assert.equal(state.endingId, ending);
  assert.notEqual(state.phase, 'active');
};
const nightRoute = [
  { facts: { selfDiscovered: true }, transition: 'priest-procession' },
  { facts: { f1Explored: true }, transition: 'f2-investigation' },
  { facts: { f2Explored: true }, transition: 'night-kpc-room' },
  { facts: { warehouseKeyObtained: true }, transition: 'night-exploration' },
];
finish('ontology', [...nightRoute, { facts: { poisonDeviceObtained: true, poisonUsed: true } }], 'end-ultimate-evil');
finish('ontology', [...nightRoute, { facts: { signalJammerDestroyed: true, policeAlerted: true } }], 'end-modern-technology');
finish('ontology', [...nightRoute, { facts: { nightExplorationStarted: true }, transition: 'ritual-morning' },
  { facts: { ritualInterrupted: true }, transition: 'final-combat' }, { facts: { combatVictory: true } }], 'end-fortune-goddess');
finish('ontology', [nightRoute[0], ...Array(3).fill({ clockDeltas: { suspicion: 2 } })], 'end-anti-intellectualism');

const fresh = campaignService.createCampaign('peach');
assert.equal(fresh.chapterId, 'peach-v16-complete');
assert.equal(fresh.currentSceneId, 's00');
assert.deepEqual(campaignService.getPublicCampaign(fresh).revealedClues, []);
for (const key of ['facts', 'clocks', 'protectedSecrets', 'scene']) assert.equal(Object.hasOwn(campaignService.getPublicCampaign(fresh), key), false);
const routes = require('../scenarios/peach-island-v16/chapter-complete.routes.json');
const reached = new Set();
for (const route of routes) {
  let state = campaignService.createCampaign('peach');
  for (const step of route.steps) {
    assert.equal(state.phase, 'active');
    state = campaignService.applyDirectorResult({ campaign: state, directorResult: step.reply }).campaign;
    const expected = step.expect || {};
    if (expected.scene) assert.equal(state.currentSceneId, expected.scene);
    if (expected.phase) assert.equal(state.phase, expected.phase);
    for (const [key, value] of Object.entries(expected.facts || {})) assert.equal(state.facts[key], value);
    for (const [key, value] of Object.entries(expected.clocks || {})) assert.equal(state.clocks[key].value, value);
    if (expected.clues) assert.deepEqual(campaignService.getPublicCampaign(state).revealedClues.map(c => c.id).sort(), [...expected.clues].sort());
  }
  if (route.ending) {
    assert.equal(state.endingId, route.ending);
    reached.add(state.endingId);
  } else {
    assert.equal(state.phase, 'active');
  }
}
assert.deepEqual(reached, new Set(campaignService.getScenario(fresh).endings.map(e => e.id)));
const openingContext = JSON.stringify(campaignService.buildDirectorContext({campaign:fresh,players:[]}));
assert.ok(!/采样舱|母文明|格式化全人类|生态文明方舟|基因钥匙/.test(openingContext), '开场上下文不得携带后期秘密');
const players = [{accountName: 'tester', characterId: 'character-1', name: '测试角色', hp: 10, san: 50, mp: 10, fullData: {stats: {pow: 50}}}];
campaignService.syncPartyStats(fresh, players);
campaignService.applyPartyStatChanges(fresh, [{accountName: 'tester', type: 'HP', value: -3}]);
campaignService.applyPartyStatsToPlayers(fresh, players);
assert.equal(players[0].hp, 7);
assert.equal(fresh.partyStats.tester.hp.current, 7);
console.log('PASS published scenarios: all peach endings and pacing routes, four ontology endings, opening knowledge boundary, public projection and party stats.');
