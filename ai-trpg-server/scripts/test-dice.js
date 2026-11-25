const assert = require('node:assert/strict');
const { makeRollRules, rollPercentile, rollSkill } = require('../src/domain/dice');

const digits = (...values) => () => values.shift();
assert.deepEqual(makeRollRules(61, 'hard', 1), { baseValue:61, difficulty:'hard', modifier:1, target:30 });
assert.equal(makeRollRules(61, 'extreme').target, 12);
assert.equal(makeRollRules(61).target,61);
assert.equal(makeRollRules(60, 'unknown'), null);
assert.equal(makeRollRules(60, ['hard']), null);
assert.equal(makeRollRules(60, 'hard', -3), null);
assert.deepEqual(rollPercentile(1, digits(0,0,4)), { candidates:[100,40], roll:40 });
assert.deepEqual(rollPercentile(-2, digits(3,4,2,8)), { candidates:[43,23,83], roll:83 });
const hard = makeRollRules(60,'hard');
assert.match(rollSkill({}, '侦查',hard,digits(2,4)), /常规成功.*困难目标 30，未达成/);
assert.match(rollSkill({}, '侦查',hard,digits(0,3)), /困难成功.*困难目标 30，已达成/);
assert.match(rollSkill({}, '侦查',makeRollRules(100),digits(0,0)), /大失败.*未达成/);
console.log('PASS roll targets, shared-unit bonus and penalty dice, fumbles and exact thresholds.');
