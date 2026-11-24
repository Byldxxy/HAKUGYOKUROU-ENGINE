// Build server rule data from the same definitions used by the character editor.
// Run from repository checkout after changing occupations, skills or their parser.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('../../ai-trpg-web/node_modules/typescript');
const root = path.resolve(__dirname, '../..');
const loadData = (name) => {
  const exports = {};
  vm.runInNewContext(ts.transpile(fs.readFileSync(path.join(root, 'ai-trpg-web/src/data', name), 'utf8'), { module: ts.ModuleKind.CommonJS }), { exports });
  return exports;
};
const { COC_OCCUPATIONS } = loadData('cocOccupations.ts');
const { COC_SKILL_TEMPLATES } = loadData('cocSkills.ts');
const editor = fs.readFileSync(path.join(root, 'ai-trpg-web/src/pages/CreateCharacter/index.tsx'), 'utf8').split('export default function')[0].replace(/^import .*;\n/gm, '');
const context = { COC_SKILL_TEMPLATES, COC_OCCUPATIONS };
vm.runInNewContext(ts.transpile(editor + '\n globalThis.output = COC_OCCUPATIONS.map(occupation => ({ ...occupation, rules: parseOccupationSkillRules(occupation.skills) }));'), context);
const output = JSON.stringify({ skills: COC_SKILL_TEMPLATES, occupations: context.output }, null, 2) + '\n';
const target = path.join(root, 'ai-trpg-server/data/character-rules.json');
if (process.argv.includes('--check')) {
  if (fs.readFileSync(target, 'utf8') !== output) throw new Error('Character rule data is stale; run generate-character-rules.js');
} else {
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, output);
}
console.log(`Character rules: ${COC_OCCUPATIONS.length} occupations synchronized.`);
