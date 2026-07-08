const fs = require('fs');
const path = require('path');
const config = require('../config');

const SCENARIO_FILES = Object.freeze({
  peach: path.join(config.serverRoot, 'scenarios', 'peach-island', 'chapter-03.json'),
  ontology: path.join(config.serverRoot, 'scenarios', 'ontology', 'ontology.json'),
});

const scenarioCache = new Map();
const isSupportedScriptId = (scriptId) => Object.hasOwn(SCENARIO_FILES, scriptId);

const validateScenario = (scenario, scriptId) => {
  if (!scenario || !scenario.id || !Array.isArray(scenario.scenes) || scenario.scenes.length === 0) {
    throw new Error(`剧本 ${scriptId} 缺少必要的场景结构。`);
  }

  const sceneIds = new Set(scenario.scenes.map((scene) => scene.id));
  if (!sceneIds.has(scenario.initialState?.currentSceneId)) {
    throw new Error(`剧本 ${scriptId} 的初始场景不存在。`);
  }

  for (const scene of scenario.scenes) {
    if (scene.transition?.to && !sceneIds.has(scene.transition.to)) {
      throw new Error(`剧本 ${scriptId} 的场景 ${scene.id} 指向不存在的场景。`);
    }
  }

  return scenario;
};

const loadByScriptId = (scriptId = 'peach') => {
  if (!isSupportedScriptId(scriptId)) {
    throw new Error(`剧本 ${scriptId} 尚未接入结构化导演系统。`);
  }
  const normalizedId = scriptId;
  if (scenarioCache.has(normalizedId)) return scenarioCache.get(normalizedId);

  const filePath = SCENARIO_FILES[normalizedId];
  const scenario = validateScenario(JSON.parse(fs.readFileSync(filePath, 'utf8')), normalizedId);
  scenarioCache.set(normalizedId, scenario);
  return scenario;
};

module.exports = {
  isSupportedScriptId,
  loadByScriptId,
};
