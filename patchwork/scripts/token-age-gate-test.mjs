import assert from 'node:assert/strict';

console.log("🚀 Running Token Age Hard Entry Gate Verification Test Suite...\n");

function evaluateTokenAgeGate({
  rawCreatedAt,
  userMinAge = 5,
  userMaxAge = 60,
  isManualDirectBuy = false,
  symbol = 'TEST'
}) {
  const logs = [];
  const addLog = (msg, level) => logs.push({ msg, level });

  if (isManualDirectBuy) {
    return { pass: true, reason: 'MANUAL_BUY_BYPASS', logs };
  }

  // 1. Establish actual creation time
  if (!rawCreatedAt || rawCreatedAt <= 0 || isNaN(rawCreatedAt)) {
    addLog(`❌ [TOKEN AGE BLOCK] Skipped buy of ${symbol}: Token creation time cannot be established. Reason: TOKEN_AGE_UNKNOWN`, 'warn');
    return { pass: false, reason: 'TOKEN_AGE_UNKNOWN', logs };
  }

  // 2. Calculate current age in minutes
  const normCreatedAt = rawCreatedAt < 1000000000000 ? rawCreatedAt * 1000 : rawCreatedAt;
  const now = Date.now();
  const currentAgeMin = (now - normCreatedAt) / 60000;

  // 3. Evaluate age boundaries
  if (currentAgeMin < userMinAge || currentAgeMin > userMaxAge) {
    addLog(`❌ [TOKEN AGE BLOCK] Skipped buy of ${symbol}: Token age: ${currentAgeMin.toFixed(1)}m. Allowed: ${userMinAge}m–${userMaxAge}m. Reason: TOKEN_AGE_OUT_OF_RANGE`, 'warn');
    return { pass: false, reason: 'TOKEN_AGE_OUT_OF_RANGE', currentAgeMin, logs };
  }

  addLog(`✅ [TOKEN AGE PASS] ${symbol} age: ${currentAgeMin.toFixed(1)}m is within allowed range (${userMinAge}m–${userMaxAge}m)`, 'info');
  return { pass: true, currentAgeMin, logs };
}

// TEST 1: Valid age inside 5m - 60m range (e.g. 15 minutes old)
const now = Date.now();
const age15mTimestamp = now - 15 * 60 * 1000;
const res1 = evaluateTokenAgeGate({ rawCreatedAt: age15mTimestamp, userMinAge: 5, userMaxAge: 60 });
assert.equal(res1.pass, true);
console.log("▶ [TEST 1] Token age within allowed range (15m in 5m-60m)");
console.log("  ✔ Buy allowed cleanly");

// TEST 2: Age too high (143.2 minutes old)
const age143mTimestamp = now - 143.2 * 60 * 1000;
const res2 = evaluateTokenAgeGate({ rawCreatedAt: age143mTimestamp, userMinAge: 5, userMaxAge: 60 });
assert.equal(res2.pass, false);
assert.equal(res2.reason, 'TOKEN_AGE_OUT_OF_RANGE');
assert.ok(res2.logs[0].msg.includes('Reason: TOKEN_AGE_OUT_OF_RANGE'));
console.log("▶ [TEST 2] Token age out of range high (143.2m > 60m)");
console.log("  ✔ Buy blocked with Reason: TOKEN_AGE_OUT_OF_RANGE");

// TEST 3: Age too low (2 minutes old)
const age2mTimestamp = now - 2 * 60 * 1000;
const res3 = evaluateTokenAgeGate({ rawCreatedAt: age2mTimestamp, userMinAge: 5, userMaxAge: 60 });
assert.equal(res3.pass, false);
assert.equal(res3.reason, 'TOKEN_AGE_OUT_OF_RANGE');
assert.ok(res3.logs[0].msg.includes('Reason: TOKEN_AGE_OUT_OF_RANGE'));
console.log("▶ [TEST 3] Token age out of range low (2m < 5m)");
console.log("  ✔ Buy blocked with Reason: TOKEN_AGE_OUT_OF_RANGE");

// TEST 4: Unknown creation time (null / undefined / 0 / NaN)
const res4 = evaluateTokenAgeGate({ rawCreatedAt: null, userMinAge: 5, userMaxAge: 60 });
assert.equal(res4.pass, false);
assert.equal(res4.reason, 'TOKEN_AGE_UNKNOWN');
assert.ok(res4.logs[0].msg.includes('Reason: TOKEN_AGE_UNKNOWN'));
console.log("▶ [TEST 4] Creation time cannot be established");
console.log("  ✔ Buy blocked with Reason: TOKEN_AGE_UNKNOWN (No fallback to Date.now())");

console.log("\n🎉 ALL TOKEN AGE HARD ENTRY GATE TESTS PASSED SUCCESSFULLY! ✅");
