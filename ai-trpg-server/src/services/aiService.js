const { OpenAI } = require('openai');
const config = require('../config');
const SYSTEM_PROMPT = require('../ai/systemPrompt');

const openai = new OpenAI({
  apiKey: config.openai.apiKey,
  baseURL: config.openai.baseURL,
  timeout: config.openai.timeout,
});

const buildHistoryContext = (lines) => {
  return lines.slice(-15).map((line) => ({
    role: line.type === 'dm_reply' ? 'assistant' : 'user',
    content: line.type === 'dm_reply' ? line.content : `[${line.playerName}的行动]: ${line.content}`,
  }));
};

const generateDmReply = async (lines) => {
  const completion = await openai.chat.completions.create({
    model: config.openai.model,
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...buildHistoryContext(lines)],
    temperature: 0.7,
  });

  return completion.choices[0].message.content;
};

module.exports = {
  generateDmReply,
};
