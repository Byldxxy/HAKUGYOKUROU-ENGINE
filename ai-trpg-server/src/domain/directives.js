const ROLL_DIRECTIVE_REGEX = /<<ROLL:([^:<>]+):([^<>]+?)(?:>>|>)/g;
const STAT_DIRECTIVE_REGEX = /<<STAT:([^:<>]+):(HP|SAN|MP):([+-]?\d+)(?:>>|>)/g;
const ROLL_ACTION_REGEX = /^\[对\s*(.*?)\s*进行检定\]/;

// SECTION: AI 控制指令协议
// NOTE: 指令解析是 AI 输出协议的唯一后端入口，Socket 层不再直接写正则。
// NOTE: 正则末尾兼容单个 >，用于容错模型偶发漏掉一个尖括号的输出。
const parseRollRequests = (content = '') => {
  // NOTE: index 保留同一条 DM 里多个同技能检定的顺序，用于生成稳定 rollId。
  return Array.from(String(content).matchAll(ROLL_DIRECTIVE_REGEX), (match, index) => ({
    index,
    skill: match[1].trim(),
    player: match[2].trim(),
  }));
};

// SECTION: 属性变化指令
// NOTE: STAT 只承载数值变化，不在解析层决定是否立即持久化角色卡。
const parseStatDirectives = (content = '') => {
  return Array.from(String(content).matchAll(STAT_DIRECTIVE_REGEX), (match, index) => ({
    index,
    player: match[1].trim(),
    type: match[2].trim(),
    value: Number.parseInt(match[3].trim(), 10),
    rawValue: match[3].trim(),
  }));
};

// SECTION: 玩家可见文本清洗
// NOTE: DM 正文展示前剥离协议指令，避免玩家看到 <<ROLL>> / <<STAT>> 噪声。
const stripDirectives = (content = '') => {
  return String(content)
    .replace(ROLL_DIRECTIVE_REGEX, '')
    .replace(STAT_DIRECTIVE_REGEX, '')
    .trim();
};

// SECTION: 检定结果反解析
// NOTE: 玩家投骰消息是固定文案，后端用它识别该结果对应哪个技能。
const parseRollActionSkill = (message = '') => {
  const match = String(message).match(ROLL_ACTION_REGEX);
  return match?.[1]?.trim() || '';
};

// SECTION: 检定结果识别
// NOTE: 这里保持轻量判断，因为完整技能和角色匹配已在 turn_state 中完成。
const isRollResultMessage = (message = '') => {
  return String(message).includes('D100 =');
};

module.exports = {
  parseRollRequests,
  parseStatDirectives,
  stripDirectives,
  parseRollActionSkill,
  isRollResultMessage,
};
