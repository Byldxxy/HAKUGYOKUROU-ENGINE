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
const rollSkill = (player, skill) => {
  const value = skillValue(player, skill);
  if (value === null) throw new Error('未知技能');
  const roll = randomInt(1, 101);
  return `[对 ${skill} 进行检定]：掷出了 D100 = ${roll} / ${value}，结果：【${describeRoll(roll, value)}】`;
};
module.exports = { skillValue, describeRoll, rollSkill };
