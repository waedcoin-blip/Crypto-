// scripts/bug002-transaction-timeout-double-spend-regression.mjs
if (typeof globalThis.window === 'undefined') {
  globalThis.window = globalThis;
}
import assert from 'assert';

console.log('--- STARTING BUG-002 BROADCAST TIMEOUT / DOUBLE SPEND REGRESSION TEST ---');

async function runTests() {
  const { orderManager } = await import('../server/trading/OrderManager.js');
  const { orderRepository } = await import('../server/repositories/OrderRepository.js');
  const { tradingEngine } = await import('../server/trading/TradingEngine.js');
  const { positionManager } = await import('../server/trading/PositionManager.js');
  const { executionGateway } = await import('../server/execution/ExecutionGateway.js');

  // Mock executor to simulate broadcast + timeout
  class MockTimeoutExecutor {
    async quoteBuy() {
      return { inAmount: '50000000', outAmount: '1000000', otherAmountThreshold: '950000', priceImpactPct: 0.1 };
    }
    async quoteSell() {
      return { inAmount: '1000000', outAmount: '50000000', otherAmountThreshold: '48000000', priceImpactPct: 0.1 };
    }
    async buy(params) {
      const mockSig = `mock_broadcast_tx_${Date.now()}`;
      if (params.onBroadcast) {
        await params.onBroadcast(mockSig);
      }
      // Simulate confirmation timeout (ambiguous state)
      return {
        success: false,
        signature: mockSig,
        status: 'RECOVERY_REQUIRED',
        isAmbiguous: true,
        inputMint: params.inputMint,
        outputMint: params.outputMint,
        inAmountRaw: params.amount,
        outAmountRaw: 0,
        error: 'CONFIRMATION_TIMEOUT: Transaction broadcast but confirmation timed out',
      };
    }
    async sell(params) {
      const mockSig = `mock_broadcast_sell_tx_${Date.now()}`;
      if (params.onBroadcast) {
        await params.onBroadcast(mockSig);
      }
      return {
        success: false,
        signature: mockSig,
        status: 'RECOVERY_REQUIRED',
        isAmbiguous: true,
        inputMint: params.inputMint,
        outputMint: params.outputMint,
        inAmountRaw: params.amount,
        outAmountRaw: 0,
        error: 'CONFIRMATION_TIMEOUT: Sell broadcast but confirmation timed out',
      };
    }
    async getBalance() { return 10; }
    async getTokenBalance() { return 1000000; }
  }

  // Override paper executor with MockTimeoutExecutor for testing
  executionGateway.paperExecutor = new MockTimeoutExecutor();

  const { Keypair } = await import('@solana/web3.js');

  const testMint = Keypair.generate().publicKey.toBase58();
  const network = 'paper';
  const wallet = 'default';

  console.log('\n[TEST 1] Testing BUY path on broadcast timeout (Double-spend prevention)...');
  const buyRes1 = await tradingEngine.buy({
    network,
    wallet,
    mint: testMint,
    amountSol: 0.05,
    decimals: 6,
    slippageBps: 250,
  });

  assert.strictEqual(buyRes1.success, false, 'Buy must return success: false on timeout');
  assert(buyRes1.signature, 'Signature must be captured despite timeout');
  assert.strictEqual(buyRes1.result?.status, 'RECOVERY_REQUIRED', 'Result status must be RECOVERY_REQUIRED');

  // Verify Order state in OrderManager and OrderRepository
  const orderRecord = orderRepository.getOrder(buyRes1.orderId);
  assert.strictEqual(orderRecord?.state, 'RECOVERY_REQUIRED', 'Order state in repository must be RECOVERY_REQUIRED');
  assert.strictEqual(orderRecord?.signature, buyRes1.signature, 'Signature must be persisted in repository');

  // CRITICAL VERIFICATION: Attempting a duplicate buy immediately after timeout
  console.log('-> Attempting duplicate buy for the same mint...');
  const buyRes2 = await tradingEngine.buy({
    network,
    wallet,
    mint: testMint,
    amountSol: 0.05,
    decimals: 6,
    slippageBps: 250,
  });

  assert.strictEqual(buyRes2.success, false, 'Duplicate buy must be REJECTED');
  assert(
    buyRes2.error?.includes('REBUY_GUARD_REJECTED') || buyRes2.error?.includes('REBUY_PREVENTED') || buyRes2.error?.includes('Active order in progress') || buyRes2.error?.includes('LOCK'),
    `Expected rebuy rejection, got: ${buyRes2.error}`
  );
  console.log(`PASSED: Duplicate spend prevented! (${buyRes2.error})`);

  console.log('\n[TEST 2] Testing SELL path on broadcast timeout (Duplicate sell / premature reopen prevention)...');
  const sellMint = Keypair.generate().publicKey.toBase58();
  positionManager.openOrAccumulatePosition({
    network,
    wallet,
    mint: sellMint,
    tokenAmountRaw: 5000000,
    decimals: 6,
    solSpent: 0.1,
  });

  const posBeforeSell = positionManager.getPosition(network, wallet, sellMint);
  assert(posBeforeSell, 'Position must exist');
  assert.strictEqual(posBeforeSell.status, 'OPEN');

  const sellRes1 = await tradingEngine.sell({
    network,
    wallet,
    mint: sellMint,
    amountRaw: 5000000,
    slippageBps: 250,
  });

  assert.strictEqual(sellRes1.success, false, 'Sell must return success: false on timeout');
  assert(sellRes1.signature, 'Sell signature must be captured');
  assert.strictEqual(sellRes1.result?.status, 'RECOVERY_REQUIRED', 'Sell result status must be RECOVERY_REQUIRED');

  // Verify position status: MUST NOT be reverted to OPEN!
  const posAfterTimeout = positionManager.getPosition(network, wallet, sellMint);
  assert(posAfterTimeout, 'Position must still be tracked');
  assert.strictEqual(posAfterTimeout.status, 'EXIT_PENDING', 'Position status must remain EXIT_PENDING to prevent double sell');

  // Attempt duplicate sell
  console.log('-> Attempting duplicate sell while previous sell is in EXIT_PENDING...');
  const sellRes2 = await tradingEngine.sell({
    network,
    wallet,
    mint: sellMint,
    amountRaw: 5000000,
  });

  assert.strictEqual(sellRes2.success, false, 'Duplicate sell must be REJECTED');
  assert(
    sellRes2.error?.includes('EXIT_ALREADY_PENDING'),
    `Expected EXIT_ALREADY_PENDING rejection, got: ${sellRes2.error}`
  );
  console.log(`PASSED: Duplicate sell prevented! (${sellRes2.error})`);

  console.log('\nALL BUG-002 REGRESSION TESTS PASSED SUCCESSFULLY!');
}

runTests().catch((e) => {
  console.error('TEST FAILED:', e);
  process.exit(1);
});
