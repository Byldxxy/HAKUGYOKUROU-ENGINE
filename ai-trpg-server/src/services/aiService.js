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
  return lines.slice(-15).map((line) => ({
    // NOTE: dm_reply 作为 assistant，玩家行动作为 user，贴近 Chat Completions 角色语义。
    role: line.type === 'dm_reply' ? 'assistant' : 'user',
    content: line.type === 'dm_reply' ? line.content : `[${line.playerName}的行动]: ${line.content}`,
  }));
};

// SECTION: DM 回复生成
// NOTE: 模型名、baseURL、timeout 都来自 .env，前端大厅不再暴露模型选择。
const generateDmReply = async (lines) => {
  const completion = await openai.chat.completions.create({
    model: config.openai.model,
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...buildHistoryContext(lines)],
    temperature: 0.7,
  });

  // NOTE: 当前只取第一候选；如果未来开放多候选，应在这里扩展返回结构。
  return completion.choices[0].message.content;
};

module.exports = {
  generateDmReply,
};
