// Run from any directory. Only the temporary scenario root is written.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const args = process.argv.slice(2);
if (args.length < 2 || args.length > 3) {
  console.error('用法: node check-scenario.cjs <项目根目录> <章节.json> [回放.json]');
  process.exit(2);
}
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
function ids(list, label) {
  assert.ok(Array.isArray(list), label + ' 应为数组');
  const keys = new Set();
  for (const row of list) {
    assert.ok(nonempty(row?.id) && !keys.has(row.id), label + ' 的 ID 为空或重复: ' + row?.id);
    keys.add(row.id);
  }
  return keys;
}
function check(s) {
  for (const key of ['id', 'scenarioId', 'title']) assert.ok(nonempty(s[key]), '缺少 ' + key);
  const start = s.initialState;
  const scenes = ids(s.scenes, 'scenes'), clues = ids(s.clues || [], 'clues');
  const endings = ids(s.endings, 'endings');
  assert.ok(endings.size, '章节需有可测试的结局');
  assert.ok(scenes.has(start?.currentSceneId), '初始场景不存在');
  assert.equal(start.phase || 'active', 'active', '章节开局须可行动');
  const facts = start.facts || {}, clocks = start.clocks || {};
  for (const [key,v] of Object.entries(facts)) assert.equal(typeof v, 'boolean', '事实须为布尔值: ' + key);
  for (const [key,c] of Object.entries(clocks)) {
    assert.ok(Number.isInteger(c.value) && Number.isInteger(c.max) && c.value >= 0 && c.value <= c.max, '时钟范围无效: ' + key);
  }
  function condition(c, where) {
    assert.ok(c && typeof c === 'object', where + ' 缺少条件');
    const ops = ['all','any','fact','clock','itemHeldBy','promiseStatus'].filter(key => Object.hasOwn(c, key));
    assert.equal(ops.length, 1, where + ' 应只使用一种条件运算');
    const op = ops[0];
    if (op === 'all' || op === 'any') {
      assert.ok(Array.isArray(c[op]) && c[op].length, where + ' 条件组为空');
      c[op].forEach(child => condition(child, where));
    } else if (op === 'fact') {
      assert.ok(Object.hasOwn(facts,c.fact) && typeof c.equals === 'boolean', where + ' 事实条件无效: ' + c.fact);
    } else if (op === 'itemHeldBy' || op === 'promiseStatus') {
      const rule = c[op];
      assert.ok(nonempty(rule?.id), where + ' 缺少记忆 ID');
      if (op === 'itemHeldBy') assert.ok(nonempty(rule.holder), where + ' 缺少持有人');
      else assert.ok(['open','kept','broken','released'].includes(rule.status), where + ' 承诺状态无效');
    } else {
      assert.ok(Object.hasOwn(clocks,c.clock) && Number.isInteger(c.atLeast) && c.atLeast <= clocks[c.clock].max, where + ' 时钟条件无效: ' + c.clock);
    }
  }
  for (const scene of s.scenes) {
    assert.ok(nonempty(scene.entryNarration), scene.id + ' 缺少入口叙述');
    for (const key of scene.allowedFactChanges || []) assert.ok(Object.hasOwn(facts,key), scene.id + ' 未定义事实: ' + key);
    for (const key of scene.allowedClockChanges || []) assert.ok(Object.hasOwn(clocks,key), scene.id + ' 未定义时钟: ' + key);
    for (const key of scene.availableClues || []) assert.ok(clues.has(key), scene.id + ' 未定义线索: ' + key);
    if (scene.transition != null) {
      assert.ok(!Array.isArray(scene.transition) && Object.hasOwn(scene.transition, 'to'), scene.id + ' 转场须为单目标');
      if (scene.transition.to != null) assert.ok(scenes.has(scene.transition.to), scene.id + ' 目标场景不存在');
      if (scene.transition.when != null) condition(scene.transition.when, scene.id);
    }
  }
  for (const clue of s.clues || []) {
    assert.ok(nonempty(clue.title) && nonempty(clue.content), clue.id + ' 缺少公开线索文字');
    if (clue.requires != null) condition(clue.requires, clue.id);
  }
  for (const e of s.endings) {
    condition(e.conditions, e.id);
    assert.ok(nonempty(e.label) && nonempty(e.result?.publicNarration), e.id + ' 缺少可见结局');
    assert.ok(['completed','redirected'].includes(e.result.phase || 'completed'), e.id + ' 结局阶段无效');
  }
}
function replay(engine, scenario, routes) {
  assert.ok(Array.isArray(routes) && routes.length, '回放需为非空数组');
  const reached = new Set();
  for (const route of routes) {
    let state = engine.createCampaign('peach');
    assert.ok(route.ending || nonempty(route.name), '回放缺少名称或结局');
    assert.ok(Array.isArray(route.steps) && route.steps.length, '回放缺少步骤');
    for (const [i,step] of route.steps.entries()) {
      const loc = (route.ending || route.name) + ' 第 ' + (i + 1) + ' 步';
      assert.equal(state.phase, 'active', loc + ' 已提前结算');
      state = engine.applyDirectorResult({campaign:state,directorResult:step.reply}).campaign;
      const e = step.expect || {};
      for (const check of e.memory || []) {
        const record = state.memory.find(m => m.kind === check.kind && m.id === check.id);
        if (check.who) assert.ok(record, loc + ' 未建立见闻所属记录');
        const data = check.who ? record.observers.find(o => o.who === check.who) : record;
        if (check.absent) assert.equal(data, undefined, loc);
        else {
          assert.ok(data, loc + ' 缺少记忆 ' + check.id);
          for (const [key,value] of Object.entries(check.state || {})) assert.deepEqual(data.state[key],value,loc+' '+key);
        }
      }
      if (e.scene) assert.equal(state.currentSceneId,e.scene,loc);
      if (e.phase) assert.equal(state.phase,e.phase,loc);
      if (e.clues) assert.deepEqual(engine.getPublicCampaign(state).revealedClues.map(c=>c.id).sort(),[...e.clues].sort(),loc);
      for (const [key,v] of Object.entries(e.facts || {})) assert.equal(state.facts[key],v,loc+' '+key);
      for (const [key,v] of Object.entries(e.clocks || {})) assert.equal(state.clocks[key]?.value,v,loc+' '+key);
    }
    if (!route.ending) {
      assert.equal(state.phase, 'active', '短路线提前结算');
      console.log('偏航回放通过:',route.name);
      continue;
    }
    assert.equal(state.endingId,route.ending,'未命中预期结局');
    assert.notEqual(state.phase,'active');
    reached.add(state.endingId);
    console.log('回放通过:',state.endingId);
  }
  assert.deepEqual(reached,new Set(scenario.endings.map(e=>e.id)),'回放未覆盖所有结局');
}
function run() {
  const [repo,file,routeFile] = args;
  const scenario = json(file);
  check(scenario);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'trpg-scenario-'));
  try {
    // Use unchanged production loader and state machine. Bind only the data root in this fixture.
    for (const rel of ['src/domain/campaignMemory.js','src/repositories/scenarioRepository.js','src/services/campaignService.js']) {
      const dst = path.join(temp,rel);
      fs.mkdirSync(path.dirname(dst),{recursive:true});
      fs.copyFileSync(path.join(repo,'ai-trpg-server',rel),dst);
    }
    fs.writeFileSync(path.join(temp,'src/config.js'),"module.exports = {serverRoot: require('node:path').join(__dirname,'..')};");
    const slot = path.join(temp,'scenarios/peach-island/chapter-03.json');
    fs.mkdirSync(path.dirname(slot),{recursive:true});
    fs.copyFileSync(file,slot);
    const engine = require(path.join(temp,'src/services/campaignService.js'));
    const state = engine.createCampaign('peach');
    assert.equal(state.chapterId,scenario.id);
    assert.equal(engine.buildDirectorContext({campaign:state,players:[]}).currentScene.id,scenario.initialState.currentSceneId);
    assert.deepEqual(engine.getPublicCampaign(state).revealedClues,[]);
    console.log('结构与隔离引擎载入通过:',scenario.title);
    if (routeFile) replay(engine,scenario,json(routeFile));
  } finally { fs.rmSync(temp,{recursive:true,force:true}); }
}
try { run(); } catch (error) { console.error(error.message); process.exitCode = 1; }
