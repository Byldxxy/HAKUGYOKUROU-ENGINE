const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const config = require('../config');

const files = {
  peach: 'peach-island/chapter-03.json',
  ontology: 'ontology/ontology.json',
  harbour: 'harbour/last-broadcast.json',
};
// Frozen identifiers let old campaigns select an edition even if an unrelated bundle is unavailable.
const legacyEditions = require('./legacyScenarioEditions.json');

const cache = new Map();
const current = new Map();
const persisted = new Set();
const isSupportedScriptId = id => Object.hasOwn(files, id);
const incompatible = message => Object.assign(new Error(message), { code: 'scenario_incompatible', statusCode: 409 });
const exits = scene => scene.transitions || (scene.transition?.to ? [scene.transition] : []);

function validate(scenario) {
  if (!scenario || !Array.isArray(scenario.scenes) || !scenario.scenes.length) throw new Error('剧本缺少场景。');
  const scenes = new Set(scenario.scenes?.map(scene => scene.id));
  if (!scenario.id || !scenes.has(scenario.initialState?.currentSceneId) || scenes.size !== scenario.scenes.length) {
    throw new Error('剧本场景无效。');
  }
  for (const scene of scenario.scenes) {
    if (scene.transitions !== undefined && (!Array.isArray(scene.transitions) || scene.transition)) {
      throw new Error('场景只能定义一组出口。');
    }
    if (scene.transition && (Array.isArray(scene.transition) || !Object.hasOwn(scene.transition, 'to'))) {
      throw new Error('单出口场景需要目标字段。');
    }
    const targets = new Set();
    for (const exit of exits(scene)) {
      if (!scenes.has(exit?.to) || targets.has(exit.to)) throw new Error('场景出口重复或目标不存在。');
      targets.add(exit.to);
    }
  }
}

const bundle = file => path.join(config.serverRoot, 'scenarios', file);
const archive = (id, revision) => path.join(config.paths.scenarioRevisionsDir, id, revision + '.json');
const revisionOf = scenario => createHash('sha256').update(JSON.stringify(scenario)).digest('hex');
function loadEdition(id, file, expected) {
  let scenario;
  try {
    scenario = JSON.parse(fs.readFileSync(file, 'utf8'));
    validate(scenario);
  } catch (error) {
    if (error.code === 'ENOENT') throw incompatible('这份战役所需的剧本文件缺失，请恢复对应修订。');
    if (expected) throw incompatible('存档对应的剧本文件读取失败，请检查或恢复该修订。');
    throw error;
  }
  const revision = revisionOf(scenario);
  if (expected && revision !== expected) throw incompatible('存档所需剧本修订的内容不匹配，请恢复对应剧本后继续。');
  const edition = { scenario, revision };
  cache.set(id + ':' + revision, edition);
  return edition;
}

function latest(id) {
  if (!isSupportedScriptId(id)) throw incompatible('存档指定的剧本未安装。');
  if (!current.has(id)) current.set(id, loadEdition(id, bundle(files[id])));
  return current.get(id);
}

function remember(id, edition) {
  const key = id + ':' + edition.revision;
  if (persisted.has(key)) return;
  const file = archive(id, edition.revision);
  if (fs.existsSync(file)) loadEdition(id, file, edition.revision);
  else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.' + randomUUID() + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(edition.scenario), { mode: 0o600 });
      fs.renameSync(tmp, file);
    } finally { fs.rmSync(tmp, { force: true }); }
  }
  persisted.add(key);
}

function pinned(id, revision) {
  if (typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision) || !isSupportedScriptId(id)) {
    throw incompatible('存档中的剧本修订标识无效。');
  }
  const cached = cache.get(id + ':' + revision);
  if (cached) return cached;
  const file = archive(id, revision);
  if (fs.existsSync(file)) return loadEdition(id, file, revision);
  const legacy = legacyEditions[id]?.find(item => item.revision === revision);
  if (legacy && fs.existsSync(bundle(legacy.file))) return loadEdition(id, bundle(legacy.file), revision);
  const installed = latest(id);
  if (installed.revision === revision) return installed;
  throw incompatible('这份存档需要的剧本修订尚未安装，请恢复原修订后再读档。');
}

function resolveCampaign(campaign) {
  const id = campaign.scriptId || 'peach';
  let edition;
  if (campaign.scenarioRevision !== undefined) edition = pinned(id, campaign.scenarioRevision);
  else {
    if (!isSupportedScriptId(id)) throw incompatible('存档指定的剧本未安装。');
    const factKeys = Object.keys(campaign.facts || {});
    const visited = [campaign.currentSceneId];
    for (const step of campaign.transitionHistory || []) visited.push(step.from, step.to);
    let candidates = (legacyEditions[id] || []).filter(entry =>
      (!campaign.chapterId || entry.chapter === campaign.chapterId) &&
      (!campaign.scenarioId || entry.scenarioId === campaign.scenarioId) &&
      visited.every(sceneId => entry.scenes.includes(sceneId)) &&
      factKeys.every(key => entry.factKeys.includes(key))
    );
    const exact = candidates.filter(entry => entry.factKeys.length === factKeys.length);
    if (exact.length) candidates = exact;
    if (candidates.length !== 1) throw incompatible(candidates.length
      ? '旧存档同时匹配多个剧本修订，无法确定原版。请提供原版本信息后再恢复。'
      : '旧存档的章节或场景与已安装的剧本修订不兼容。');
    edition = pinned(id, candidates[0].revision);
  }
  if ((campaign.chapterId && campaign.chapterId !== edition.scenario.id) ||
      (campaign.scenarioId && campaign.scenarioId !== edition.scenario.scenarioId) ||
      !edition.scenario.scenes.some(scene => scene.id === campaign.currentSceneId)) {
    throw incompatible('存档场景与指定的剧本修订不匹配。');
  }
  remember(id, edition);
  campaign.scenarioRevision = edition.revision;
  return edition.scenario;
}

function currentEdition(id) {
  const edition = latest(id);
  remember(id, edition);
  return edition;
}

module.exports = { currentEdition, exits, incompatible, isSupportedScriptId, loadByScriptId: (id = 'peach') => latest(id).scenario, resolveCampaign };
