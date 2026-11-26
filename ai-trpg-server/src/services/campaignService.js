const scenarioRepository = require('../repositories/scenarioRepository');

const memory = require('../domain/campaignMemory');

const clone = (value) => JSON.parse(JSON.stringify(value));

const createCampaign = (scriptId = 'peach') => {
  const { scenario, revision } = scenarioRepository.currentEdition(scriptId);
  const campaign = {
    scriptId,
    scenarioId: scenario.scenarioId,
    chapterId: scenario.id,
    scenarioRevision: revision,
    chapterTitle: scenario.title,
    phase: scenario.initialState.phase || 'active',
    currentSceneId: scenario.initialState.currentSceneId,
    round: scenario.initialState.round || 1,
    facts: clone(scenario.initialState.facts || {}),
    clocks: clone(scenario.initialState.clocks || {}),
    inventory: clone(scenario.initialState.inventory || []),
    partyStats: {},
    revealedClueIds: [],
    transitionHistory: [],
    endingId: null,
    endingLabel: null,
  };
  campaign.memory = memory.seed(campaign, scenario);
  return campaign;
};

const migrateCampaign = (campaign) => {
  if (!campaign || typeof campaign !== 'object') return campaign;
  const scenario = getScenario(campaign);
  if (!Array.isArray(campaign.transitionHistory)) campaign.transitionHistory = [];
  if (!Array.isArray(campaign.inventory)) campaign.inventory = [];
  if (!Array.isArray(campaign.memory)) campaign.memory = memory.seed(campaign, scenario);
  if (campaign.clocks?.injury) delete campaign.clocks.injury;
  if (
    campaign.endingId === 'chapter-costly-capture' &&
    Number(campaign.clocks?.pursuit?.value || 0) < Number(campaign.clocks?.pursuit?.max || 6)
  ) {
    campaign.phase = 'active';
    campaign.endingId = null;
    campaign.endingLabel = null;
  }
  if (!campaign.partyStats || typeof campaign.partyStats !== 'object') campaign.partyStats = {};
  return campaign;
};

const getScenario = scenarioRepository.resolveCampaign;

const getCurrentScene = (scenario, campaign) => {
  const scene = scenario.scenes.find(item => item.id === campaign.currentSceneId);
  if (!scene) throw scenarioRepository.incompatible('存档中的场景不属于此剧本修订。');
  return scene;
};

function visitsTo(campaign, scenario, id) {
  const initial = scenario.initialState.currentSceneId === id ? 1 : 0;
  return initial + campaign.transitionHistory.filter(visit => visit.to === id).length;
}

const getPlayerStatDefaults = (player) => {
  const characterData = player.fullData?.fullData || player.fullData || {};
  const stats = characterData.stats || {};
  const hp = Number(player.hp);
  const san = Number(player.san);
  const mp = Number(player.mp);
  return {
    hp: { current: Number.isFinite(hp) ? hp : 0, max: Number.isFinite(hp) ? hp : 0 },
    san: { current: Number.isFinite(san) ? san : 0, max: Number(stats.pow) || (Number.isFinite(san) ? san : 0) },
    mp: { current: Number.isFinite(mp) ? mp : 0, max: Number.isFinite(mp) ? mp : 0 },
  };
};

const syncPartyStats = (campaign, players = []) => {
  if (!campaign.partyStats || typeof campaign.partyStats !== 'object') campaign.partyStats = {};
  for (const player of players) {
    if (!player.accountName || !player.characterId) continue;
    const existing = campaign.partyStats[player.accountName];
    if (!existing || existing.characterId !== player.characterId) {
      campaign.partyStats[player.accountName] = {
        characterId: player.characterId,
        characterName: player.name,
        ...getPlayerStatDefaults(player),
      };
    } else {
      existing.characterName = player.name;
    }
  }
  return campaign;
};

const applyPartyStatChanges = (campaign, changes = []) => {
  for (const change of changes) {
    const partyMember = campaign.partyStats?.[change.accountName];
    const stat = partyMember?.[String(change.type || '').toLowerCase()];
    if (!stat) continue;
    stat.current = Math.min(stat.max, Math.max(0, stat.current + change.value));
  }
  return campaign;
};

