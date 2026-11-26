// Exercise queueing, deadlines, usage accounting and context packing without a model bill.
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { createQueue } = require('../src/services/providerQueue');
const { buildDirectorMessages, estimatedTokens } = require('../src/ai/directorMessages');

async function testBudget() {
  const current = '我把钥匙交给乙。';
  const context = { currentScene: { id: 'opening' }, chapter: { id: 'demo' },
    itemDirectory: [{ id: 'key', name: '钥匙', holder: 'pc:a' }], revealedClues: [],
    recalledMemory: [{ id: 'key', label: '钥匙', state: { holder: 'pc:a' } }] };
  const lines = [{ type: 'dm_reply', content: '<<ROLL:侦查:甲>>' },
    ...Array.from({ length: 17 }, (_, i) => ({ type: 'player_action', playerName: '调查员' + i, content: current }))];
  const messages = buildDirectorMessages(lines, context, 32000);
  const budget = estimatedTokens(messages) + 80;
  const oversized = { ...context, itemDirectory: [...context.itemDirectory,
    { id: 'unrelated', name: '遥远的纪念品', location: '远'.repeat(9000) }] };
  const packed = buildDirectorMessages(lines, oversized, budget);
  assert.ok(estimatedTokens(packed) <= budget);
  assert.deepEqual(packed.slice(2), messages.slice(2));
  assert.equal(packed.length, 20);
  assert.deepEqual(JSON.parse(packed[1].content.split('\n').slice(1).join('\n')).recalledMemory, context.recalledMemory);
  assert.throws(() => buildDirectorMessages(lines, context, 100), { code: 'context_limit' });
  const longParty = [
    {type:'dm_reply',content:'先前的叙事。'.repeat(1400)+'<<ROLL:侦查:甲>>'},
    {type:'player_action',playerName:'甲',content:'先看桌面。'+'中'.repeat(3900)+'最后把钥匙交给乙。'},
    {type:'player_action',playerName:'乙',content:'先看窗台。'+'雨'.repeat(3900)+'最后把铁盒交给甲。'},
    {type:'player_action',playerName:'甲',content:'[对 侦查 进行检定] D100 = 41 成功'},
  ];
  const clipped = buildDirectorMessages(longParty, context, 16000);
  assert.ok(estimatedTokens(clipped) <= 16000);
  assert.match(clipped[2].content,/<<ROLL:侦查:甲>>/);
  assert.match(clipped[3].content,/先看桌面。.*长文节选.*最后把钥匙交给乙。/);
  assert.match(clipped[4].content,/先看窗台。.*长文节选.*最后把铁盒交给甲。/);
  assert.equal(clipped[5].content, '[甲的行动]: '+longParty[3].content);
}

async function test() {
  await testBudget();
  const q = createQueue(1, 1);
  const cancel = new AbortController();
  await q.acquire(cancel.signal);
  const waiting = q.acquire(cancel.signal);
  await assert.rejects(q.acquire(cancel.signal), { code: 'queue_full' });
  cancel.abort();
  await assert.rejects(waiting, { name: 'AbortError' });
  q.release();

  let entered, release, mode = 'hold', calls = 0;
  const server = http.createServer(async (req, res) => {
    calls++;
    let data = '';
    for await (const chunk of req) data += chunk;
    assert.equal(JSON.parse(data).max_tokens, 4096);
    res.setHeader('Content-Type', 'application/json');
    if (mode === 'limit') {
      res.writeHead(429);
      return res.end(JSON.stringify({ error: { message: 'opaque' } }));
    }
    if (mode === 'slow') return;
    if (mode === 'cut') return res.end(JSON.stringify({ choices: [{finish_reason:'length',message:{content:'一段尚未完成的回答'}}] }));
    if (mode === 'hold') {
      entered();
      await new Promise(resolve => { release = resolve; });
    }
    res.end(JSON.stringify({ choices: [{ message: { content: '{"narration":"测试。"}' } }],
      usage: { prompt_tokens: 19, completion_tokens: 6 } }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    Object.assign(process.env, { API_KEY: 'offline', BASE_URL: 'http://127.0.0.1:' + server.address().port,
      MODEL_NAME: 'fixture', AI_SITE_CONCURRENCY: '1', AI_QUEUE_SIZE: '1', AI_TIMEOUT_MS: '1200',
      AI_DEBUG_RAW: 'false', AI_INPUT_TOKEN_BUDGET: '32768', AI_OUTPUT_TOKEN_BUDGET: '4096' });
    const ai = require('../src/services/aiService');
    const request = provider => ai.generateDirectorReply({ lines: [], directorContext: {}, provider });
    const started = new Promise(resolve => { entered = resolve; });
    const first = request();
    await started;
    const second = request();
    await assert.rejects(request(), { code: 'queue_full' });
    const custom = require('../src/services/customProvider');
    const original = custom.complete;
    try {
      custom.complete = async (_, body) => {
        assert.equal(body.model, 'openai/gpt-5-test');
        assert.equal(body.max_completion_tokens,4096);
        return { content: '{"narration":"独立队列。"}' };
      };
      assert.equal((await request({ model: 'openai/gpt-5-test' })).narration, '独立队列。');
    } finally { custom.complete = original; }
    mode = 'ok';
    release();
    await Promise.all([first, second]);
    mode = 'limit';
    await assert.rejects(request(), { code: 'http_429' });
    mode = 'cut';
    await assert.rejects(request(), { code: 'output_limit' });
    mode = 'slow';
    await assert.rejects(request(), { code: 'upstream_timeout' });
    mode = 'ok';
    await request();
    assert.equal(calls, 6);
    const rows = require('../src/services/performanceMetrics').flush();
    assert.equal(rows.find(row => row.name === 'input_tokens').sum, 57);
    assert.ok(rows.some(row => row.name === 'dm_queue_ms' && row.outcome === 'queue_full'));
    assert.ok(rows.some(row => row.name === 'dm_upstream_ms' && row.outcome === 'upstream_timeout'));
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  console.log('PASS provider queues, deadlines, deduplicated upstream attempts, token reporting and long-party context.');
}
test().catch(error => { console.error(error); process.exitCode = 1; });
