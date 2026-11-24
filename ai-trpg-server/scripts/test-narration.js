const assert = require('node:assert/strict');
const { cleanKpNarration } = require('../src/domain/narration');
process.env.API_KEY = 'offline-test';
const { buildHistoryContext } = require('../src/services/aiService');

const scene = '他的目光移回你身上，看不出波澜。';
const inline = scene + '你现在可以： · 继续追问KPC · 观察台下的黑袍人群';
const named = scene + ' 白玉楼，你现在可以：\n• 继续追问KPC\n• 再看一眼镜子';
assert.equal(cleanKpNarration(inline), scene);
assert.equal(cleanKpNarration(named), scene);
assert.equal(cleanKpNarration(named + '\n\n钟声响了。'), scene + '\n\n钟声响了。');
for (const directive of ['<<STAT:白玉楼:SAN:-2>>', '<<ROLL:理智:白玉楼>>']) {
  assert.ok(cleanKpNarration(named + directive).endsWith(directive));
}
for (const original of ['KPC说：“你现在可以走了。”', '桌上有几样东西：\n- 旧钥匙\n- 怀表', '走廊尽头有两扇门。']) {
  assert.equal(cleanKpNarration(original), original);
}
const history = buildHistoryContext([
  { type: 'dm_reply', content: named },
  { type: 'player_action', playerName: '白玉楼', content: inline },
]);
assert.equal(history[0].content, scene);
assert.ok(history[1].content.endsWith(inline));
console.log('PASS inline and multiline KP menus, old history, NPC speech, player messages and check directives.');
