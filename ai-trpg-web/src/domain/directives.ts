export type RollRequest = {
  index: number;
  skill: string;
  player: string;
};

export type StatDirective = {
  index: number;
  player: string;
  type: 'HP' | 'SAN' | 'MP';
  value: number;
  rawValue: string;
};

const ROLL_DIRECTIVE_REGEX = /<<ROLL:([^:<>]+):([^<>]+?)(?:>>|>)/g;
const STAT_DIRECTIVE_REGEX = /<<STAT:([^:<>]+):(HP|SAN|MP):([+-]?\d+)(?:>>|>)/g;
const ROLL_ACTION_REGEX = /^\[对\s*(.*?)\s*进行检定\]/;

// SECTION: AI 控制指令协议
// NOTE: 指令解析是 AI 输出协议的唯一前端入口，页面层不再直接写正则。
// NOTE: 前后端正则必须保持一致，否则会出现后端锁定、前端不显示按钮的问题。
export const parseRollRequests = (content = ''): RollRequest[] => {
  // NOTE: index 是同一条 DM 内的本地顺序，配合后端 lastDmIndex 组成稳定 rollId。
  return Array.from(String(content).matchAll(ROLL_DIRECTIVE_REGEX), (match, index) => ({
    index,
    skill: match[1].trim(),
    player: match[2].trim(),
  }));
};

// SECTION: 属性变化指令
// NOTE: 前端先用 STAT 更新本地展示，后续若做角色卡持久化可在这里沿用解析结果。
export const parseStatDirectives = (content = ''): StatDirective[] => {
  return Array.from(String(content).matchAll(STAT_DIRECTIVE_REGEX), (match, index) => ({
    index,
    player: match[1].trim(),
    type: match[2].trim() as StatDirective['type'],
    value: Number.parseInt(match[3].trim(), 10),
    rawValue: match[3].trim(),
  }));
};

// SECTION: 玩家可见文本清洗
// NOTE: 聊天框只显示叙事文本，控制指令由独立 UI 转换成按钮或属性变更。
export const stripDirectives = (content = '') => {
  return String(content)
    .replace(ROLL_DIRECTIVE_REGEX, '')
    .replace(STAT_DIRECTIVE_REGEX, '')
    .trim();
};

// SECTION: 检定结果反解析
// NOTE: 历史日志没有结构化 skill 字段时，用这段从玩家投骰文案中恢复技能名。
export const parseRollActionSkill = (message = '') => {
  return String(message).match(ROLL_ACTION_REGEX)?.[1]?.trim() || '';
};

// SECTION: 检定结果识别
// NOTE: 用于把历史消息区分成普通行动和骰子结果，避免影响回合发言统计。
export const isRollResultMessage = (message = '') => {
  return String(message).includes('D100 =');
};