const applyPartyStatsToPlayers = (campaign, players = []) => {
  for (const player of players) {
    const partyMember = campaign.partyStats?.[player.accountName];
    if (!partyMember || partyMember.characterId !== player.characterId) continue;
    player.hp = partyMember.hp.current;
    player.hpMax = partyMember.hp.max;
    player.san = partyMember.san.current;
    player.sanMax = partyMember.san.max;
    player.mp = partyMember.mp.current;
    player.mpMax = partyMember.mp.max;
  }
};

const evaluateCondition = (condition, campaign) => {
  if (!condition) return true;
  if (Array.isArray(condition.all)) return condition.all.every((item) => evaluateCondition(item, campaign));
  if (Array.isArray(condition.any)) return condition.any.some((item) => evaluateCondition(item, campaign));
  if (condition.itemHeldBy) {
    const { id, holder } = condition.itemHeldBy;
    return Boolean(holder && campaign.memory?.some(e => e.kind === 'item' && e.id === id && e.state.holder === holder));
  }
  if (condition.promiseStatus) {
    const { id, status } = condition.promiseStatus;
    return campaign.memory?.some(e => e.kind === 'promise' && e.id === id && e.state.status === status) || false;
  }
  if (condition.fact) return campaign.facts[condition.fact] === condition.equals;
  if (condition.clock) return Number(campaign.clocks[condition.clock]?.value || 0) >= Number(condition.atLeast || 0);
  return false;
};

const getPublicCampaign = (campaign, username, recapSources) => {
  migrateCampaign(campaign);
  const scenario = getScenario(campaign);
  const revealed = new Set(campaign.revealedClueIds || []);

  return {
    scenarioId: campaign.scenarioId,
    chapterId: campaign.chapterId,
    title: campaign.chapterTitle,
    phase: campaign.phase,
    ...(username && {
      inventory: memory.notebookItems(campaign, scenario, campaign.partyStats?.[username]?.characterId),
      recap: memory.notebookRecap(campaign, scenario, campaign.partyStats?.[username]?.characterId, recapSources),
    }),
    revealedClues: (scenario.clues || [])
      .filter((clue) => revealed.has(clue.id))
      .map(({ id, title, content }) => ({ id, title, content })),
    ending: campaign.endingId ? {
      id: campaign.endingId,
      label: campaign.endingLabel,
    } : null,
  };
};

const normalizeDirectorResult = (result) => {
  const value = result && typeof result === 'object' ? result : {};
  return {
    narration: String(value.narration || '').trim().slice(0, 8000),
    requestedRolls: Array.isArray(value.requestedRolls) ? value.requestedRolls : [],
    statChanges: Array.isArray(value.statChanges) ? value.statChanges : [],
    revealedClueIds: Array.isArray(value.revealedClueIds) ? value.revealedClueIds : [],
    proposedStateChanges: value.proposedStateChanges && typeof value.proposedStateChanges === 'object'
      ? value.proposedStateChanges
      : {},
    proposedTransition: typeof value.proposedTransition === 'string' ? value.proposedTransition : null,
    memoryChanges: Array.isArray(value.memoryChanges) ? value.memoryChanges : [],
    pacing: ['hold', 'advance', 'escalate'].includes(value.pacing) ? value.pacing : 'hold',
  };
};

