const { occupations, skills: templates } = require('../../data/character-rules.json');
const statNames = { 力量: 'str', 体质: 'con', 体型: 'siz', 敏捷: 'dex', 外貌: 'app', 智力: 'int', 意志: 'pow', 教育: 'edu', 幸运: 'luc' };
const occupationPoints = (formula, stats) => String(formula).replace(/\s|[()（）]/g, '').replace(/[x*]/g, '×').split(/[＋+]/).reduce((sum, part) => {
  const multiple = Number(part.match(/×(\d+)$/)?.[1] || 1);
  const names = part.replace(/×\d+$/, '').split('或');
  return sum + Math.max(...names.map(name => stats[statNames[name]] || 0)) * multiple;
}, 0);
const occupationSkills = (data) => {
  const occupation = occupations.find(item => item.name === data.basicInfo.occupation);
  const selected = new Set(occupation?.rules.fixedSkills || []);
  for (const group of occupation?.rules.choices || []) {
    const choices = data.occupationSkillChoices?.[group.id] || [];
    if (!Array.isArray(choices) || choices.length > group.count) fail('职业自选技能数量超过限制。');
    for (const choice of choices) {
      if (typeof choice !== 'string' || (!group.allowCustom && !group.options.includes(choice))) fail('职业自选技能不符合职业规则。');
      selected.add(choice);
    }
  }
  return { occupation, selected };
};
const fail = (message) => { const error = new Error(message); error.statusCode = 400; throw error; };
const normalizeCharacter = (data) => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('角色卡格式无效。');
  const name = String(data.basicInfo?.name || '').trim();
  if (!name || name.length > 40 || /[<>:\r\n]/.test(name)) fail('角色姓名需为 1–40 字，不能包含尖括号、冒号或换行。');
  const stats = {};
  for (const key of ['str', 'con', 'siz', 'dex', 'app', 'int', 'pow', 'edu', 'luc']) {
    const value = data.stats?.[key];
    if (!Number.isInteger(value) || value < 1 || value > 99) fail('九项基础属性必须为 1–99 的整数。');
    stats[key] = value;
  }
  if (!Array.isArray(data.skills) || data.skills.length > 300) fail('技能表格式无效。');
  const names = new Set();
  const skills = data.skills.map((skill) => {
    const name = String(skill?.name || '').trim();
    if (!name || name.length > 100 || /[<>\r\n]/.test(name) || names.has(name)) fail('技能名为空、重复或含非法字符。');
    names.add(name);
    for (const field of ['base', 'job', 'interest']) {
      if (!Number.isInteger(skill[field]) || skill[field] < 0 || skill[field] > 100) fail('技能点必须为 0–100 的整数。');
    }
    const template = templates.find(item => item.name === name);
    const categoryBases = { 技艺: 5, 科学: 1, 外语: 1, 格斗: 25, 射击: 20, 驾驶: 20, 生存: 10, 学识: 1, 操作重型机械: 1 };
    const base = template ? (template.dynamicBase === 'dexHalf' ? Math.floor(stats.dex / 2) : template.dynamicBase === 'edu' ? stats.edu : template.base) : (categoryBases[name.split(':')[0]] ?? 1);
    skill = { ...skill, base };
    if (skill.base + skill.job + skill.interest > 100) fail('技能总值不能超过 100。');
    return { ...skill, name, grow: 0 };
  });
  if (skills.reduce((sum, skill) => sum + skill.interest, 0) > stats.int * 2) fail('兴趣点数超支。');
  const { occupation, selected } = occupationSkills(data);
  const jobBudget = occupation ? occupationPoints(occupation.pointFormula, stats) : stats.edu * 4;
  if (skills.reduce((sum, skill) => sum + skill.job, 0) > jobBudget) fail('职业点数超支。');
  if (occupation && skills.some(skill => skill.job > 0 && !selected.has(skill.name))) fail('非本职技能不能分配职业点。');
  return { ...data, basicInfo: { ...data.basicInfo, name }, stats, skills, bgInfo: data.bgInfo || {} };
};
const validateForRoom = (card, rules) => {
  if (!card) return '请选择有效角色卡。';
  try { normalizeCharacter(card.fullData); } catch (error) { return error.message; }
  const data = card.fullData;
  if (data.statMode === 'buy' && Object.entries(data.stats).reduce((sum, [key, value]) => sum + (key === 'luc' ? 0 : value), 0) > rules.pointBuyLimit) return '属性购点超过房规上限。';
  const { selected } = occupationSkills(data);
  if (data.skills.some((skill) => skill.job + skill.interest > 0 && skill.base + skill.job + skill.interest > (selected.has(skill.name) ? rules.occupationSkillLimit : rules.interestSkillLimit))) return '技能分配超过房规上限，请在大厅编辑角色卡。';
  return null;
};
module.exports = { normalizeCharacter, validateForRoom, occupationPoints };
