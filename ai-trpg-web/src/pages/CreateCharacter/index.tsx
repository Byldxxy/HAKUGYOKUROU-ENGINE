import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { apiFetch } from '../../config';
import { COC_OCCUPATIONS, type CocOccupation } from '../../data/cocOccupations';
import { COC_SKILL_TEMPLATES } from '../../data/cocSkills';
import StyledSelect from '../../components/StyledSelect';
import type { RoomRules } from '../../domain/roomRules';
import './CreateCharacter.css';

// SECTION: 骰点工具
// NOTE: COC 7th 属性生成大量使用 D6，这里保持最小工具函数便于测试替换。
const rollD6 = () => Math.floor(Math.random() * 6) + 1;

// SECTION: 空属性模板
// NOTE: 属性值全部以 COC 百分制保存，0 表示尚未生成/填写。
const emptyStats = {
  str: 0, con: 0, siz: 0, dex: 0, app: 0, int: 0, pow: 0, edu: 0, luc: 0
};

const statLabels: Record<string, string> = {
  str: '力量',
  con: '体质',
  siz: '体型',
  dex: '敏捷',
  app: '外貌',
  int: '智力',
  pow: '意志',
  edu: '教育',
  luc: '幸运',
};

const statOrder = ['str', 'con', 'siz', 'dex', 'app', 'int', 'pow', 'edu', 'luc'];

const statDescriptions: Record<string, string> = {
  str: '近战伤害、负重与力量对抗',
  con: '生命值、耐力与疾病抵抗',
  siz: '生命值、体格与伤害加值',
  dex: '行动顺序、闪避与灵活动作',
  app: '社交印象、魅力与外在形象',
  int: '兴趣点、灵感与理解能力',
  pow: '理智、魔法值与精神对抗',
  edu: '职业点、知识与母语基础',
  luc: '幸运检定与意外转机',
};

// SECTION: 空背景模板
// NOTE: 背景字段直接持久化进 fullData，游戏页目前只读取基础/技能/资源。
const emptyBgInfo = {
  description: '', belief: '', importantPerson: '', meaningfulPlace: '',
  treasuredItem: '', traits: '', scars: '', phobias: '', history: '', credit: '', wealth: ''
};

// SECTION: 职业点数公式解析
// NOTE: COC 职业表常见格式为“教育×4”或“教育×2＋力量或敏捷×2”，含“或”时取当前较高属性。
const statNameMap: Record<string, string> = {
  力量: 'str',
  体质: 'con',
  体型: 'siz',
  敏捷: 'dex',
  外貌: 'app',
  智力: 'int',
  意志: 'pow',
  教育: 'edu',
  幸运: 'luc',
};

const getStatByChineseName = (stats: Record<string, number>, name: string) => {
  const key = statNameMap[name.trim()];
  return key ? (stats[key] || 0) : 0;
};

const calculateOccupationPoints = (formula: string, stats: Record<string, number>) => {
  if (!formula) return 0;

  const normalizedFormula = formula
    .replace(/\s/g, '')
    .replace(/[()（）]/g, '')
    .replace(/x/g, '×')
    .replace(/\*/g, '×');

  return normalizedFormula.split(/[＋+]/).reduce((sum, rawPart) => {
    const part = rawPart.trim();
    if (!part) return sum;

    // NOTE: “力量或敏捷×2”表示二选一属性乘同一个倍率，取当前属性较高者。
    if (part.includes('或')) {
      const multiplier = Number(part.match(/×(\d+)$/)?.[1] || 1);
      const optionText = part.replace(/×\d+$/, '');
      const bestValue = Math.max(...optionText.split('或').map((name) => getStatByChineseName(stats, name)));
      return sum + bestValue * multiplier;
    }

    const match = part.match(/^(.+?)(?:×(\d+))?$/);
    if (!match) return sum;

    const statValue = getStatByChineseName(stats, match[1]);
    const multiplier = Number(match[2] || 1);
    return sum + statValue * multiplier;
  }, 0);
};

type Skill = {
  id: string;
  name: string;
  base: number;
  job: number;
  interest: number;
  grow: number;
};

type SkillGrowthContext = {
  pastExperience: string;
};

// SECTION: 技能成长公式接口
// NOTE: 写卡阶段成长固定为 0；后续“过去经历”规则接入时只需替换该函数实现。
const calculateSkillGrowth = (_skill: Skill, _context: SkillGrowthContext) => 0;

type OccupationChoiceGroup = {
  id: string;
  label: string;
  count: number;
  options: string[];
  allowCustom: boolean;
  placeholder: string;
};

type OccupationSkillRules = {
  fixedSkills: string[];
  choices: OccupationChoiceGroup[];
};

const countTextMap: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
};

const socialSkillOptions = ['魅惑', '话术', '恐吓', '说服'];

const coreSkillAliases: Record<string, string> = {
  取悦: '魅惑',
  魅惑: '魅惑',
  话术: '话术',
  恐吓: '恐吓',
  说服: '说服',
  会计: '会计',
  人类学: '人类学',
  估价: '估价',
  考古学: '考古学',
  技艺: '技艺',
  艺术: '技艺',
  手艺: '技艺',
  攀爬: '攀爬',
  计算机: '计算机使用',
  计算机使用: '计算机使用',
  信用评级: '信用评级',
  乔装: '乔装',
  闪避: '闪避',
  汽车驾驶: '汽车驾驶',
  驾驶: '汽车驾驶',
  电气维修: '电气维修',
  斗殴: '格斗:斗殴',
  格斗: '格斗:斗殴',
  射击: '射击:手枪',
  急救: '急救',
  历史: '历史',
  跳跃: '跳跃',
  母语: '母语',
  外语: '外语',
  其他语言: '外语',
  法律: '法律',
  图书馆: '图书馆使用',
  图书馆使用: '图书馆使用',
  聆听: '聆听',
  机械维修: '机械维修',
  医学: '医学',
  博物学: '博物学',
  自然: '博物学',
  自然学: '博物学',
  导航: '导航',
  领航: '导航',
  神秘学: '神秘学',
  秘教: '神秘学',
  精神分析: '精神分析',
  心理学: '心理学',
  侦查: '侦查',
  侦察: '侦查',
  潜行: '潜行',
  骑乘: '骑术',
  骑术: '骑术',
  妙手: '妙手',
  操作重型机械: '操作重型机械',
  重型机械操作: '操作重型机械',
  游泳: '游泳',
  投掷: '投掷',
  追踪: '追踪',
};

const subtypedSkillBaseMap: Record<string, number> = {
  技艺: 5,
  科学: 1,
  外语: 1,
  格斗: 25,
  射击: 20,
  驾驶: 20,
  生存: 10,
  学识: 1,
  操作重型机械: 1,
};

const specialtyCategoryOptions = [
  '技艺',
  '科学',
  '外语',
  '格斗',
  '射击',
  '驾驶',
  '生存',
  '学识',
];

