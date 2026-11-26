const assert = require('node:assert/strict');
const { historyPage, pageQuery } = require('../src/domain/roomHistoryPage');

const messages = Array.from({ length: 137 }, (_, i) => ({
  logIndex: i * 3, sender: '主持', role: 'dm', content: '第 ' + i + ' 条',
}));
messages[49].content += '<<ROLL:理智:小夏>>';
messages[50] = { logIndex: 150, role: 'roll', sender: '小夏', content: '检定结果', rollId: '147-0-小夏-理智' };
const tail = historyPage(messages);
assert.equal(tail.messages.length, 50);
assert.equal(tail.messages[0], messages[87]);
assert.equal(tail.latestSeq, messages.at(-1).logIndex);
assert.equal(tail.hasEarlier, true);
assert.equal(tail.hasLater, false);
const earlier = historyPage(messages, { beforeSeq: messages[50].logIndex });
assert.equal(earlier.messages.length, 50);
assert.equal(earlier.messages.at(-1).followingRolls[0].content, '检定结果');
assert.equal(messages[49].followingRolls, undefined);
const source = historyPage(messages, { aroundSeq: 21 });
assert.ok(source.messages.some(msg => msg.logIndex === 21));
assert.equal(source.hasEarlier, false);
const seen = [messages[0].logIndex];
for (let page; ; ) {
  page = historyPage(messages, { afterSeq: seen.at(-1) });
  seen.push(...page.messages.map(m => m.logIndex));
  if (!page.hasLater) break;
}
assert.deepEqual(seen, messages.map(m => m.logIndex));
assert.equal(historyPage(messages, { afterSeq: tail.latestSeq }).messages.length, 0);
for (const invalid of [{ beforeSeq: '-1' }, { aroundSeq: ['1'] }, { afterSeq: '99999999999999999999' },
  { beforeSeq: '1', afterSeq: '2' }]) assert.equal(pageQuery(invalid), null);
assert.deepEqual(pageQuery({ aroundSeq: '0' }), { aroundSeq: 0 });
console.log('PASS bounded history pages, cursor traversal, cross-page rolls and source lookup');
