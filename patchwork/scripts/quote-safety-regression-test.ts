// scripts/quote-safety-regression-test.ts
import assert from 'assert';
import {
  normalizePriceImpact,
  convertUsdToLamports,
  buildSafeQuoteDiagnostic,
  validateQuoteSafetyStrict,
  WSOL_MINT,
  SOL_MINT,
  MAX_PRICE_IMPACT_RATIO,
} from '../src/utils/quoteSafety';

console.log('🧪 =================================================================');
console.log('🧪 RUNNING ARINA X-RAY QUOTE SAFETY REGRESSION TEST SUITE (10 SCENARIOS)');
console.log('🧪 =================================================================\n');

const TARGET_TOKEN_MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'; // BONK

// SCENARIO 1: Valid quote with low impact -> PASS
console.log('▶ [SCENARIO 1] Valid quote with low impact (0.12% impact)');
const quote1 = {
  inputMint: SOL_MINT,
  outputMint: TARGET_TOKEN_MINT,
  inAmount: '5000000',
  outAmount: '150000000000',
  otherAmountThreshold: '148500000000',
  priceImpactPct: '0.12', // 0.12%
  routePlan: [{ swapInfo: { ammKey: 'raydium_clmm' }, percent: 100 }],
};
const res1 = validateQuoteSafetyStrict({
  quote: quote1,
  inputAmount: '5000000',
  slippageBps: 100,
  expectedOutputMint: TARGET_TOKEN_MINT,
  isBuy: true,
});
assert.strictEqual(res1.valid, true);
assert.strictEqual(res1.outAmount, 150000000000n);
assert.strictEqual(res1.otherAmountThreshold, 148500000000n);
assert.strictEqual(res1.priceImpactPctString, '0.12%');
console.log('  ✔ PASS: Low impact quote successfully validated.\n');

// SCENARIO 2: Exactly 10% -> PASS (boundary condition <= 10.0%)
console.log('▶ [SCENARIO 2] Exactly 10.0% price impact boundary condition');
const quote2 = {
  inputMint: SOL_MINT,
  outputMint: TARGET_TOKEN_MINT,
  inAmount: '5000000',
  outAmount: '100000000',
  otherAmountThreshold: '99000000',
  priceImpactPct: '10.00', // 10.00%
  routePlan: [{ swapInfo: { ammKey: 'orca_whirlpool' }, percent: 100 }],
};
const res2 = validateQuoteSafetyStrict({
  quote: quote2,
  inputAmount: '5000000',
  slippageBps: 100,
  expectedOutputMint: TARGET_TOKEN_MINT,
  isBuy: true,
});
assert.strictEqual(res2.valid, true);
assert.strictEqual(res2.normalizedPriceImpactRatio, 0.10);
assert.strictEqual(res2.priceImpactPctString, '10.00%');
console.log('  ✔ PASS: Exact 10.00% boundary correctly allowed.\n');

// SCENARIO 3: 11% -> REJECT (QUOTE_SAFETY_ERROR)
console.log('▶ [SCENARIO 3] 11.0% price impact exceeds 10% threshold');
const quote3 = {
  inputMint: SOL_MINT,
  outputMint: TARGET_TOKEN_MINT,
  inAmount: '5000000',
  outAmount: '100000000',
  otherAmountThreshold: '99000000',
  priceImpactPct: '11.00', // 11.00%
  routePlan: [{ swapInfo: { ammKey: 'orca_whirlpool' }, percent: 100 }],
};
let caught3 = false;
try {
  validateQuoteSafetyStrict({
    quote: quote3,
    inputAmount: '5000000',
    slippageBps: 100,
    expectedOutputMint: TARGET_TOKEN_MINT,
    isBuy: true,
  });
} catch (err: any) {
  caught3 = true;
  assert.ok(err.message.includes('QUOTE_SAFETY_ERROR'));
  assert.ok(err.message.includes('11.00%'));
  console.log(`  ✔ PASS: Correctly rejected with: "${err.message}"\n`);
}
assert.strictEqual(caught3, true, 'Should have thrown QUOTE_SAFETY_ERROR for 11% impact');

// SCENARIO 4: 100% -> REJECT (QUOTE_SAFETY_ERROR)
console.log('▶ [SCENARIO 4] Genuinely catastrophic 100% price impact quote');
const quote4 = {
  inputMint: SOL_MINT,
  outputMint: TARGET_TOKEN_MINT,
  inAmount: '5000000',
  outAmount: '1',
  otherAmountThreshold: '1',
  priceImpactPct: '100.00', // 100%
  routePlan: [{ swapInfo: { ammKey: 'illiquid_pool' }, percent: 100 }],
};
let caught4 = false;
try {
  validateQuoteSafetyStrict({
    quote: quote4,
    inputAmount: '5000000',
    slippageBps: 100,
    expectedOutputMint: TARGET_TOKEN_MINT,
    isBuy: true,
  });
} catch (err: any) {
  caught4 = true;
  assert.ok(err.message.includes('QUOTE_SAFETY_ERROR'));
  assert.ok(err.message.includes('100.00%'));
  console.log(`  ✔ PASS: Correctly rejected catastrophic 100% impact: "${err.message}"\n`);
}
assert.strictEqual(caught4, true, 'Should have thrown QUOTE_SAFETY_ERROR for 100% impact');

