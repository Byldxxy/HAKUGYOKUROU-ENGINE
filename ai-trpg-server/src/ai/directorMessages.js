const SYSTEM_PROMPT = require('./systemPrompt');
const { cleanKpNarration } = require('../domain/narration');
const { publicError } = require('../services/providerQueue');

function historyMessage(line) {
  return line.type === 'dm_reply'
    ? { role: 'assistant', content: cleanKpNarration(line.content) }
    : { role: 'user', content: `[${line.playerName}的行动]: ${line.content}` };
}

function buildHistoryContext(lines) {
  const history = lines.filter(line => line.type === 'dm_reply' || line.type === 'player_action');
  const lastReply = history.findLastIndex(line => line.type === 'dm_reply');
  // Keep the preceding check and all responses from the current round, even in a large party.
  return history.slice(Math.min(Math.max(0, lastReply), Math.max(0, history.length - 15))).map(historyMessage);
}

const messageCost = message => Buffer.byteLength(message.content) + 12;
const estimatedTokens = messages => 8 + messages.reduce((cost, message) => cost + messageCost(message), 0);
const systemMessages = context => [
  { role: 'system', content: SYSTEM_PROMPT },
  { role: 'system', content: '当前权威导演上下文：\n' + JSON.stringify(context) },
];

// A long party turn can exceed the budget on its own. Give each action room
// for both its opening and its conclusion, and keep authoritative dice intact.
function fitCurrentTurn(messages, available) {
  const shorten = (message, limit) => {
    const { role, content } = message;
    const prefix = role === 'user' ? content.match(/^\[[^\n]*?的行动\]: /)?.[0] || '' : '';
    const body = content.slice(prefix.length);
    if (role === 'user' && /D100 =|本次检定取消/.test(body)) return message;
    const rules = role === 'assistant' ? body.match(/<<(?:ROLL|STAT):[^>]*>>/g) || [] : [];
    const prose = Array.from(rules.length ? body.replace(/<<(?:ROLL|STAT):[^>]*>>/g, '').trim() : body);
    if (prose.length <= limit) return message;
    const head = Math.ceil(limit / 2), tail = Math.floor(limit / 2);
    const excerpt = prose.slice(0, head).join('') + '〔长文节选，中段已省略〕' +
      (tail ? prose.slice(-tail).join('') : '');
    return { role, content: prefix + excerpt + (rules.length ? '\n' + rules.join('\n') : '') };
  };
  let low = 0, high = messages.reduce((longest, m) => Math.max(longest, m.content.length), 0);
  let best;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const trial = messages.map(message => shorten(message, middle));
    if (trial.reduce((sum, message) => sum + messageCost(message), 0) <= available) {
      best = trial;
      low = middle + 1;
    } else high = middle - 1;
  }
  return best;
}

// A compatible provider can use an unknown tokenizer. One unit per UTF-8 byte,
// plus message framing, deliberately budgets conservatively for byte-level tokenizers.
function buildDirectorMessages(lines, context, budget) {
  const history = buildHistoryContext(lines);
  const full = [...systemMessages(context), ...history];
  if (estimatedTokens(full) <= budget) return full;

  const lastReply = Math.max(0, history.findLastIndex(message => message.role === 'assistant'));
  let current = history.slice(lastReply);
  const cues = current.map(message => message.content).join('\n') + JSON.stringify(context.currentScene || {});
  const matches = item => [item.id, item.name || item.label].some(text => text && cues.includes(text));
  const allItems = context.itemDirectory || [];
  const requiredItems = allItems.filter(matches);
  const previous = [];
  const compact = { ...context, itemDirectory: requiredItems, recalledMemory: [], revealedClues: [] };
  const requiredIds = new Set(requiredItems.map(item => item.id));
  const memory = context.recalledMemory || [];
  const requiredMemory = memory.filter(entry => matches(entry) || requiredIds.has(entry.id));
  compact.recalledMemory.push(...requiredMemory);
  let available = budget - estimatedTokens(systemMessages(compact));
  const currentCost = () => current.reduce((sum, message) => sum + messageCost(message), 0);
  if (currentCost() > available) {
    // Keep current ownership and witness knowledge in the model projection while
    // dropping duplicated historical evidence and lists already indexed above.
    compact.recalledMemory = requiredMemory.map(({ id, label, kind, state, observers = [] }) =>
      ({ id, label, kind, state, observers: observers.map(({ who, state: known }) => ({ who, state: known })) }));
    if (compact.campaignState) {
      const { inventory, revealedClueIds, transitionHistory, ...state } = compact.campaignState;
      compact.campaignState = state;
    }
    available = budget - estimatedTokens(systemMessages(compact));
    if (currentCost() > available) {
      current = fitCurrentTurn(current, available);
      if (!current) throw publicError('当前剧本与检定资料超过输入预算，请联系站点管理员调高 AI_INPUT_TOKEN_BUDGET 后重试。', 'context_limit');
    }
  }
  let remaining = available - currentCost();
  function appendWhenFits(list, values) {
    for (const value of values) {
      const cost = 1 + Buffer.byteLength(JSON.stringify(value));
      if (cost > remaining) continue;
      list.push(value);
      remaining -= cost;
    }
  }
  const requiredMemoryIds = new Set(requiredMemory.map(entry => entry.id));
  appendWhenFits(compact.recalledMemory, memory.filter(entry => !requiredMemoryIds.has(entry.id)));
  for (let i = lastReply - 1; i >= 0; i--) {
    const cost = messageCost(history[i]);
    if (cost > remaining) break;
    remaining -= cost;
    previous.unshift(history[i]);
  }
  appendWhenFits(compact.revealedClues, (context.revealedClues || []).slice().reverse());
  appendWhenFits(compact.itemDirectory, allItems.filter(item => !requiredIds.has(item.id)));
  return [...systemMessages(compact), ...previous, ...current];
}

module.exports = { buildHistoryContext, buildDirectorMessages, estimatedTokens };