const specialtySubtypeOptions: Record<string, string[]> = {
  技艺: ['表演', '摄影', '绘画', '写作', '书法', '木工', '烹饪', '歌唱', '舞蹈', '乐器'],
  科学: ['天文学', '生物学', '化学', '地质学', '数学', '物理学', '药学', '植物学', '动物学', '司法科学'],
  外语: ['英语', '法语', '德语', '西班牙语', '阿拉伯语', '拉丁语', '日语', '中文'],
  格斗: ['斗殴', '剑', '斧', '鞭', '矛', '链锯'],
  射击: ['手枪', '步枪/霰弹枪', '冲锋枪', '弓术', '重武器'],
  驾驶: ['船', '飞行器', '小艇', '热气球'],
  生存: ['荒野', '沙漠', '海上', '山地', '极地'],
  学识: ['佛教', '道教', '神道教', '阴阳道'],
};

const customSubtypeValue = '__custom__';

const isPlaceholderSkill = (name: string) => /:自定义[①②③]?$/.test(name);

const createDefaultSkills = (stats: Record<string, number>): Skill[] => COC_SKILL_TEMPLATES.map((template) => ({
  id: `skill_${template.id}`,
  name: template.name,
  base: template.dynamicBase === 'dexHalf'
    ? Math.floor((stats.dex || 0) / 2)
    : template.dynamicBase === 'edu'
      ? stats.edu || 0
      : template.base,
  job: 0,
  interest: 0,
  grow: 0,
}));

