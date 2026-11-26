const { OpenAI } = require('openai');
const config = require('../config');
const { cleanKpNarration } = require('../domain/narration');
const { buildHistoryContext, buildDirectorMessages, estimatedTokens } = require('../ai/directorMessages');
const { createQueue, publicError } = require('./providerQueue');
const { observe } = require('./performanceMetrics');

const openai = new OpenAI({
  apiKey: config.openai.apiKey,
  baseURL: config.openai.baseURL,
  timeout: config.openai.timeout,
  maxRetries: 0,
});

const settings = config.openai;
const lanes = {
  site: createQueue(settings.siteConcurrency, settings.queueSize),
  custom: createQueue(settings.customConcurrency, settings.queueSize),
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
  const channel = provider ? 'custom' : 'site';
  const lane = lanes[channel];
  const timeout = provider ? settings.customTimeout : settings.timeout;
  const signal = AbortSignal.timeout(timeout);
  const start = performance.now();
  let acquired = false;
  let acquiredAt;
  let upstreamStart;
  let outcome = 'success';
  try {
    await lane.acquire(signal);
    acquired = true;
    acquiredAt = performance.now();
    const messages = buildDirectorMessages(lines, directorContext, settings.inputBudget);
    const model = provider ? provider.model : settings.model;
    const reasoning = /^(?:gpt-5|o[134](?:$|-))/i.test(model.split('/').at(-1));
    const body = { model, messages, ...(reasoning ? { max_completion_tokens: settings.outputBudget }
      : { max_tokens: settings.outputBudget, temperature: 0.5 }) };
    observe('input_token_estimate', estimatedTokens(messages), { channel });
    upstreamStart = performance.now();
    let content, usage, finishReason;
    if (provider) {
      ({ content, usage, finishReason } = await require('./customProvider').complete(provider, body, signal));
    } else {
      const result = await openai.chat.completions.create(body, { signal });
      content = result.choices?.[0]?.message?.content;
      finishReason = result.choices?.[0]?.finish_reason;
      usage = result.usage;
    }
    observe('input_tokens', usage?.prompt_tokens, { channel });
    observe('output_tokens', usage?.completion_tokens, { channel });
    if (finishReason === 'length') throw publicError('主持回复达到模型输出上限，玩家行动已保留。请调高输出预算或更换模型后重试。', 'output_limit');
    if (typeof content !== 'string' || !content.trim()) throw publicError('主持返回空回复，请重试。', 'empty_response');
    if (settings.debugRaw) console.log('🤖 [AI 原始导演回复]\n' + content);
    const result = parseDirectorResponse(content);
    result.narration = cleanKpNarration(result.narration);
    return result;
  } catch (error) {
    if (signal.aborted || error.name === 'APIConnectionTimeoutError') {
      outcome = acquired ? 'upstream_timeout' : 'queue_timeout';
      throw publicError(acquired ? '主持接口响应超时，请稍后重试。' : '主持接口排队超时，请稍后重试。', outcome);
    }
    outcome = error.publicMessage ? error.code : Number.isInteger(error.status) ? 'http_' + error.status : 'failed';
    if (error.status === 429) throw publicError('站点主持接口已限流，请稍后重试。', outcome);
    if (error.status >= 500 && error.status <= 599) {
      throw publicError(`站点主持供应商暂时无法完成请求（HTTP ${error.status}），行动已保留，可稍后重试。`, outcome);
    }
    if (error.publicMessage) throw error;
    // Third-party error bodies may echo prompts, authorization fields or URLs.
    throw publicError('主持调用失败，请检查配置后重试。', outcome);
  } finally {
    const end = performance.now();
    observe('dm_queue_ms', (acquired ? acquiredAt : end) - start, { channel, outcome });
    if (upstreamStart !== undefined) observe('dm_upstream_ms', end - upstreamStart, { channel, outcome });
    if (acquired) lane.release();
  }
};

module.exports = {
  buildHistoryContext,
  generateDirectorReply,
  parseDirectorResponse,
};
