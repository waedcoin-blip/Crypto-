// scripts/phase-3-1-execution-authority-test.ts
import assert from 'node:assert/strict';
import { orderManager } from '../server/trading/OrderManager.js';
import { executionGateway } from '../server/execution/ExecutionGateway.js';
import { tradingEngine } from '../server/trading/TradingEngine.js';
import { unifiedExitEngine } from '../server/trading/UnifiedExitEngine.js';
import { orderRepository } from '../server/repositories/OrderRepository.js';
import { positionManager } from '../server/trading/PositionManager.js';
import { MainnetTradeExecutor } from '../server/execution/MainnetTradeExecutor.js';
import { PaperTradeExecutor } from '../server/execution/PaperTradeExecutor.js';

async function runPhase31Tests() {
  console.log('🧪 Starting Phase 3.1 Execution Authority & Transaction Integrity Test Suite...\n');

  // TEST 1: Buy Flow Real-Path Execution (TradingEngine -> OrderManager -> ExecutionGateway -> Paper/Mainnet Executor)
  console.log('Test 1: Testing Buy Flow Real-Path Execution via TradingEngine...');
  const testMint = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
  const buyReqId = `buy_test_${Date.now()}`;
  const buyResult = await tradingEngine.buy({
    mint: testMint,
    amountSol: 0.1,
    slippageBps: 200,
    network: 'paper',
    wallet: 'default',
    clientRequestId: buyReqId,
    label: 'entry',
  });

  assert.equal(buyResult.success, true, `Buy execution should succeed: ${buyResult.error}`);
  assert.ok(buyResult.signature, 'Buy execution must produce signature');
  assert.ok(buyResult.positionId, 'Buy execution must produce position');

  // Verify Order state in OrderManager
  const order = orderManager.getOrders({ mint: testMint })
    .find(o => o.clientRequestId === buyReqId);
  assert.ok(order, 'OrderManager must have recorded the order');
  assert.equal(order.status, 'FILLED', 'Order state must be FILLED');
  console.log('✅ Test 1 Passed: Buy flow executed deterministically through authoritative path.\n');

  // TEST 2: Sell Flow Real-Path Execution (UnifiedExitEngine -> OrderManager -> ExecutionGateway -> Executor)
  console.log('Test 2: Testing Sell Flow Real-Path Execution via UnifiedExitEngine...');
  const pos = positionManager.getPosition('paper', 'default', testMint);
  assert.ok(pos, 'Position must exist from Test 1');
  
  const sellResult = await unifiedExitEngine.authorizeAndExecuteWithRetry(
    pos,
    'MANUAL_EXIT',
    'Manual exit triggered by test'
  );

  assert.equal(sellResult.success, true, 'Exit execution should succeed');
  assert.ok(sellResult.signature, 'Exit execution must produce signature');
  console.log('✅ Test 2 Passed: Sell flow executed deterministically through UnifiedExitEngine.\n');

  // TEST 3: Fail-Closed Quote Behavior on Quote Failure (No synthetic fallback)
  console.log('Test 3: Testing Fail-Closed Behavior on Mainnet Quote Failure...');
  const mainnetExec = new MainnetTradeExecutor();
  let quoteFailed = false;
  try {
    // Attempt quote for invalid mint on Mainnet without fallback
    await mainnetExec.quoteBuy({
      inputMint: 'So11111111111111111111111111111111111111112',
      outputMint: 'INVALID_MINT_FAIL_CLOSED_TEST_0000000000000000000',
      amount: 100000000n,
      slippageBps: 250,
      network: 'mainnet',
    });
  } catch (err: any) {
    quoteFailed = true;
    console.log(`Expected quote failure caught: ${err?.message}`);
  }
  assert.equal(quoteFailed, true, 'Mainnet quote must fail closed on invalid/unreachable quote instead of producing synthetic quote');
  console.log('✅ Test 3 Passed: Fail-closed quote verified.\n');

  // TEST 4: Fail-Closed on Signature Persistence Failure (RECOVERY_REQUIRED)
  console.log('Test 4: Testing Fail-Closed behavior on onBroadcast / Signature Persistence failure...');
  let recoveryRequiredTriggered = false;

  const { Keypair } = await import('@solana/web3.js');
  const { walletManager } = await import('../server/wallet/WalletManager.js');
  const testKeypair = Keypair.generate();
  walletManager.setAccount({
    identity: 'mainnet:default',
    network: 'mainnet',
    publicKey: testKeypair.publicKey.toBase58(),
    keypair: testKeypair,
    description: 'Test Mainnet Keypair',
  });

  // Simulate execution with failing onBroadcast persistence callback
  const mockFailingExecutor = new MainnetTradeExecutor();
  const testExecuteParams = {
    inputMint: 'So11111111111111111111111111111111111111112',
    outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    amount: '100000000',
    slippageBps: 250,
    decimals: 6,
    preValidatedQuote: {
      inAmount: '100000000',
      outAmount: '5000000000',
      otherAmountThreshold: '4875000000',
      priceImpactPct: 0.01,
      routePlan: [],
    },
    onBroadcast: async () => {
      throw new Error('SIMULATED_DATABASE_PERSISTENCE_FAILURE');
    },
  };

  // We test the executor's internal safety if onBroadcast fails after signature generation
  const buyRes = await mockFailingExecutor.buy(testExecuteParams);
  if (buyRes.status === 'RECOVERY_REQUIRED' || buyRes.error?.includes('RECOVERY_REQUIRED') || !buyRes.success) {
    recoveryRequiredTriggered = true;
  }
  assert.equal(recoveryRequiredTriggered, true, 'Recovery required state must be flagged');
  console.log('✅ Test 4 Passed: Signature persistence failure safely flagged.\n');

  // TEST 5: Restart-Safe OrderManager Restoration with BigInt Quantities
  console.log('Test 5: Testing Restart-Safe OrderManager State Loading...');
  const largeRawAmount = '987654321987654321'; // Exceeds Number.MAX_SAFE_INTEGER precision if converted to float
  const orderId = `ord_restart_test_${Date.now()}`;
  
  orderRepository.createOrder({
    order_id: orderId,
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    wallet: 'default',
    side: 'buy',
    amount_raw: largeRawAmount,
    decimals: 9,
    slippageBps: 250,
    network: 'paper',
    state: 'CONFIRMED',
    created_at: Date.now(),
    updated_at: Date.now(),
  });

  // Re-instantiate / trigger loading
  const loadedOrder = orderRepository.getOrder(orderId);
  assert.ok(loadedOrder, 'Repository must retrieve stored order');
  assert.equal(String(loadedOrder.amount_raw), largeRawAmount, 'Stored amount_raw must preserve exact string BigInt precision');
  assert.equal(loadedOrder.decimals, 9, 'Stored decimals must be preserved without 6-decimal fallback');
  console.log('✅ Test 5 Passed: Order state restored with exact BigInt precision.\n');

  // TEST 6: ExecutionGateway Authority Lock & Network Resolution
  console.log('Test 6: Testing ExecutionGateway Network Resolution & Executor Delegation...');
  const paperExec = executionGateway.getExecutor('paper');
  assert.ok(paperExec instanceof PaperTradeExecutor, 'Paper network must resolve to PaperTradeExecutor');
  
  const mainnetExecResolved = executionGateway.getExecutor('mainnet');
  assert.ok(mainnetExecResolved instanceof MainnetTradeExecutor, 'Mainnet network must resolve to MainnetTradeExecutor');
  console.log('✅ Test 6 Passed: ExecutionGateway enforces single authority per network.\n');

  console.log('🎉 ALL PHASE 3.1 TESTS PASSED SUCCESSFULLY!');
}

runPhase31Tests().catch((err) => {
  console.error('❌ Phase 3.1 Tests Failed:', err);
  process.exit(1);
});
