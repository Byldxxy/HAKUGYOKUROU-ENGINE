const { randomInt } = require('crypto');
const attributes = { 力量: 'str', 体质: 'con', 体型: 'siz', 敏捷: 'dex', 外貌: 'app',
  智力: 'int', 灵感: 'int', 意志: 'pow', 教育: 'edu', 幸运: 'luc' };
const skillValue = (player, skill) => {
  skill = skill.replace(/：/g, ':');
  const data = player.fullData?.fullData || player.fullData || {};
  if (['理智', 'SAN'].includes(skill.toUpperCase())) return Number(player.san) || 0;
  const key = attributes[skill] || (Object.values(attributes).includes(skill.toLowerCase()) ? skill.toLowerCase() : null);
  if (key) return Number(data.stats?.[key]) || 0;
  const found = (data.skills || []).find((item) => item.name === skill || item.name.split(' ')[0] === skill);
  if (!found) return null;
  return Math.min(100, Math.max(0, ['base', 'job', 'interest', 'grow'].reduce((sum, field) => sum + (Number(found[field]) || 0), 0)));
};
const describeRoll = (roll, value) => {
  if (roll === 1) return '大成功 (Critical Success)';
  if (roll === 100 || (value < 50 && roll >= 96)) return '大失败 (Fumble)';
  if (roll <= Math.floor(value / 5)) return '极难成功 (Extreme Success)';
  if (roll <= Math.floor(value / 2)) return '困难成功 (Hard Success)';
  if (roll <= value) return '常规成功 (Regular Success)';
  return '失败 (Failure)';
};
const levels = { regular: ['常规', 1], hard: ['困难', 2], extreme: ['极难', 5] };
const makeRollRules = (value, difficulty = 'regular', modifier = 0) => {
  if (!Number.isInteger(value) || value < 0 || typeof difficulty !== 'string' || !Object.hasOwn(levels, difficulty) ||
      !Number.isInteger(modifier) || Math.abs(modifier) > 2) return null;
  return { difficulty, modifier, baseValue: value, target: Math.floor(value / levels[difficulty][1]) };
};

// All candidates share their units die. A pair of zeroes represents 100.
const rollPercentile = (modifier, digit = () => randomInt(10)) => {
  const units = digit();
  const candidates = Array.from({ length: 1 + Math.abs(modifier) }, () => (digit() * 10 + units) || 100);
  return { candidates, roll: modifier < 0 ? Math.max(...candidates) : Math.min(...candidates) };
};

const rollSkill = (player, skill, rules = makeRollRules(skillValue(player, skill)), digit) => {
  if (!rules) throw new Error('未知检定规则');
  const { difficulty, modifier, target, baseValue } = rules;
  const { roll, candidates } = rollPercentile(modifier, digit);
  const fumble = roll === 100 || (baseValue < 50 && roll >= 96);
  const met = !fumble && (roll === 1 || roll <= target);
  const pool = modifier ? `，${modifier > 0 ? '奖励' : '惩罚'}骰候选：${candidates.join('、')}` : '';
  return `[对 ${skill} 进行检定]：掷出了 D100 = ${roll} / ${baseValue}${pool}，结果：【${describeRoll(roll, baseValue)}】，${levels[difficulty][0]}目标 ${target}，${met ? '已达成' : '未达成'}`;
};
module.exports = { skillValue, describeRoll, rollSkill, rollPercentile, makeRollRules };
