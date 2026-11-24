const { OpenAI } = require('openai');
const config = require('../config');
const { cleanKpNarration } = require('../domain/narration');
const SYSTEM_PROMPT = require('../ai/systemPrompt');

const openai = new OpenAI({
  apiKey: config.openai.apiKey,
  baseURL: config.openai.baseURL,
  timeout: config.openai.timeout,
});

// SECTION: AI 上下文构造
// NOTE: 只取最近 15 条，控制 token 成本；长期记忆由导演上下文单独召回。
const buildHistoryContext = (lines) => {
  return lines
    .filter((line) => line.type === 'dm_reply' || line.type === 'player_action')
    .slice(-15)
    .map((line) => ({
    // NOTE: dm_reply 作为 assistant，玩家行动作为 user，贴近 Chat Completions 角色语义。
    role: line.type === 'dm_reply' ? 'assistant' : 'user',
    content: line.type === 'dm_reply' ? cleanKpNarration(line.content) : `[${line.playerName}的行动]: ${line.content}`,
    }));
};

const parseDirectorResponse = (content) => {
  const text = String(content || '').trim();
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    const objectText = text.slice(start, end + 1);
    // Some compatible providers emit literal line breaks inside quoted JSON strings.
    // Escape control characters only inside complete strings, preserving all other syntax.
    const escaped = objectText.replace(/"(?:[^"\\]|\\[\s\S])*"/g,
      str => str.replace(/[\u0000-\u001f]/g, ch => JSON.stringify(ch).slice(1, -1)));
    try {
      const parsed = JSON.parse(escaped);
      if (typeof parsed.narration === 'string' && parsed.narration.trim()) return parsed;
    } catch {
      // Structured responses that remain invalid are retryable, never shown as KP prose.
    }
  }
  if (/^\s*(?:```|[\[{])/.test(text) || /"narration"\s*:/.test(text)) {
    throw new Error('主持返回的导演数据不完整。');
  }
  return {
    narration: text || '空气短暂地安静下来，局势没有发生新的变化。',
    requestedRolls: [],
    statChanges: [],
    revealedClueIds: [],
    proposedStateChanges: {},
    proposedTransition: null,
    pacing: 'hold',
  };
};

// SECTION: 剧本导演回复生成
// NOTE: directorContext 含服务端权威场景和状态；模型只能提出变化，不能直接提交。
const generateDirectorReply = async ({ lines, directorContext, provider }) => {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'system', content: `当前权威导演上下文：\n${JSON.stringify(directorContext)}` },
    ...buildHistoryContext(lines),
  ];
  const rawContent = provider
    ? await require('./customProvider').complete(provider, messages, config.openai.customTimeout)
    : (await openai.chat.completions.create({ model: config.openai.model, messages, temperature: 0.5 })).choices[0].message.content;
  if (typeof rawContent !== 'string' || !rawContent.trim()) throw new Error('主持返回空回复。');
  if (config.openai.debugRaw) {
    console.log(`\n🤖 [AI 原始导演回复]\n${String(rawContent || '')}\n`);
  }
  const result = parseDirectorResponse(rawContent);
  if (typeof result?.narration === 'string') result.narration = cleanKpNarration(result.narration);
  return result;
};

module.exports = {
  buildHistoryContext,
  generateDirectorReply,
  parseDirectorResponse,
};