const applyDirectorResult = ({ campaign, directorResult }) => {
  const next = migrateCampaign(clone(campaign));
  const scenario = getScenario(next);
  const scene = getCurrentScene(scenario, next);
  const result = normalizeDirectorResult(directorResult);
  const allowedFacts = new Set(scene.allowedFactChanges || []);
  const allowedClocks = new Set(scene.allowedClockChanges || []);
  const waitingForRolls = result.requestedRolls.length > 0;

  for (const [key, value] of Object.entries(waitingForRolls ? {} : (result.proposedStateChanges.facts || {}))) {
    if (allowedFacts.has(key) && Object.hasOwn(next.facts, key) && value === true) {
      next.facts[key] = true;
    }
  }

  for (const [clockId, rawDelta] of Object.entries(waitingForRolls ? {} : (result.proposedStateChanges.clockDeltas || {}))) {
    const clock = next.clocks[clockId];
    const delta = Math.round(Number(rawDelta));
    if (!clock || !allowedClocks.has(clockId) || !Number.isFinite(delta)) continue;
    clock.value = Math.min(clock.max, Math.max(0, clock.value + Math.min(2, Math.max(-2, delta))));
  }

  if (!waitingForRolls) memory.apply(next, scenario, result.memoryChanges, result.narration);

  const allowedClues = new Set(scene.availableClues || []);
  const clueMap = new Map((scenario.clues || []).map((clue) => [clue.id, clue]));
  for (const clueId of waitingForRolls ? [] : result.revealedClueIds) {
    if (!allowedClues.has(clueId) || next.revealedClueIds.includes(clueId)) continue;
    // NOTE: 线索若有 requires 前置条件，必须满足后才允许揭示，防止 AI 在玩家尚未探索时就提前剧透。
    const clueDef = clueMap.get(clueId);
    if (clueDef?.requires && !evaluateCondition(clueDef.requires, next)) continue;
    next.revealedClueIds.push(clueId);
  }

  let transition = null;
  const exit = scenarioRepository.exits(scene).find(edge => edge.to === result.proposedTransition);
  if (exit && !waitingForRolls && evaluateCondition(exit.when, next)) {
    const destination = scenario.scenes.find(item => item.id === exit.to);
    if (destination) {
      const returning = visitsTo(next, scenario, destination.id) > 0;
      transition = returning ? { ...destination, entryNarration: destination.revisitNarration || '' } : destination;
      next.transitionHistory.push({
        from: scene.id,
        to: transition.id,
        round: next.round,
        timestamp: new Date().toISOString(),
      });
      next.currentSceneId = transition.id;
    }
  }

  const ending = [...(scenario.endings || [])]
    .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0))
    .find((candidate) => evaluateCondition(candidate.conditions, next));
  if (ending) {
    next.phase = ending.result?.phase || 'completed';
    next.endingId = ending.id;
    next.endingLabel = ending.label;
  }

  next.round += 1;
  return { campaign: next, result, transition, ending };
};

const buildDirectorContext = ({ campaign, players, lines = [] }) => {
  const scenario = getScenario(campaign);
  const scene = getCurrentScene(scenario, campaign);
  const clueMap = new Map((scenario.clues || []).map((clue) => [clue.id, clue]));

  const { memory: entries, transitionHistory, partyStats } = migrateCampaign(campaign);
  const sceneVisits = {};
  for (const visit of transitionHistory) sceneVisits[visit.to] = (sceneVisits[visit.to] || 0) + 1;
  const campaignState = {
    phase: campaign.phase, round: campaign.round, currentSceneId: scene.id,
    facts: campaign.facts, clocks: campaign.clocks, inventory: campaign.inventory,
    revealedClueIds: campaign.revealedClueIds, sceneVisits,
    transitionHistory: transitionHistory.slice(-6),
    partyStats: Object.values(partyStats).map(({ characterId, characterName, hp, san, mp }) =>
      ({ characterId, characterName, hp, san, mp })),
  };
  const actors = memory.actorDirectory(scenario, campaign);
  const items = new Map((scenario.items || []).map(({ id, name }) => [id, { id, name }]));
  for (const entry of entries) {
    if (entry.kind === 'item') items.set(entry.id, { id: entry.id, name: entry.label,
      holder: entry.state.holder, location: entry.state.location });
  }
  return {
    chapter: {
      id: scenario.id,
      title: scenario.title,
      summary: scenario.summary,
      goal: scenario.chapterGoal,
    },
    adaptationRules: scenario.adaptationRules || [],
    resolutionRules: scenario.resolutionRules || [],
    protectedSecrets: scenario.directorSecrets,
    currentScene: visitsTo(campaign, scenario, scene.id) > 1
      ? { ...scene, entryNarration: scene.revisitNarration || '', revisiting: true }
      : scene,
    campaignState,
    actorDirectory: actors,
    itemDirectory: [...items.values()],
    recalledMemory: memory.recall(entries, scene.id, lines, actors),
    revealedClues: campaign.revealedClueIds.map((id) => clueMap.get(id)).filter(Boolean),
    players: players.map((player) => ({ name: player.name, role: player.role })),
    outputContract: scenario.directorOutputContract,
  };
};

module.exports = {
  normalizeDirectorResult,
  applyPartyStatChanges,
  applyPartyStatsToPlayers,
  applyDirectorResult,
  buildDirectorContext,
  createCampaign,
  getCurrentScene,
  getPublicCampaign,
  getScenario,
  importCardItems: memory.importCardItems,
  isSupportedScriptId: scenarioRepository.isSupportedScriptId,
  migrateCampaign,
  syncPartyStats,
};
