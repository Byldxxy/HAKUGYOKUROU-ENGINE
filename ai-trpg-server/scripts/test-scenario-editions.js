const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Replace the installed source in a disposable service root and restart the loader.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trpg-editions-'));
const root = path.resolve(__dirname, '..');
try {
  for (const file of ['src/repositories/scenarioRepository.js','src/repositories/legacyScenarioEditions.json','src/domain/campaignMemory.js','src/services/campaignService.js']) {
    const dest = path.join(tmp, file);
    fs.mkdirSync(path.dirname(dest), { recursive:true });
    fs.copyFileSync(path.join(root, file), dest);
  }
  fs.cpSync(path.join(root, 'scenarios/peach-island'), path.join(tmp, 'scenarios/peach-island'), { recursive:true });
  fs.writeFileSync(path.join(tmp, 'src/config.js'), "const path=require('node:path'); module.exports={serverRoot:path.join(__dirname,'..'),paths:{scenarioRevisionsDir:path.join(__dirname,'../archive')}};");
  const engineFile = path.join(tmp, 'src/services/campaignService.js');
  const engine = require(engineFile);
  const fresh = engine.createCampaign('peach');
  const source = path.join(tmp, 'scenarios/peach-island/chapter-03.json');
  const edition = JSON.parse(fs.readFileSync(source));
  fresh.currentSceneId = edition.scenes[2].id;
  const save = path.join(tmp, 'save.json');
  fs.writeFileSync(save, JSON.stringify(fresh));
  const allLegacy = ['revisions/chapter-three.json','revisions/v16-original.json','chapter-03.json'];
  const fixtures = allLegacy.map(filename => {
    const s = JSON.parse(fs.readFileSync(path.join(path.dirname(source), filename)));
    return {scriptId:'peach', chapterId:s.id, currentSceneId:s.scenes[0].id, facts:s.initialState.facts};
  });
  const recovered = fixtures.map(state => engine.migrateCampaign({...state}).scenarioRevision);
  assert.equal(new Set(recovered).size,3);
  assert.equal(recovered[2],fresh.scenarioRevision);
  assert.throws(() => engine.getScenario({scriptId:'peach',chapterId:edition.id,currentSceneId:'s00',facts:{}}), /多个剧本修订/);
  assert.throws(() => engine.getScenario({...fresh,currentSceneId:'unknown'}), /场景/);
  assert.throws(() => engine.getScenario({...fresh,scenarioRevision:'0'.repeat(64)}), /修订/);
  assert.throws(() => engine.getScenario({...fresh,scenarioRevision:'../etc'}), /修订/);
  edition.scenes[2].id = 'renamed-in-next-edition';
  edition.scenes[1].transition.to = edition.scenes[2].id;
  fs.writeFileSync(source, JSON.stringify(edition));
  // Unrelated unavailable legacy revisions must not prevent the six-scene campaign from opening.
  fs.rmSync(path.join(path.dirname(source),'revisions/v16-original.json'));
  fs.rmSync(path.join(tmp,'archive','peach',recovered[1]+'.json'));
  fs.writeFileSync(path.join(tmp,'legacy.json'),JSON.stringify(fixtures[0]));
  execFileSync(process.execPath, ['-e', `
    const assert=require('node:assert/strict'), e=require('./src/services/campaignService');
    const saved=require('./save.json'), fresh=e.createCampaign('peach');
    assert.notEqual(fresh.scenarioRevision,saved.scenarioRevision);
    assert.equal(e.getCurrentScene(e.getScenario(saved),saved).id,saved.currentSceneId);
    assert.equal(e.getScenario(require('./legacy.json')).scenes.length,6);
    const partial = {scriptId:'peach', chapterId:saved.chapterId, currentSceneId:'s00',
      transitionHistory:[{from:'prologue-cave',to:'s00'}],facts:{}};
    assert.equal(e.getScenario(partial).scenes.length,40);
    assert.equal(e.getScenario(fresh).scenes[2].id,'renamed-in-next-edition');
  `], { cwd:tmp, stdio:'inherit' });
  console.log('PASS campaign revision pins, restart after edition replacement, three legacy editions, missing and ambiguous revisions.');
} finally { fs.rmSync(tmp, { recursive:true, force:true }); }
