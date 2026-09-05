// scripts/phase-3-2-auth-and-raw-quantity-test.ts
import assert from 'assert';
import { apiClient } from '../src/services/apiClient';
import { TradingEngine } from '../server/trading/TradingEngine';
import { PositionManager } from '../server/trading/PositionManager';
import { MainnetTradeExecutor } from '../server/execution/MainnetTradeExecutor';
import { MainnetJupiterExecutor } from '../src/services/MainnetJupiterExecutor';

console.log('🚀 Running Phase 3.2 Authenticated Trading & Raw Quantity Purge Test Suite...\n');

async function runTests() {
  let passed = 0;
  let failed = 0;

  function test(name: string, fn: () => Promise<void> | void) {
    return (async () => {
      try {
        await fn();
        console.log(`  ✔ [PASS] ${name}`);
        passed++;
      } catch (err: any) {
        console.error(`  ❌ [FAIL] ${name}: ${err?.message || err}`);
        failed++;
      }
    })();
  }

  console.log('▶ [TEST 1] ApiClient Unauthenticated Request Interception');
  await test('apiClient returns 401 unauthenticated when no Firebase session exists', async () => {
    // Calling a protected endpoint without auth
    let threw = false;
    try {
      await apiClient.post('/api/trading/buy', {
        network: 'paper',
        mint: 'DezXAZ8z7PnrnESzzrfUg1g8v1s1gT9E1Zqh9gLrwvD',
        amountSol: 0.1,
      });
    } catch (err: any) {
      threw = true;
      assert(
        err.message.includes('Unauthenticated') || err.message.includes('401'),
        `Expected 401 unauthenticated error, got: ${err.message}`
      );
    }
    assert(threw, 'Expected unauthenticated call to throw or fail');
  });

  console.log('\n▶ [TEST 2] Raw Quantity Precision & String Preservation');
  await test('TradingEngine sell validates 64-bit and large integer string raw amounts without numeric precision loss', async () => {
    const engine = TradingEngine.getInstance();
    const posManager = PositionManager.getInstance();

    // Setup an active test position with a massive raw supply (e.g. 18-decimal or huge pump token supply)
    const testMint = `TestLargeMint_${Date.now()}_1111111111111111111111111`;
    const largeAmountStr = '9007199254740993000'; // Exceeds Number.MAX_SAFE_INTEGER (9007199254740991)

    posManager.openOrAccumulatePosition({
      network: 'paper',
      wallet: 'default',
      mint: testMint,
      tokenAmountRaw: largeAmountStr,
      decimals: 9,
      solSpent: 0.1,
      orderId: 'test_large_order',
      buySignature: 'test_large_sig',
    });

    const pos = posManager.getPosition('paper', 'default', testMint);
    assert(pos, 'Position should exist');
    assert.strictEqual(pos.tokenAmountRaw, largeAmountStr, 'tokenAmountRaw should preserve exact large integer string');

    // Sell with large raw amount string
    const sellRes = await engine.sell({
      network: 'paper',
      wallet: 'default',
      mint: testMint,
      amountRaw: largeAmountStr,
    });

    assert(sellRes.success, `Sell with large raw amount should succeed, got: ${sellRes.error}`);
  });

  await test('TradingEngine rejects invalid non-numeric raw amounts', async () => {
    const engine = TradingEngine.getInstance();
    const posManager = PositionManager.getInstance();
    const testMint = 'DezXAZ8z7PnrnESzzrfUg1g8v1s1gT9E1Zqh9gLrwvD';

    posManager.openOrAccumulatePosition({
      network: 'paper',
      wallet: 'default',
      mint: testMint,
      tokenAmountRaw: '1000000000',
      decimals: 9,
      solSpent: 0.1,
      orderId: 'test_order_invalid',
      buySignature: 'test_sig_invalid',
    });

    const res = await engine.sell({
      network: 'paper',
      wallet: 'default',
      mint: testMint,
      amountRaw: '-500',
    });

    assert(!res.success, 'Sell with negative amount should fail');
    assert(res.error?.includes('INVALID_AMOUNT'), `Expected INVALID_AMOUNT, got: ${res.error}`);
  });

  console.log('\n▶ [TEST 3] Strict Synthetic Quote Rejection');
  await test('MainnetTradeExecutor strictly throws QUOTE_FETCH_FAILED on empty or invalid Jupiter responses', async () => {
    const executor = new MainnetTradeExecutor();
    let threw = false;

    try {
      // Invalid input mints that will fail on real Jupiter quote
      await executor.quoteBuy({
        inputMint: 'invalid_mint_111',
        outputMint: 'invalid_mint_222',
        amount: 100000000,
        slippageBps: 250,
      });
    } catch (err: any) {
      threw = true;
      assert(
        err.message.includes('QUOTE_FETCH_FAILED') || err.message.includes('Jupiter Quote Failed'),
        `Expected QUOTE_FETCH_FAILED, got: ${err.message}`
      );
    }
    assert(threw, 'Expected quoteBuy on invalid mints to fail closed without synthetic fallback');
  });

  console.log('\n======================================================');
  console.log(`PHASE 3.2 TEST RESULTS: ${passed} passed, ${failed} failed`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