// SCENARIO 5: null/NaN price impact -> INVALID_QUOTE (NOT 100% impact!)
console.log('▶ [SCENARIO 5] null/NaN price impact returns INVALID_QUOTE');
const quote5a = {
  inputMint: SOL_MINT,
  outputMint: TARGET_TOKEN_MINT,
  inAmount: '5000000',
  outAmount: '100000',
  priceImpactPct: null,
  routePlan: [{ swapInfo: { ammKey: 'amm' }, percent: 100 }],
};
let caught5a = false;
try {
  validateQuoteSafetyStrict({
    quote: quote5a,
    inputAmount: '5000000',
    slippageBps: 100,
    isBuy: true,
  });
} catch (err: any) {
  caught5a = true;
  assert.ok(err.message.includes('INVALID_QUOTE'));
  assert.ok(!err.message.includes('100.00%'));
  console.log(`  ✔ PASS: null priceImpactPct rejected as INVALID_QUOTE: "${err.message}"`);
}
assert.strictEqual(caught5a, true);

const quote5b = {
  inputMint: SOL_MINT,
  outputMint: TARGET_TOKEN_MINT,
  inAmount: '5000000',
  outAmount: '100000',
  priceImpactPct: 'undefined',
  routePlan: [{ swapInfo: { ammKey: 'amm' }, percent: 100 }],
};
let caught5b = false;
try {
  validateQuoteSafetyStrict({
    quote: quote5b,
    inputAmount: '5000000',
    slippageBps: 100,
    isBuy: true,
  });
} catch (err: any) {
  caught5b = true;
  assert.ok(err.message.includes('INVALID_QUOTE'));
  console.log(`  ✔ PASS: 'undefined' priceImpactPct rejected as INVALID_QUOTE: "${err.message}"\n`);
}
assert.strictEqual(caught5b, true);

// SCENARIO 6: Missing route / empty routePlan -> NO_ROUTE (NOT 100% impact!)
console.log('▶ [SCENARIO 6] Missing route / empty routePlan returns NO_ROUTE');
const quote6 = {
  inputMint: SOL_MINT,
  outputMint: TARGET_TOKEN_MINT,
  inAmount: '5000000',
  outAmount: '0',
  priceImpactPct: '0',
  routePlan: [],
};
let caught6 = false;
try {
  validateQuoteSafetyStrict({
    quote: quote6,
    inputAmount: '5000000',
    slippageBps: 100,
    isBuy: true,
  });
} catch (err: any) {
  caught6 = true;
  assert.ok(err.message.includes('NO_ROUTE'));
  console.log(`  ✔ PASS: Empty routePlan returns NO_ROUTE: "${err.message}"\n`);
}
assert.strictEqual(caught6, true);

// SCENARIO 7: Zero output -> INVALID_QUOTE
console.log('▶ [SCENARIO 7] Zero output amount returns INVALID_QUOTE');
const quote7 = {
  inputMint: SOL_MINT,
  outputMint: TARGET_TOKEN_MINT,
  inAmount: '5000000',
  outAmount: '0',
  priceImpactPct: '0.01',
  routePlan: [{ swapInfo: { ammKey: 'amm' }, percent: 100 }],
};
let caught7 = false;
try {
  validateQuoteSafetyStrict({
    quote: quote7,
    inputAmount: '5000000',
    slippageBps: 100,
    isBuy: true,
  });
} catch (err: any) {
  caught7 = true;
  assert.ok(err.message.includes('INVALID_QUOTE'));
  console.log(`  ✔ PASS: Zero outAmount returns INVALID_QUOTE: "${err.message}"\n`);
}
assert.strictEqual(caught7, true);

// SCENARIO 8: Reversed mints on BUY -> INVALID_QUOTE
console.log('▶ [SCENARIO 8] Reversed mints on BUY (Token -> SOL instead of SOL -> Token)');
const quote8 = {
  inputMint: TARGET_TOKEN_MINT, // Reversed!
  outputMint: SOL_MINT,
  inAmount: '5000000',
  outAmount: '100000',
  priceImpactPct: '0.05',
  routePlan: [{ swapInfo: { ammKey: 'amm' }, percent: 100 }],
};
let caught8 = false;
try {
  validateQuoteSafetyStrict({
    quote: quote8,
    inputAmount: '5000000',
    slippageBps: 100,
    expectedOutputMint: TARGET_TOKEN_MINT,
    isBuy: true,
  });
} catch (err: any) {
  caught8 = true;
  assert.ok(err.message.includes('INVALID_QUOTE'));
  assert.ok(err.message.includes('inputMint must be SOL/WSOL'));
  console.log(`  ✔ PASS: Reversed BUY trade rejected as INVALID_QUOTE: "${err.message}"\n`);
}
assert.strictEqual(caught8, true);

