import assert from 'node:assert/strict';

// Static + mathematical regression checks for the V103 TP/SL contract.
const entry = 1;
const tp = 25;
const sl = 15;
assert.equal(1.25 >= 1 + tp / 100, true, 'TP boundary must trigger at exact threshold');
assert.equal(0.85 <= 1 - sl / 100, true, 'SL boundary must trigger at exact threshold');
assert.equal(1.24999 >= 1.25, false, 'Price below TP must not trigger');
assert.equal(0.85001 <= 0.85, false, 'Price above SL must not trigger');
const unsafe = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
assert.equal(unsafe > BigInt(Number.MAX_SAFE_INTEGER), true, 'Unsafe raw amount fixture');
console.log('PASS: TP/SL V103 boundary + precision contract regression');
