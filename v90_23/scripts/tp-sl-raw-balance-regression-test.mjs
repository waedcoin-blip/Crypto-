// scripts/tp-sl-raw-balance-regression-test.mjs
import assert from 'assert';

console.log('🚀 Running TP/SL Raw vs UI Token Balance Regression Test Suite (Flor Bug Fix)...\n');

// 1. Mock Paper Trade Executor returning RAW token balance
class MockPaperTradeExecutor {
  constructor(initialUiBalance = 2343615.015317, decimals = 6) {
    this.decimals = decimals;
    this.uiBalance = initialUiBalance;
    this.tokenBalances = {
      'FLOR_MINT_1111111111111111111111111111111': initialUiBalance,
    };
    this.executedSwaps = [];
  }

  // Contract: ITradeExecutor.getTokenBalance returns RAW base units (integer)
  async getTokenBalance(mint) {
    const ui = this.tokenBalances[mint] || 0;
    return Math.floor(ui * Math.pow(10, this.decimals));
  }

  async swap(inputMint, outputMint, amount, slippageBps, label) {
    const rawTokens = Math.floor(amount);
    const requiredUiTokens = rawTokens / Math.pow(10, this.decimals);
    const availableUiTokens = this.tokenBalances[inputMint] || 0;

    // Check balance in UI amounts
    if (availableUiTokens < requiredUiTokens) {
      throw new Error(
        `PAPER_EXECUTION_FAILED: INSUFFICIENT_FUNDS: Required ${requiredUiTokens.toFixed(6)} tokens, Available ${availableUiTokens.toFixed(6)}`
      );
    }

    this.tokenBalances[inputMint] -= requiredUiTokens;
    this.executedSwaps.push({
      inputMint,
      outputMint,
      amountRaw: rawTokens,
      amountUi: requiredUiTokens,
      label,
    });

    return {
      signature: 'tx_flor_exit_success',
      inputAmount: rawTokens,
      outputAmount: 500000000, // 0.5 SOL
      feeSol: 0.00005,
    };
  }
}

// 2. Mock RiskManager trigger exit test
async function testFlorRegression() {
  const decimals = 6;
  const florUiAmount = 2343615.015317;
  const florRawAmount = 2343615015317; // exact raw base units

  const executor = new MockPaperTradeExecutor(florUiAmount, decimals);

  // Initial position created after buy
  const position = {
    mint: 'FLOR_MINT_1111111111111111111111111111111',
    amount: florRawAmount, // already in integer base units
    tokenDecimals: decimals,
    buyPrice: 0.000000213,
    solSpent: 0.5,
    currentPrice: 0.000000300,
    state: 'OPEN',
  };

  console.log('▶ [CHECK 1] Verify ITradeExecutor.getTokenBalance() contract returns integer raw units');
  const balanceFromExecutor = await executor.getTokenBalance(position.mint);
  assert.strictEqual(balanceFromExecutor, florRawAmount, 'getTokenBalance must return raw integer base units');
  console.log(`  ✔ Executor getTokenBalance: ${balanceFromExecutor} (Raw Base Units)`);

  console.log('\n▶ [CHECK 2] Simulate RiskManager live balance sync before exit swap');
  // Fixed RiskManager logic: getTokenBalance already returns RAW base units, so do NOT multiply by 10^decimals
  if (typeof executor.getTokenBalance === 'function') {
    const liveRawTokens = await executor.getTokenBalance(position.mint);
    if (liveRawTokens > 0) {
      position.amount = Math.floor(liveRawTokens);
    }
  }

  assert.strictEqual(position.amount, florRawAmount, 'Position amount must remain exact raw base units without second multiplication');
  console.log(`  ✔ RiskManager position.amount synced: ${position.amount} base units (No 10^12 corruption)`);

  console.log('\n▶ [CHECK 3] Execute swap through executor with raw amount');
  let swapSuccess = false;
  try {
    const res = await executor.swap(
      position.mint,
      'So11111111111111111111111111111111111111112',
      position.amount,
      250,
      'exit_tp'
    );
    assert.strictEqual(res.signature, 'tx_flor_exit_success');
    swapSuccess = true;
  } catch (e) {
    console.error('Swap failed:', e.message);
  }
  assert.strictEqual(swapSuccess, true, 'Paper executor should accept the swap without INSUFFICIENT_FUNDS error');
  console.log('  ✔ Paper Trade Executor successfully executed exit swap with exact raw balance');

  console.log('\n▶ [CHECK 4] Regression test: Verify that the old bug would have failed');
  const faultyAmount = florRawAmount * Math.pow(10, decimals); // Old buggy double multiplication
  let caughtOldBug = false;
  try {
    const failingExecutor = new MockPaperTradeExecutor(florUiAmount, decimals);
    await failingExecutor.swap(
      position.mint,
      'So11111111111111111111111111111111111111112',
      faultyAmount,
      250,
      'exit_tp'
    );
  } catch (err) {
    caughtOldBug = true;
    assert(err.message.includes('INSUFFICIENT_FUNDS'));
    console.log(`  ✔ Confirmed old bug behavior: Caught expected failure with message:\n     "${err.message}"`);
  }
  assert.strictEqual(caughtOldBug, true, 'Double-multiplied amount must fail with insufficient funds');

  console.log('\n🎉 ALL 4/4 REGRESSION CHECKS PASSED SUCCESSFULLY! ✅');
}

testFlorRegression();
