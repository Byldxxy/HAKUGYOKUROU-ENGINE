const { OpenAI } = require('openai');
const config = require('../config');
const SYSTEM_PROMPT = require('../ai/systemPrompt');

const openai = new OpenAI({
  apiKey: config.openai.apiKey,
  baseURL: config.openai.baseURL,
  timeout: config.openai.timeout,
});

// SECTION: AI 上下文构造
// NOTE: 只取最近 15 条，控制 token 成本；长期记忆目前通过存档/日志文件保留。
const buildHistoryContext = (lines) => {
  return lines
    .filter((line) => line.type === 'dm_reply' || line.type === 'player_action')
    .slice(-15)
    .map((line) => ({
    // NOTE: dm_reply 作为 assistant，玩家行动作为 user，贴近 Chat Completions 角色语义。
    role: line.type === 'dm_reply' ? 'assistant' : 'user',
    content: line.type === 'dm_reply' ? line.content : `[${line.playerName}的行动]: ${line.content}`,
    }));
};

const parseDirectorResponse = (content) => {
  const text = String(content || '').trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        // NOTE: 供应商未遵循 JSON 要求时降级为纯叙述，禁止产生任何状态副作用。
      }
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
  }
};

// SECTION: 剧本导演回复生成
// NOTE: directorContext 含服务端权威场景和状态；模型只能提出变化，不能直接提交。
const generateDirectorReply = async ({ lines, directorContext }) => {
  const completion = await openai.chat.completions.create({
    model: config.openai.model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'system', content: `当前权威导演上下文：\n${JSON.stringify(directorContext)}` },
      ...buildHistoryContext(lines),
    ],
    temperature: 0.5,
  });

  const rawContent = completion.choices[0].message.content;
  if (config.openai.debugRaw) {
    console.log(`\n🤖 [AI 原始导演回复]\n${String(rawContent || '')}\n`);
  }
  return parseDirectorResponse(rawContent);
};

module.exports = {
  buildHistoryContext,
  generateDirectorReply,
  parseDirectorResponse,
};
