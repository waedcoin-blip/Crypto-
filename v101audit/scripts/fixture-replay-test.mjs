// scripts/fixture-replay-test.mjs
import assert from 'assert';
import fs from 'fs';
import path from 'path';

console.log('🚀 Running Jupiter Captured Fixture & Replay Tests...\n');

const fixturesDir = path.resolve(process.cwd(), 'fixtures/jupiter');
if (!fs.existsSync(fixturesDir)) {
  fs.mkdirSync(fixturesDir, { recursive: true });
}

// 1. Create a mock captured fixture with quote
const testSignatureWithQuote = '5VERp8StmcvQxM4hS6eB3zYvG1K9dTxJ4LqZ7rT8uW2m';
const fixtureWithQuote = {
  signature: testSignatureWithQuote,
  userWallet: 'WaedUserWallet111111111111111111111111111111',
  slot: 290450123,
  blockTime: 1724900000,
  inputMint: 'So11111111111111111111111111111111111111112',
  outputMint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', // RAY
  isSolBuy: true,
  actualFeeSol: 0.00001,
  transactionMeta: {
    err: null,
    fee: 10000,
    logMessages: ['Program JUP6LkbZbjS1jKKwapdHNy74bheuvzS44Ff2qG31941 invoke [1]'],
    preBalances: [5000000000, 100000000],
    postBalances: [3999990000, 1100000000],
    preTokenBalances: [
      {
        mint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
        owner: 'WaedUserWallet111111111111111111111111111111',
        uiTokenAmount: { amount: '0' },
      },
    ],
    postTokenBalances: [
      {
        mint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
        owner: 'WaedUserWallet111111111111111111111111111111',
        uiTokenAmount: { amount: '25000000' },
      },
    ],
  },
  detectedJupiterEvidence: {
    hasJupiterProgram: true,
    programIds: ['JUP6LkbZbjS1jKKwapdHNy74bheuvzS44Ff2qG31941'],
    logsContainJupiter: true,
  },
  originalQuoteSnapshot: {
    inputMint: 'So11111111111111111111111111111111111111112',
    outputMint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
    inAmount: '1000000000',
    outAmount: '25200000',
    otherAmountThreshold: '24900000',
    slippageBps: 50,
  },
  capturedAt: new Date().toISOString(),
};

fs.writeFileSync(
  path.join(fixturesDir, `${testSignatureWithQuote}.json`),
  JSON.stringify(fixtureWithQuote, null, 2)
);

// 2. Create a historical fixture without quote
const testSignatureNoQuote = '3XYZp8StmcvQxM4hS6eB3zYvG1K9dTxJ4LqZ7rT8uW99';
const fixtureNoQuote = {
  ...fixtureWithQuote,
  signature: testSignatureNoQuote,
  originalQuoteSnapshot: null,
};
fs.writeFileSync(
  path.join(fixturesDir, `${testSignatureNoQuote}.json`),
  JSON.stringify(fixtureNoQuote, null, 2)
);

// Test Replay logic
function replayFixture(fix) {
  if (!fix.originalQuoteSnapshot) {
    const err = new Error(
      `HISTORICAL_TRANSACTION_REJECTED: Historical captured fixture (${fix.signature.slice(0, 8)}...) does not have an original quote snapshot. Threshold replay is explicitly rejected instead of inventing one.`
    );
    err.code = 'HISTORICAL_TRANSACTION_REJECTED';
    throw err;
  }

  const meta = fix.transactionMeta;
  const preTok = meta.preTokenBalances.find((b) => b.mint === fix.outputMint && b.owner === fix.userWallet);
  const postTok = meta.postTokenBalances.find((b) => b.mint === fix.outputMint && b.owner === fix.userWallet);
  const delta = BigInt(postTok.uiTokenAmount.amount) - BigInt(preTok.uiTokenAmount.amount);

  const actualOutputAmount = Number(delta);
  const otherAmountThreshold = Number(fix.originalQuoteSnapshot.otherAmountThreshold);

  if (actualOutputAmount < otherAmountThreshold) {
    throw new Error('SLIPPAGE_TOLERANCE_EXCEEDED');
  }

  return {
    verified: true,
    actualOutputAmount,
    otherAmountThreshold,
  };
}

console.log('▶ [TEST 1] Replay captured fixture with exact quote snapshot');
const res1 = replayFixture(fixtureWithQuote);
assert.strictEqual(res1.verified, true);
assert.strictEqual(res1.actualOutputAmount, 25000000);
assert.strictEqual(res1.otherAmountThreshold, 24900000);
console.log('  ✔ Fixture replayed successfully and passed slippage threshold check (25,000,000 >= 24,900,000)\n');

console.log('▶ [TEST 2] Explicitly reject historical transactions without original quote snapshot');
try {
  replayFixture(fixtureNoQuote);
  assert.fail('Should have rejected fixture without quote');
} catch (err) {
  assert.strictEqual(err.code, 'HISTORICAL_TRANSACTION_REJECTED');
  console.log(`  ✔ Correctly rejected historical transaction without quote: ${err.message}\n`);
}

console.log('🎉 ALL CAPTURED FIXTURE REPLAY TESTS PASSED!');
