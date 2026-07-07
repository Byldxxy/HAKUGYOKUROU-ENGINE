const DEFAULT_ROOM_RULES = Object.freeze({
  pointBuyLimit: 480,
  occupationSkillLimit: 80,
  interestSkillLimit: 70,
});

const clampInteger = (value, min, max, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
};

const normalizeRoomRules = (rules = {}, currentRules = DEFAULT_ROOM_RULES) => ({
  pointBuyLimit: clampInteger(rules.pointBuyLimit, 100, 1000, currentRules.pointBuyLimit),
  occupationSkillLimit: clampInteger(rules.occupationSkillLimit, 1, 100, currentRules.occupationSkillLimit),
  interestSkillLimit: clampInteger(rules.interestSkillLimit, 1, 100, currentRules.interestSkillLimit),
});

module.exports = {
  DEFAULT_ROOM_RULES,
  normalizeRoomRules,
};