const normalizePersistedSkillName = (name: string) => {
  if (/^(自然|自然学)(?:\s|\(|（|$)/i.test(name) || /Natural World/i.test(name)) {
    return '博物学';
  }
  const chineseName = name
    .replace(/\s+\([A-Za-z][A-Za-z0-9 :/.-]*\)$/, '')
    .trim();
  const legacyNames: Record<string, string> = {
    '驾驶': '汽车驾驶',
    '斗殴': '格斗:斗殴',
    '劝说': '说服',
    '领航': '导航',
    '秘教': '神秘学',
  };
  return legacyNames[chineseName] || chineseName;
};

const mergeSkillTemplates = (templateSkills: Skill[], savedSkills?: Skill[]) => {
  if (!savedSkills) return templateSkills;
  const mergedSkills = savedSkills.reduce<Skill[]>((result, savedSkill) => {
    const normalizedSkill = {
      ...savedSkill,
      name: normalizePersistedSkillName(savedSkill.name),
      grow: 0,
    };
    if (isPlaceholderSkill(normalizedSkill.name)
      && !normalizedSkill.job
      && !normalizedSkill.interest) return result;
    const existingSkill = result.find((skill) => skill.name === normalizedSkill.name);
    if (existingSkill) {
      existingSkill.base = Math.max(existingSkill.base || 0, normalizedSkill.base || 0);
      existingSkill.job += normalizedSkill.job || 0;
      existingSkill.interest += normalizedSkill.interest || 0;
      existingSkill.grow = 0;
    } else {
      result.push(normalizedSkill);
    }
    return result;
  }, []);
  templateSkills.forEach((templateSkill) => {
    if (!mergedSkills.some((skill) => skill.name === templateSkill.name)) {
      mergedSkills.push(templateSkill);
    }
  });
  return mergedSkills;
};

const normalizePersistedChoices = (choices?: Record<string, string[]>) => Object.fromEntries(
  Object.entries(choices || {}).map(([groupId, skillNames]) => [
    groupId,
    skillNames
      .map(normalizePersistedSkillName)
      .filter((skillName) => !isPlaceholderSkill(skillName)),
  ])
);

const normalizeSkillLookupKey = (value: string) => value
  .replace(/[（(].*?[）)]/g, '')
  .replace(/\s/g, '')
  .replace(/：/g, ':')
  .trim();

const splitChineseList = (value: string) => value
  .split(/[，、,/]/)
  .map((item) => item.trim())
  .filter(Boolean);

const splitTopLevelChineseList = (value: string) => {
  const result: string[] = [];
  let currentText = '';
  let depth = 0;

  Array.from(value).forEach((char) => {
    if (char === '（' || char === '(') depth += 1;
    if (char === '）' || char === ')') depth = Math.max(0, depth - 1);

    if (depth === 0 && /[，、,/。；;]/.test(char)) {
      if (currentText.trim()) result.push(currentText.trim());
      currentText = '';
      return;
    }

    currentText += char;
  });

  if (currentText.trim()) result.push(currentText.trim());
  return result;
};

const getCountFromText = (value: string) => countTextMap[value] || Number(value) || 1;

const normalizeSubtypedSkillName = (category: string, subtype: string) => {
  const cleanCategory = normalizeSkillLookupKey(category);
  const cleanSubtype = subtype.trim();
  if (!cleanSubtype) return '';
  if (cleanCategory === '格斗' && cleanSubtype === '斗殴') return '格斗:斗殴';
  if (cleanCategory === '射击' && cleanSubtype === '手枪') return '射击:手枪';
  return `${cleanCategory}:${cleanSubtype}`;
};

const normalizeSkillName = (rawSkillName: string) => {
  const trimmedName = rawSkillName.trim().replace(/[。；;]/g, '');
  if (!trimmedName) return '';

  const parentheticalMatch = trimmedName.match(/^(.+?)[（(](.+?)[）)]$/);
  if (parentheticalMatch) {
    const category = normalizeSkillLookupKey(parentheticalMatch[1]);
    if (specialtyCategoryOptions.includes(category)) {
      return normalizeSubtypedSkillName(category, parentheticalMatch[2]);
    }
  }

  const lookupKey = normalizeSkillLookupKey(trimmedName);
  return coreSkillAliases[lookupKey] || trimmedName;
};

const getBaseValueForSkill = (skillName: string, stats: Record<string, number>) => {
  if (skillName.includes('闪避')) return Math.floor(stats.dex / 2) || 0;
  if (skillName.includes('母语')) return stats.edu || 0;
  const category = skillName.split(':')[0];
  return subtypedSkillBaseMap[category] ?? 1;
};

const createSkillFromName = (skillName: string, stats: Record<string, number>): Skill => ({
  id: `custom_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  name: skillName,
  base: getBaseValueForSkill(skillName, stats),
  job: 0,
  interest: 0,
  grow: 0,
});

const parseOccupationSkillRules = (skillText: string): OccupationSkillRules => {
  let remainingText = skillText || '';
  const choices: OccupationChoiceGroup[] = [];

  const addChoiceGroup = (label: string, count: number, options: string[], allowCustom: boolean, placeholder: string) => {
    choices.push({
      id: `${choices.length}_${label}`,
      label,
      count,
      options: Array.from(new Set(options.map(normalizeSkillName).filter(Boolean))),
      allowCustom,
      placeholder,
    });
  };

  remainingText = remainingText.replace(/([一二两三四五六七八九十\d]+)项社交技能[（(]([^）)]+)[）)]/g, (_, countText: string, optionsText: string) => {
    addChoiceGroup('社交技能自选', getCountFromText(countText), splitChineseList(optionsText), false, '选择社交技能');
    return '';
  });

  remainingText = remainingText.replace(/任意([一二两三四五六七八九十\d]+)项(?:其他)?(?:个人或时代)?特长/g, (_, countText: string) => {
    addChoiceGroup('个人或时代特长', getCountFromText(countText), [], true, '输入或选择特长技能');
    return '';
  });

  remainingText = remainingText.replace(/任意([一二两三四五六七八九十\d]+)项(?:其他)?技能/g, (_, countText: string) => {
    addChoiceGroup('任意技能', getCountFromText(countText), [], true, '输入或选择任意技能');
    return '';
  });

  remainingText = remainingText.replace(/([一二两三四五六七八九十\d]+)项其他语言/g, (_, countText: string) => {
    addChoiceGroup('其他语言', getCountFromText(countText), [], true, '例如：外语:拉丁语');
    return '';
  });

  const fixedSkills: string[] = [];
  splitTopLevelChineseList(remainingText).forEach((rawToken) => {
    const token = rawToken.trim();
    if (!token || token.includes('任意') || token.includes('特长')) return;

    const parentheticalMatch = token.match(/^(.+?)[（(](.+?)[）)]$/);
    if (parentheticalMatch) {
      const category = normalizeSkillLookupKey(parentheticalMatch[1]);
      if (specialtyCategoryOptions.includes(category)) {
        splitChineseList(parentheticalMatch[2]).forEach((subtype) => {
          const skillName = normalizeSubtypedSkillName(category, subtype);
          if (skillName) fixedSkills.push(skillName);
        });
        return;
      }
    }

    const skillName = normalizeSkillName(token);
    if (skillName) fixedSkills.push(skillName);
  });

  return {
    fixedSkills: Array.from(new Set(fixedSkills)),
    choices,
  };
};

export default function CreateCharacter() {
  const navigate = useNavigate();
  const location = useLocation();

  // SECTION: 编辑模式入口
  // NOTE: Lobby 点击编辑时通过 navigate state 传入整张角色摘要和 fullData。
  const editData = location.state?.character;
  const roomRules = location.state?.roomRules as RoomRules | undefined;
  const lockRoomLimits = Boolean(location.state?.lockRoomLimits && roomRules);

  // SECTION: 页面页签与基础资料
  // NOTE: 新建时使用默认空值，编辑时优先回填旧角色的 fullData.basicInfo。
  const [activeTab, setActiveTab] = useState('skills');
  const [basicInfo, setBasicInfo] = useState(editData?.fullData?.basicInfo || {
    name: '', age: 20, gender: '', era: '1920s', 
    residence: '', hometown: '', occupation: ''
  });

  // SECTION: 头像上传状态
  // NOTE: 头像目前只在本页预览，尚未进入持久化数据结构。
  const [avatar, setAvatar] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // SECTION: 属性生成模式
  // NOTE: roll 是传统随机，buy 是购点；两种模式共用同一份 stats。
  const [statMode, setStatMode] = useState<'roll' | 'buy'>(() => (
    lockRoomLimits ? 'buy' : (editData?.fullData?.statMode || 'roll')
  ));
  const [buyLimit, setBuyLimit] = useState(() => (
    lockRoomLimits ? roomRules!.pointBuyLimit : (editData?.fullData?.buyLimit || 480)
  ));
  const [stats, setStats] = useState<Record<string, number>>({
    ...emptyStats,
    ...(editData?.fullData?.stats || {})
  });

  // SECTION: 派生资源
  // NOTE: SAN 初始值等于 POW；HP/MP 在后端摘要中按 CON/SIZ/POW 派生。
  const san = stats.pow;
  // NOTE: COC 7th 移动力按 DEX/STR 与 SIZ 的比较决定。
  const move = stats.dex < stats.siz && stats.str < stats.siz ? 7 : stats.dex > stats.siz && stats.str > stats.siz ? 9 : 8;

  // SECTION: 伤害加值与体格
  // NOTE: DB/build 由 STR + SIZ 区间推导，显示用，不直接保存到后端摘要。
  const strSizSum = stats.str + stats.siz;
  let db = "0", build = 0;
  if (strSizSum >= 2 && strSizSum <= 64) { db = "-2"; build = -2; }
  else if (strSizSum >= 65 && strSizSum <= 84) { db = "-1"; build = -1; }
  else if (strSizSum >= 85 && strSizSum <= 124) { db = "0"; build = 0; }
  else if (strSizSum >= 125 && strSizSum <= 164) { db = "+1D4"; build = 1; }
  else if (strSizSum >= 165) { db = "+1D6"; build = 2; }

  // SECTION: 购点预算
  // NOTE: 当前购点模式把 LUC 也计入 spentStatPoints；UI 文案提示 LUC 可按房规单独处理。
  const spentStatPoints = stats.str + stats.con + stats.siz + stats.dex + stats.app + stats.int + stats.pow + stats.edu;
  const remainStatPoints = buyLimit - spentStatPoints;

  // SECTION: 技能状态
  // NOTE: 编辑旧卡时保留已分配点数，同时补齐新版标准技能。
  const [skills, setSkills] = useState<Skill[]>(() => mergeSkillTemplates(
    createDefaultSkills(stats),
    editData?.fullData?.skills
  ));

  // SECTION: 职业技能自选槽
  // NOTE: 保存结构仍然只落 skills，这个状态用于编辑页把职业规则投射成 UI。
  const [occupationSkillChoices, setOccupationSkillChoices] = useState<Record<string, string[]>>(
    () => normalizePersistedChoices(editData?.fullData?.occupationSkillChoices)
  );
  // NOTE: 三份草稿分别保存上级技能、预设子技能和用户填写的自定义子技能。
  const [choiceDrafts, setChoiceDrafts] = useState<Record<string, string>>({});
  const [choiceSubtypeDrafts, setChoiceSubtypeDrafts] = useState<Record<string, string>>({});
  const [choiceCustomSubtypeDrafts, setChoiceCustomSubtypeDrafts] = useState<Record<string, string>>({});

  // SECTION: 属性联动技能
  // NOTE: 闪避基础值依赖 DEX，母语基础值依赖 EDU；属性改动后自动刷新。
  useEffect(() => {
    setSkills(prev => prev.map(s => {
      if (s.name.includes('闪避')) return { ...s, base: Math.floor(stats.dex / 2) || 0 };
      if (s.name.includes('母语')) return { ...s, base: stats.edu || 0 };
      return s;
    }));
  }, [stats.dex, stats.edu]);

  // SECTION: 技能字段更新
  // NOTE: 技能名保持字符串，点数字段统一转 number，空输入视为 0。
  const updateSkill = (id: string, field: string, value: string | number) => {
    setSkills((currentSkills) => currentSkills.map(s => {
      if (s.id !== id) return s;
      if (field === 'name') return { ...s, name: String(value) };
      let numericValue = Math.max(0, Number(value) || 0);
      if (lockRoomLimits && ['job', 'interest'].includes(field)) {
        const skillLimit = occupationalSkillNameSet.has(s.name)
          ? roomRules!.occupationSkillLimit
          : roomRules!.interestSkillLimit;
        const otherAllocatedPoints = ['job', 'interest']
          .filter((pointField) => pointField !== field)
          .reduce((sum, pointField) => sum + (s[pointField as 'job' | 'interest'] || 0), 0);
        numericValue = Math.min(numericValue, Math.max(0, skillLimit - s.base - otherAllocatedPoints));
      }
      return { ...s, [field]: numericValue };
    }));
  };

  // SECTION: 自定义技能
  // NOTE: custom_ 前缀用于渲染时判断是否允许编辑初始值和删除。
  const addCustomSkill = () => {
    setSkills([...skills, { 
      id: `custom_${Date.now()}`, name: '', base: 1, job: 0, interest: 0, grow: 0 
    }]);
  };

  // SECTION: 清空技能投入
  // NOTE: 仅重置职业、兴趣与成长点，保留技能条目、初始值和职业自选配置。
  const clearAllSkillPoints = () => {
    if (!window.confirm('确定清空所有技能的职业、兴趣与成长加点吗？')) return;
    setSkills((currentSkills) => currentSkills.map((skill) => ({
      ...skill,
      job: 0,
      interest: 0,
      grow: 0,
    })));
  };

  // SECTION: 删除自定义技能
  // NOTE: 默认技能不提供删除按钮，所以这里主要服务 custom_ 技能。
  const removeSkill = (id: string) => {
    setSkills(skills.filter(s => s.id !== id));
  };

  // SECTION: 技能点预算
  // NOTE: 本职点优先读取当前职业公式；未选择职业时退回常见的 EDU*4。
  const occupationForSkillPage = COC_OCCUPATIONS.find((occupation) => occupation.name === basicInfo.occupation);
  const totalJobPoints = occupationForSkillPage ? calculateOccupationPoints(occupationForSkillPage.pointFormula, stats) : stats.edu * 4;
  const totalIntPoints = stats.int * 2;
  const spentJob = skills.reduce((sum, s) => sum + (s.job || 0), 0);
  const spentInt = skills.reduce((sum, s) => sum + (s.interest || 0), 0);
  const remainJob = totalJobPoints - spentJob;
  const remainInt = totalIntPoints - spentInt;

  // SECTION: 背景资料
  // NOTE: 背景资料只影响角色档案展示，不参与当前自动判定逻辑。
  const [bgInfo, setBgInfo] = useState({
    ...emptyBgInfo,
    ...(editData?.fullData?.bgInfo || {})
  });

  const growthRuleContext = useMemo<SkillGrowthContext>(() => ({
    pastExperience: bgInfo.history,
  }), [bgInfo.history]);

  const getSkillGrowth = (skill: Skill) => calculateSkillGrowth(skill, growthRuleContext);

  // SECTION: 职业列表状态
  // NOTE: 职业数据来自 Excel 的“职业列表”工作表，页面只负责检索、预览和套用基础字段。
  const [occupationSearch, setOccupationSearch] = useState('');
  const [selectedOccupationId, setSelectedOccupationId] = useState(2);
  const [occupationSortMode, setOccupationSortMode] = useState<'id' | 'points'>('id');

  // SECTION: 职业检索
  // NOTE: 检索同时覆盖职业名、信用评级、点数公式和本职技能，方便按技能反查职业。
  const filteredOccupations = useMemo(() => {
    const keyword = occupationSearch.trim().toLowerCase();
    if (!keyword) return COC_OCCUPATIONS;

    return COC_OCCUPATIONS.filter((occupation) => {
      const searchText = [
        occupation.id,
        occupation.name,
        occupation.creditRange,
        occupation.pointFormula,
        occupation.skills,
        occupation.contacts,
        occupation.description,
      ].join(' ').toLowerCase();
      return searchText.includes(keyword);
    });
  }, [occupationSearch]);

  // SECTION: 职业排序
  // NOTE: 按职业点数排序时使用当前属性实时计算，点数相同再按序号保持稳定。
  const visibleOccupations = useMemo(() => {
    const occupations = [...filteredOccupations];
    if (occupationSortMode === 'points') {
      return occupations.sort((a, b) => {
        const pointDiff = calculateOccupationPoints(b.pointFormula, stats) - calculateOccupationPoints(a.pointFormula, stats);
        return pointDiff || a.id - b.id;
      });
    }
    return occupations.sort((a, b) => a.id - b.id);
  }, [filteredOccupations, occupationSortMode, stats]);

  const selectedOccupation = useMemo(() => {
    return COC_OCCUPATIONS.find((occupation) => occupation.id === selectedOccupationId) || visibleOccupations[0] || COC_OCCUPATIONS[0];
  }, [visibleOccupations, selectedOccupationId]);

  const activeOccupation = useMemo(() => {
    return COC_OCCUPATIONS.find((occupation) => occupation.name === basicInfo.occupation) || selectedOccupation;
  }, [basicInfo.occupation, selectedOccupation]);

  const occupationSkillRules = useMemo(() => {
    return parseOccupationSkillRules(activeOccupation?.skills || '');
  }, [activeOccupation]);

  const skillSelectOptions = useMemo(() => {
    const skillNames = skills
      .map((skill) => skill.name)
      .filter((name) => name && !name.includes(':') && !isPlaceholderSkill(name));
    return Array.from(new Set([...skillNames, ...socialSkillOptions, ...specialtyCategoryOptions]));
  }, [skills]);

  const selectedChoiceSkillNames = useMemo(() => {
    return Object.values(occupationSkillChoices).flat().filter(Boolean);
  }, [occupationSkillChoices]);

  const occupationalSkillNames = useMemo(() => {
    return Array.from(new Set([...occupationSkillRules.fixedSkills, ...selectedChoiceSkillNames]));
  }, [occupationSkillRules.fixedSkills, selectedChoiceSkillNames]);

  const occupationalSkillNameSet = useMemo(() => new Set(occupationalSkillNames), [occupationalSkillNames]);

  const orderedSkills = useMemo(() => {
    return [...skills].sort((a, b) => {
      const aIsOccupationSkill = occupationalSkillNameSet.has(a.name);
      const bIsOccupationSkill = occupationalSkillNameSet.has(b.name);
      if (aIsOccupationSkill !== bIsOccupationSkill) return aIsOccupationSkill ? -1 : 1;
      return 0;
    });
  }, [skills, occupationalSkillNameSet]);

  useEffect(() => {
    const requiredSkillNames = occupationalSkillNames.filter(Boolean);
    if (requiredSkillNames.length === 0) return;

    setSkills((prevSkills) => {
      const nextSkills = [...prevSkills];
      requiredSkillNames.forEach((skillName) => {
        if (!nextSkills.some((skill) => skill.name === skillName)) {
          nextSkills.push(createSkillFromName(skillName, stats));
        }
      });
      return nextSkills;
    });
  }, [occupationalSkillNames, stats]);

  const addOccupationChoice = (group: OccupationChoiceGroup, value: string) => {
    const normalizedValue = normalizeSkillName(value);
    if (!normalizedValue) return;

    setOccupationSkillChoices((prevChoices) => {
      const currentValues = prevChoices[group.id] || [];
      if (currentValues.includes(normalizedValue) || currentValues.length >= group.count) return prevChoices;
      return { ...prevChoices, [group.id]: [...currentValues, normalizedValue] };
    });
    setChoiceDrafts((prevDrafts) => ({ ...prevDrafts, [group.id]: '' }));
    setChoiceSubtypeDrafts((prevDrafts) => ({ ...prevDrafts, [group.id]: '' }));
    setChoiceCustomSubtypeDrafts((prevDrafts) => ({ ...prevDrafts, [group.id]: '' }));
  };

  const commitOccupationChoice = (group: OccupationChoiceGroup) => {
    const parentSkill = choiceDrafts[group.id] || '';
    if (!parentSkill) return;

    if (!specialtyCategoryOptions.includes(parentSkill)) {
      addOccupationChoice(group, parentSkill);
      return;
    }

    const selectedSubtype = choiceSubtypeDrafts[group.id] || '';
    const subtype = selectedSubtype === customSubtypeValue
      ? (choiceCustomSubtypeDrafts[group.id] || '').trim()
      : selectedSubtype;
    if (!subtype) return;
    addOccupationChoice(group, `${parentSkill}:${subtype}`);
  };

  const removeOccupationChoice = (groupId: string, skillName: string) => {
    setOccupationSkillChoices((prevChoices) => ({
      ...prevChoices,
      [groupId]: (prevChoices[groupId] || []).filter((value) => value !== skillName),
    }));
  };

  // SECTION: 套用职业基础信息
  // NOTE: 写入职业名和信用评级范围，技能页会按职业规则自动生成固定技能与自选槽。
  const applyOccupation = (occupation: CocOccupation) => {
    setBasicInfo({ ...basicInfo, occupation: occupation.name });
    setBgInfo({ ...bgInfo, credit: occupation.creditRange || bgInfo.credit });
    setOccupationSkillChoices({});
    setActiveTab('skills');
  };

  // SECTION: 头像预览上传
  // NOTE: FileReader 转 base64 只供本地预览；后续若持久化应改为对象存储或后端上传。
  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setAvatar(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  // SECTION: 随机生成属性
  // NOTE: STR/CON/DEX/APP/POW/LUC 用 3D6*5，SIZ/INT/EDU 用 (2D6+6)*5。
  const handleRollAll = () => {
    setStats({
      str: (rollD6() + rollD6() + rollD6()) * 5,
      con: (rollD6() + rollD6() + rollD6()) * 5,
      dex: (rollD6() + rollD6() + rollD6()) * 5,
      app: (rollD6() + rollD6() + rollD6()) * 5,
      pow: (rollD6() + rollD6() + rollD6()) * 5,
      siz: (rollD6() + rollD6() + 6) * 5,
      int: (rollD6() + rollD6() + 6) * 5,
      edu: (rollD6() + rollD6() + 6) * 5,
      luc: (rollD6() + rollD6() + rollD6()) * 5,
    });
  };

  // SECTION: 保存角色卡
  // NOTE: 保存前做最小完整性校验；更复杂的房规校验后续可集中到后端。
  const handleSave = async () => {
    if (!basicInfo.name || stats.str === 0) return alert('请至少填写姓名并检定核心属性！');
    if (statMode === 'buy' && remainStatPoints < 0) return alert('基础属性购点已超过房规上限！');
    if (remainJob < 0 || remainInt < 0) return alert('技能点数已透支，请检查加点！');
    if (lockRoomLimits) {
      const overflowSkill = skills.find((skill) => {
        const allocatedPoints = skill.job + skill.interest;
        if (allocatedPoints <= 0) return false;
        const skillLimit = occupationalSkillNameSet.has(skill.name)
          ? roomRules!.occupationSkillLimit
          : roomRules!.interestSkillLimit;
        return skill.base + allocatedPoints > skillLimit;
      });
      if (overflowSkill) {
        const isOccupationSkill = occupationalSkillNameSet.has(overflowSkill.name);
        const skillLimit = isOccupationSkill ? roomRules!.occupationSkillLimit : roomRules!.interestSkillLimit;
        return alert(`${isOccupationSkill ? '职业' : '兴趣'}技能【${overflowSkill.name}】超过房规上限 ${skillLimit}。`);
      }
    }
    const username = localStorage.getItem('trpg_username'); 
    if (!username) return alert('警告：未检测到登录账号信息，请先返回登录页！');

    // NOTE: editData?.id 决定后端是更新旧角色还是创建新角色。
    const skillsWithCalculatedGrowth = skills.map((skill) => ({
      ...skill,
      grow: getSkillGrowth(skill),
    }));
    const finalCharacterData = { 
      id: editData?.id, 
      basicInfo, stats, skills: skillsWithCalculatedGrowth, bgInfo, occupationSkillChoices, statMode, buyLimit
    };

    try {
      const response = await apiFetch('/api/characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardData: finalCharacterData })
      });

      const result = await response.json();

      if (result.success) {
        alert(`调查员 [${basicInfo.name}] 档案已成功刻录进星舰数据库！`);
        navigate(-1);
      } else {
        alert(`保存失败: ${result.message}`);
      }
    } catch (error) {
      console.error('API 请求报错:', error);
      alert('网络连接断开，无法访问星舰服务器！');
    }
  };

  return (
    <div className="create-char-container">
      <div className="char-workspace">
        <div className="char-sidebar flat-box">
          <div className="sidebar-top">
            <h2 className="sidebar-title">
              {editData ? '编辑调查员档案' : '新建调查员档案'}<br/>
              <span className="highlight-text" style={{ fontSize: '1rem' }}>[COC 7th]</span>
            </h2>
            {/* SECTION: 编辑页签 */}
            {/* NOTE: 所有页签共享同一份角色状态，切换不会丢失未保存输入。 */}
            <div className="sidebar-tabs">
              <button className={`tab-btn ${activeTab === 'basic' ? 'active' : ''}`} onClick={() => setActiveTab('basic')}>基本信息</button>
              <button className={`tab-btn ${activeTab === 'skills' ? 'active' : ''}`} onClick={() => setActiveTab('skills')}>职业与技能</button>
              <button className={`tab-btn ${activeTab === 'background' ? 'active' : ''}`} onClick={() => setActiveTab('background')}>背景与资产</button>
              <button className={`tab-btn ${activeTab === 'occupations' ? 'active' : ''}`} onClick={() => setActiveTab('occupations')}>职业列表</button>
            </div>
          </div>
          <div className="sidebar-bottom">
            <button className="flat-btn primary" onClick={handleSave}>💾 录入数据库</button>
            <button className="flat-btn secondary" onClick={() => navigate(-1)}>放弃并返回</button>
          </div>
        </div>
        <div className={`char-main-area flat-box ${activeTab === 'occupations' ? 'occupation-tab-active' : ''} ${activeTab === 'basic' ? 'basic-tab-active' : ''}`}>
          {activeTab === 'basic' && (
            <div className="basic-page">
              {/* SECTION: 基础身份页 */}
              {/* NOTE: 姓名是游戏内唯一展示名，也是 ROLL 指令匹配的目标名。 */}
              <h3 className="section-title">调查员身份录入</h3>
              <div className="basic-identity-layout">
                <div className="avatar-upload-box" onClick={() => fileInputRef.current?.click()}>
                  <input type="file" ref={fileInputRef} hidden accept="image/*" onChange={handleAvatarUpload} />
                  {avatar ? <img src={avatar} alt="Avatar" className="avatar-preview" /> : <div className="upload-placeholder"><span>+</span><p>上传立绘照片</p></div>}
                </div>
                <div className="basic-identity-fields">
                  <div className="form-row">
                    <div className="form-item"><label>姓名</label><input type="text" className="flat-input" value={basicInfo.name} onChange={e=>setBasicInfo({...basicInfo, name: e.target.value})} /></div>
                    <div className="form-item small"><label>年龄</label><input type="number" className="flat-input" value={basicInfo.age} onChange={e=>setBasicInfo({...basicInfo, age: Number(e.target.value)})} /></div>
                    <div className="form-item small"><label>性别</label><input type="text" className="flat-input" value={basicInfo.gender} onChange={e=>setBasicInfo({...basicInfo, gender: e.target.value})} /></div>
                  </div>
                  <div className="form-row">
                    <div className="form-item small"><label>时代</label><input type="text" className="flat-input" value={basicInfo.era} onChange={e=>setBasicInfo({...basicInfo, era: e.target.value})} /></div>
                    <div className="form-item"><label>住地</label><input type="text" className="flat-input" value={basicInfo.residence} onChange={e=>setBasicInfo({...basicInfo, residence: e.target.value})} /></div>
                    <div className="form-item"><label>故乡</label><input type="text" className="flat-input" value={basicInfo.hometown} onChange={e=>setBasicInfo({...basicInfo, hometown: e.target.value})} /></div>
                  </div>
                  <div className="derived-stat-strip">
                    <div><span>移动力</span><strong>{move}</strong></div>
                    <div><span>伤害加值</span><strong>{stats.str===0 ? '-' : db}</strong></div>
                    <div><span>体格</span><strong>{stats.str===0 ? '-' : build}</strong></div>
                    <div><span>理智</span><strong className="highlight-text">{san || '-'}</strong></div>
                  </div>
                </div>
              </div>
              <div className="basic-attributes-section">
                
                <div className="stat-mode-header">
                  <div>
                    <h3 className="section-title">基础属性生成</h3>
                        <div className="mode-toggle">
                        <button 
                            className={`flat-btn small ${statMode === 'roll' ? 'primary' : 'secondary'}`} 
                            onClick={() => setStatMode('roll')}
                        >
                            随机投掷
                        </button>
                        <button 
                            className={`flat-btn small ${statMode === 'buy' ? 'primary' : 'secondary'}`} 
                            onClick={() => setStatMode('buy')}
                        >
                            购点模式
                        </button>
                        </div>
                  </div>
                  <div className="stat-mode-action">
                    {statMode === 'roll' ? (
                      <button className="flat-btn primary small" onClick={handleRollAll}>🎲 随机投掷全属性</button>
                    ) : (
                      <div className="point-buy-control">
                        <label>购点上限（不含 LUC）</label>
                        <input
                          type="number"
                          className="flat-input point-buy-limit-input"
                          value={buyLimit}
                          disabled={lockRoomLimits}
                          title={lockRoomLimits ? '购点上限由房主设定' : '自定义购点上限'}
                          onChange={e => setBuyLimit(Number(e.target.value))}
                        />
                        <span>剩余 <strong className={remainStatPoints < 0 ? 'error-text' : ''}>{remainStatPoints}</strong></span>
                      </div>
                    )}
                  </div>
                </div>
                {/* SECTION: 属性生成说明 */}
                {/* NOTE: 说明文案跟随 statMode 切换，减少用户误解购点和随机的差异。 */}
                <div className="info-box">
                  {statMode === 'roll' 
                    ? "使用 COC 7th 标准规则生成属性：STR、CON、DEX、APP、POW、LUC 使用 3D6×5，其余使用 (2D6+6)×5。"
                    : "按房主规定的总点数分配属性，建议单项保持在 15–90；幸运通常单独投掷，不计入总点数。"}
                </div>
                <div className="stats-grid">
                    {statOrder.map((key) => {
                      const val = stats[key];
                      return (
                        <div key={key} className="stat-box">
                        <div className="stat-label">{key.toUpperCase()} <span>|</span> {statLabels[key]}</div>
                        <div className="stat-display-wrapper">
                            {statMode === 'buy' ? (
                            <input 
                                type="number" 
                                className="stat-input" 
                                value={val || ''} 
                                onChange={e => setStats({...stats, [key]: Number(e.target.value)})} 
                                placeholder="-"
                            />
                            ) : (
                            <div className={val>=75?'high':val>0&&val<=40?'low':'normal'}>{val || '-'}</div>
                            )}
                        </div>
                        {statMode === 'buy' && key === 'luc' && (
                            <button 
                            className="flat-btn secondary small luc-dice-btn" 
                            title="单独投掷幸运"
                            aria-label="单独投掷幸运"
                            onClick={() => setStats({...stats, luc: rollD6() * 5})}
                            >
                            🎲
                            </button>
                        )}
                        <div className="stat-description">{statDescriptions[key]}</div>
                        </div>
                      );
                    })}
                    </div>
                                  
              </div>
            </div>
          )}
          {activeTab === 'skills' && (
            <>
              {/* SECTION: 职业与技能页 */}
              {/* NOTE: 技能页现在由职业表驱动，固定技能和自选槽都会投射到技能表。 */}
              <div className="skill-page-header">
                <h3 className="section-title">职业信息与技能配置</h3>
                <div className="compact-career-control">
                  <div>
                    <strong>{activeOccupation?.name || basicInfo.occupation || '未选择职业'}</strong>
                    <small>{activeOccupation?.pointFormula || '教育×4'} · 信用 {activeOccupation?.creditRange || '自定'}</small>
                  </div>
                  <button className="flat-btn secondary small" onClick={() => setActiveTab('occupations')}>更换职业</button>
                </div>
              </div>

              <div className="choice-panel">
                <div className="rule-box-title">职业自选与特长</div>
                <div className="choice-groups-grid">
                  {occupationSkillRules.choices.length === 0 && (
                    <div className="choice-empty">当前职业没有额外自选槽。</div>
                  )}
                  {occupationSkillRules.choices.map((group) => {
                    const currentChoices = occupationSkillChoices[group.id] || [];
                    const availableOptions = group.options.length > 0 ? group.options : skillSelectOptions;
                    const isFull = currentChoices.length >= group.count;
                    const selectedParent = choiceDrafts[group.id] || '';
                    const selectedSubtype = choiceSubtypeDrafts[group.id] || '';
                    const isSpecialty = specialtyCategoryOptions.includes(selectedParent);
                    const isCustomSubtype = selectedSubtype === customSubtypeValue;
                    const subtypeOptions = isSpecialty
                      ? [...(specialtySubtypeOptions[selectedParent] || []), customSubtypeValue]
                      : [];
                    const canAdd = Boolean(selectedParent)
                      && (!isSpecialty || Boolean(selectedSubtype))
                      && (!isCustomSubtype || Boolean((choiceCustomSubtypeDrafts[group.id] || '').trim()));

                    return (
                      <div key={group.id} className="choice-group">
                        <div className="choice-group-header">
                          <strong>{group.label}</strong>
                          <span>{currentChoices.length} / {group.count}</span>
                        </div>
                        <div className={`choice-row ${!isSpecialty ? 'single-menu' : ''}`}>
                          <StyledSelect
                            disabled={isFull}
                            value={selectedParent}
                            placeholder={group.placeholder}
                            options={availableOptions.map((option) => ({ value: option, label: option }))}
                            onChange={(value) => {
                              setChoiceDrafts({ ...choiceDrafts, [group.id]: value });
                              setChoiceSubtypeDrafts({ ...choiceSubtypeDrafts, [group.id]: '' });
                              setChoiceCustomSubtypeDrafts({ ...choiceCustomSubtypeDrafts, [group.id]: '' });
                            }}
                          />
                          {isSpecialty && (
                            <div className="choice-subtype-slot">
                              {isCustomSubtype ? (
                                <>
                                  <input
                                    type="text"
                                    className="flat-input choice-custom-input"
                                    autoFocus
                                    value={choiceCustomSubtypeDrafts[group.id] || ''}
                                    placeholder={`输入${selectedParent}子技能`}
                                    onChange={(event) => setChoiceCustomSubtypeDrafts({
                                      ...choiceCustomSubtypeDrafts,
                                      [group.id]: event.target.value,
                                    })}
                                  />
                                  <button
                                    type="button"
                                    className="choice-custom-cancel"
                                    title="返回预设子技能"
                                    onClick={() => {
                                      setChoiceSubtypeDrafts({ ...choiceSubtypeDrafts, [group.id]: '' });
                                      setChoiceCustomSubtypeDrafts({ ...choiceCustomSubtypeDrafts, [group.id]: '' });
                                    }}
                                  >
                                    ×
                                  </button>
                                </>
                              ) : (
                                <StyledSelect
                                  disabled={isFull}
                                  value={selectedSubtype}
                                  placeholder="选择子技能"
                                  options={subtypeOptions.map((option) => ({
                                    value: option,
                                    label: option === customSubtypeValue ? '自定义...' : option,
                                  }))}
                                  onChange={(value) => {
                                    setChoiceSubtypeDrafts({ ...choiceSubtypeDrafts, [group.id]: value });
                                    setChoiceCustomSubtypeDrafts({ ...choiceCustomSubtypeDrafts, [group.id]: '' });
                                  }}
                                />
                              )}
                            </div>
                          )}
                          <button
                            className="flat-btn secondary btn-short"
                            disabled={isFull || !canAdd}
                            onClick={() => commitOccupationChoice(group)}
                          >
                            添加
                          </button>
                        </div>
                        <div className="choice-tags">
                          {currentChoices.map((skillName) => (
                            <button
                              type="button"
                              key={skillName}
                              className="skill-tag chosen"
                              onClick={() => removeOccupationChoice(group.id, skillName)}
                            >
                              {skillName} ×
                            </button>
                          ))}
                          {currentChoices.length === 0 && <span className="skill-tag muted">尚未选择</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="skill-list-section">
                <div className="skill-list-toolbar">
                  <div className="compact-budget-group" aria-label="技能点数概览">
                    <div className={`compact-budget ${remainJob < 0 ? 'danger' : ''}`}>
                      <span>本职</span><strong>{remainJob}</strong><small>/ {totalJobPoints}</small>
                    </div>
                    <div className={`compact-budget ${remainInt < 0 ? 'danger' : ''}`}>
                      <span>兴趣</span><strong>{remainInt}</strong><small>/ {totalIntPoints}</small>
                    </div>
                    <div className="compact-budget">
                      <span>本职技能</span><strong>{occupationalSkillNames.length}</strong><small>项</small>
                    </div>
                  </div>
                  <div className="skill-toolbar-actions">
                    <button className="flat-btn secondary small" onClick={addCustomSkill}>+ 添加自定义技能</button>
                    <button className="flat-btn secondary small" onClick={clearAllSkillPoints}>清空所有加点</button>
                  </div>
                </div>

                {/* SECTION: 紧凑技能网格 */}
                {/* NOTE: 全量技能采用多列卡片，职业技能仍优先排列并开放职业投入。 */}
                <div className="skill-table-container">
                  <div className="skill-grid-legend">
                    <span>技能 / 类型</span>
                    <span>初始</span><span>职业</span><span>兴趣</span><span>成长</span><span>总值</span>
                  </div>
                  <div className="skill-card-grid">
                    {orderedSkills.map(skill => {
                      const growthPoints = getSkillGrowth(skill);
                      const total = skill.base + skill.job + skill.interest + growthPoints;
                      const isFixedOccupationSkill = occupationSkillRules.fixedSkills.includes(skill.name);
                      const isChosenOccupationSkill = selectedChoiceSkillNames.includes(skill.name);
                      const isOccupationSkill = occupationalSkillNameSet.has(skill.name);
                      const skillLimit = isOccupationSkill
                        ? roomRules?.occupationSkillLimit
                        : roomRules?.interestSkillLimit;
                      const maxJobPoints = lockRoomLimits
                        ? Math.max(0, skillLimit! - skill.base - skill.interest)
                        : undefined;
                      const maxInterestPoints = lockRoomLimits
                        ? Math.max(0, skillLimit! - skill.base - skill.job)
                        : undefined;
                      // NOTE: 职业动态生成的技能即使使用 custom_ ID，也必须由职业规则管理，不能在技能卡上改名或删除。
                      const isCustom = skill.id.startsWith('custom_') && !isOccupationSkill;
                      const shouldLockJobInput = !isOccupationSkill && (skill.job || 0) === 0;
                      return (
                        <article key={skill.id} className={`compact-skill-card ${isOccupationSkill ? 'occupation-skill-row' : ''}`}>
                          <div className="compact-skill-heading">
                            {isCustom ? (
                              <input type="text" className="flat-input skill-input text" placeholder="输入技能名" value={skill.name} onChange={e => updateSkill(skill.id, 'name', e.target.value)} />
                            ) : (
                              <span className="skill-name-main">{skill.name}</span>
                            )}
                            <div className="compact-skill-actions">
                            {isFixedOccupationSkill && <span className="skill-row-badge fixed">固定</span>}
                            {isChosenOccupationSkill && <span className="skill-row-badge chosen">自选</span>}
                            {!isOccupationSkill && <span className="skill-row-badge muted">普通</span>}
                            {isCustom && <button className="skill-remove-btn" title="删除自定义技能" onClick={() => removeSkill(skill.id)}>×</button>}
                            </div>
                          </div>
                          <div className="compact-skill-values">
                          <label><span>初始</span>
                            {isCustom ? (
                              <input type="number" className="flat-input skill-input" value={skill.base} onChange={e => updateSkill(skill.id, 'base', e.target.value)} />
                            ) : <strong>{skill.base}</strong>}
                          </label>
                          <label><span>职业</span><input type="number" className="flat-input skill-input" disabled={shouldLockJobInput} max={maxJobPoints} value={skill.job || ''} onChange={e => updateSkill(skill.id, 'job', e.target.value)} placeholder="0" /></label>
                          <label><span>兴趣</span><input type="number" className="flat-input skill-input" max={maxInterestPoints} value={skill.interest || ''} onChange={e => updateSkill(skill.id, 'interest', e.target.value)} placeholder="0" /></label>
                          <label><span>成长</span><strong>{growthPoints}</strong></label>
                          <label className="skill-total"><span>总值</span><strong>{total}</strong></label>
                          </div>
                        </article>
                      );
                    })}
                  </div>
              </div>      
              </div>
            </>
          )}
          {activeTab === 'background' && (
            <div style={{ display: 'flex', gap: '30px' }}>
              {/* SECTION: 背景故事页 */}
              {/* NOTE: 背景字段为玩家手写文本，不参与当前 AI 自动检定。 */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '15px' }}>
                <h3 className="section-title">故事背景</h3>
                <div className="form-item"><label>个人描述</label><textarea className="flat-input" value={bgInfo.description} onChange={e=>setBgInfo({...bgInfo, description: e.target.value})}></textarea></div>
                <div className="form-item"><label>思想与信念</label><textarea className="flat-input" value={bgInfo.belief} onChange={e=>setBgInfo({...bgInfo, belief: e.target.value})}></textarea></div>
                <div className="form-item"><label>重要之人</label><textarea className="flat-input" value={bgInfo.importantPerson} onChange={e=>setBgInfo({...bgInfo, importantPerson: e.target.value})}></textarea></div>
                <div className="form-item"><label>恐惧症与狂躁症</label><textarea className="flat-input" value={bgInfo.phobias} onChange={e=>setBgInfo({...bgInfo, phobias: e.target.value})}></textarea></div>
              </div>

              {/* SECTION: 资产与经历页 */}
              {/* NOTE: 信用评级字段可与技能表中的 Credit Rating 分开记录具体资产说明。 */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '15px' }}>
                <h3 className="section-title">资产与经历</h3>
                <div className="form-row" style={{ marginTop: 0 }}>
                  <div className="form-item"><label>信用评级</label><input type="text" className="flat-input" value={bgInfo.credit} onChange={e=>setBgInfo({...bgInfo, credit: e.target.value})} placeholder="例如：45" /></div>
                  <div className="form-item"><label>现金与资产</label><input type="text" className="flat-input" value={bgInfo.wealth} onChange={e=>setBgInfo({...bgInfo, wealth: e.target.value})} placeholder="例如：$500" /></div>
                </div>
                <div className="form-item"><label>调查员经历与模组记录</label><textarea className="flat-input" style={{ minHeight: '180px' }} value={bgInfo.history} onChange={e=>setBgInfo({...bgInfo, history: e.target.value})} placeholder="例如：经历模组【桃花岛】，-5 SAN，+3 侦查..."></textarea></div>
              </div>
            </div>
          )}
          {activeTab === 'occupations' && selectedOccupation && (
            <>
              {/* SECTION: 职业列表页 */}
              {/* NOTE: 职业表先作为规范资料库接入，后续再逐步联动技能自动分配。 */}
              <div className="occupation-header">
                <div>
                  <h3 className="section-title">职业列表</h3>
                  <p className="occupation-hint">从半自动卡的职业表整理而来。支持模糊检索，单击右侧条目数按钮切换排序方式</p>
                </div>
                <button
                  type="button"
                  className={`occupation-count ${occupationSortMode === 'points' ? 'points-mode' : 'id-mode'}`}
                  onClick={() => setOccupationSortMode(occupationSortMode === 'id' ? 'points' : 'id')}
                  aria-label={occupationSortMode === 'id' ? '当前按序号排序，点击切换为按职业点数排序' : '当前按职业点数排序，点击切换为按序号排序'}
                  title={occupationSortMode === 'id' ? '按序号排序' : '按职业点数排序'}
                >
                  <span>{filteredOccupations.length}</span>
                  <small>/ {COC_OCCUPATIONS.length} 项</small>
                </button>
              </div>

              <div className="occupation-search-row">
                <input
                  type="text"
                  className="flat-input occupation-search"
                  placeholder="搜索职业、技能、点数公式或关键词..."
                  value={occupationSearch}
                  onChange={(event) => setOccupationSearch(event.target.value)}
                />
                <button className="flat-btn secondary btn-short" onClick={() => setOccupationSearch('')}>清空</button>
              </div>

              <div className="occupation-workspace">
                <div className="occupation-list" aria-label="职业列表">
                  {visibleOccupations.map((occupation) => (
                    <button
                      type="button"
                      key={occupation.id}
                      className={`occupation-list-item ${occupation.id === selectedOccupation.id ? 'active' : ''}`}
                      onClick={() => setSelectedOccupationId(occupation.id)}
                    >
                      <span className="occupation-list-id">#{occupation.id}</span>
                      <span className="occupation-list-main">
                        <strong>{occupation.name}</strong>
                        <small>职业点数 {calculateOccupationPoints(occupation.pointFormula, stats)}</small>
                      </span>
                    </button>
                  ))}
                  {visibleOccupations.length === 0 && (
                    <div className="occupation-empty">没有找到匹配的职业。</div>
                  )}
                </div>

                <div className="occupation-detail">
                  <div className="occupation-detail-title">
                    <div>
                      <span className="occupation-id">职业 #{selectedOccupation.id}</span>
                      <h4>{selectedOccupation.name}</h4>
                    </div>
                    <button className="flat-btn primary btn-short" onClick={() => applyOccupation(selectedOccupation)}>套用职业</button>
                  </div>

                  <div className="occupation-meta-grid">
                    <div className="occupation-meta-card">
                      <span>信用评级</span>
                      <strong>{selectedOccupation.creditRange || '自定义'}</strong>
                    </div>
                    <div className="occupation-meta-card">
                      <span>职业点数</span>
                      <strong>{selectedOccupation.pointFormula || '自定义'}</strong>
                    </div>
                  </div>

                  <div className="occupation-section">
                    <h5>本职技能</h5>
                    <p>{selectedOccupation.skills || '未提供固定本职技能，请与守秘人确认。'}</p>
                  </div>

                  <div className="occupation-section">
                    <h5>推荐关系人</h5>
                    <p>{selectedOccupation.contacts || '暂无推荐关系人。'}</p>
                  </div>

                  <div className="occupation-section">
                    <h5>职业介绍</h5>
                    <p className="occupation-description">{selectedOccupation.description || '暂无职业介绍。'}</p>
                  </div>
                </div>
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  );
}