// SCENARIO 9: $1 -> correct lamports conversion
console.log('▶ [SCENARIO 9] $1 USD converted to exact lamports at various SOL prices');
// If SOL = $200, $1 = 0.005 SOL = 5,000,000 lamports
const lamportsAt200 = convertUsdToLamports(1.0, 200.0);
assert.strictEqual(lamportsAt200, 5_000_000n);
console.log('  ✔ $1.00 @ $200.00/SOL =', lamportsAt200.toString(), 'lamports (0.005 SOL)');

// If SOL = $143.50, $1 = (1 / 143.50) * 1e9 = 6,968,641 lamports
const lamportsAt143_5 = convertUsdToLamports(1.0, 143.5);
assert.strictEqual(lamportsAt143_5, 6_968_641n);
console.log('  ✔ $1.00 @ $143.50/SOL =', lamportsAt143_5.toString(), 'lamports');

// If SOL = $20.00, $1 = 0.05 SOL = 50,000,000 lamports
const lamportsAt20 = convertUsdToLamports(1.0, 20.0);
assert.strictEqual(lamportsAt20, 50_000_000n);
console.log('  ✔ $1.00 @ $20.00/SOL =', lamportsAt20.toString(), 'lamports');
console.log('  ✔ PASS: Decimal-safe integer arithmetic verified for USD -> SOL -> lamports.\n');

// SCENARIO 10: Large lamport and token amounts -> No Number precision loss
console.log('▶ [SCENARIO 10] Large BigInt lamport & token amounts (e.g. 100 Trillion base units)');
const largeTokenOutBigInt = 100_000_000_000_000_000n; // 100 Quadrillion base units
const quote10 = {
  inputMint: SOL_MINT,
  outputMint: TARGET_TOKEN_MINT,
  inAmount: '1000000000000', // 1000 SOL
  outAmount: largeTokenOutBigInt.toString(),
  otherAmountThreshold: (largeTokenOutBigInt * 99n / 100n).toString(),
  priceImpactPct: '0.05',
  routePlan: [{ swapInfo: { ammKey: 'whirlpool' }, percent: 100 }],
};
const res10 = validateQuoteSafetyStrict({
  quote: quote10,
  inputAmount: '1000000000000',
  slippageBps: 100,
  expectedOutputMint: TARGET_TOKEN_MINT,
  isBuy: true,
});
assert.strictEqual(res10.valid, true);
assert.strictEqual(res10.outAmount, largeTokenOutBigInt);
assert.strictEqual(res10.otherAmountThreshold, largeTokenOutBigInt * 99n / 100n);
console.log('  ✔ Large token outAmount:', res10.outAmount.toString());
console.log('  ✔ PASS: BigInt precision intact without floating point truncation.\n');

// Safe Diagnostics Verification
console.log('▶ [DIAGNOSTIC TEST] Safe diagnostic object generation');
const diagnostic = buildSafeQuoteDiagnostic({
  quote: quote1,
  requestedUsdAmount: 1.0,
  solPriceUsed: 200.0,
  calculatedLamports: 5_000_000n,
  expectedOutputMint: TARGET_TOKEN_MINT,
});
assert.strictEqual(diagnostic.requestedUsdAmount, 1.0);
assert.strictEqual(diagnostic.solPriceUsed, 200.0);
assert.strictEqual(diagnostic.calculatedSolAmount, 0.005);
assert.strictEqual(diagnostic.calculatedLamports, '5000000');
assert.strictEqual(diagnostic.rawPriceImpactPct, '0.12');
assert.strictEqual(diagnostic.normalizedPriceImpactPct, '0.12%');
assert.strictEqual(diagnostic.routePlanLength, 1);
assert.strictEqual(diagnostic.inAmount, '5000000');
assert.strictEqual(diagnostic.outAmount, '150000000000');
// Verify no secrets exist in diagnostic
assert.strictEqual((diagnostic as any).privateKey, undefined);
assert.strictEqual((diagnostic as any).secret, undefined);
assert.strictEqual((diagnostic as any).apiKey, undefined);
console.log('  ✔ Safe Diagnostic Object:', JSON.stringify(diagnostic, null, 2));
console.log('\n🎉 ALL 10 REGRESSION SCENARIOS PASSED WITH ZERO ERRORS!\n');
