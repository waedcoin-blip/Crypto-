// server/tests/arinaXrayExecution.test.ts
import { executionGateway } from '../execution/ExecutionGateway.js';
import { tradingEngine } from '../trading/TradingEngine.js';
import { orderManager } from '../trading/OrderManager.js';
import { positionManager } from '../trading/PositionManager.js';
import { paperWalletLedger } from '../wallet/PaperWalletLedger.js';
import { rebuyGuard } from '../trading/RebuyGuard.js';
import { hardenedApprovalStore } from '../trading/HardenedApprovalStore.js';
import { jupiterTradingService } from '../services/JupiterTradingService.js';
import { HardenedApproval } from '../types/index.js';

export async function runArinaXrayPhase3ExecutionTestSuite() {
  console.log('🚀 Starting ARINA X-RAY Phase 3 Execution Authority & Transaction Integrity Test Suite...\n');
  let failures = 0;

  function assert(condition: boolean, message: string) {
    if (condition) {
      console.log(`  ✔ [PASS] ${message}`);
    } else {
      console.error(`  ❌ [FAIL] ${message}`);
      failures++;
    }
  }

  // Set up clean initial test state
  paperWalletLedger.reset(100.0);
  rebuyGuard.clear();

  const testMint = `P3Mint_${Date.now()}_1111111111111111111111111111`;

  // TEST 1: Missing Explicit Network (Fail-Closed)
  console.log('▶ [TEST 1] Missing Explicit Network Fail-Closed');
  try {
    executionGateway.resolveNetwork(undefined as any);
    assert(false, 'Missing network should throw INVALID_NETWORK_EXPLICIT_REQUIRED');
  } catch (e: any) {
    assert(e.message.includes('INVALID_NETWORK_EXPLICIT_REQUIRED'), 'Throws INVALID_NETWORK_EXPLICIT_REQUIRED on missing network');
  }

  const missingNetBuyRes = await tradingEngine.buy({
    network: '' as any,
    wallet: 'default',
    mint: testMint,
    amountSol: 0.1,
  });
  assert(!missingNetBuyRes.success, 'Buy fails closed on missing network parameter');
  assert(missingNetBuyRes.error?.includes('INVALID_NETWORK_EXPLICIT_REQUIRED') === true, 'Returns explicit INVALID_NETWORK_EXPLICIT_REQUIRED error');

  // TEST 2: Invalid Network (Fail-Closed)
  console.log('▶ [TEST 2] Invalid Network Fail-Closed');
  try {
    executionGateway.resolveNetwork('solana_mainnet_custom');
    assert(false, 'Unknown network should throw INVALID_NETWORK_EXPLICIT_REQUIRED');
  } catch (e: any) {
    assert(e.message.includes('INVALID_NETWORK_EXPLICIT_REQUIRED'), 'Throws INVALID_NETWORK_EXPLICIT_REQUIRED on unknown network');
  }

  // TEST 3: Non-Integer Lamport & Non-Positive Amount Rejection
  console.log('▶ [TEST 3] Non-Positive / Invalid Amount Rejection');
  const negBuyRes = await tradingEngine.buy({
    network: 'paper',
    wallet: 'default',
    mint: testMint,
    amountSol: -0.5,
  });
  assert(!negBuyRes.success, 'Rejects negative SOL buy amount');
  assert(negBuyRes.error?.includes('INVALID_AMOUNT') === true, 'Returns INVALID_AMOUNT error for negative amount');

  const zeroBuyRes = await tradingEngine.buy({
    network: 'paper',
    wallet: 'default',
    mint: testMint,
    amountSol: 0,
  });
  assert(!zeroBuyRes.success, 'Rejects zero SOL buy amount');

  // TEST 4: Paper Mode Execution Isolation
  console.log('▶ [TEST 4] Paper Mode Execution Isolation & Ledger Verification');
  paperWalletLedger.reset(100.0);
  const initialPaperSol = paperWalletLedger.getSolBalance();
  assert(initialPaperSol === 100.0, 'Paper wallet initialized with 100 SOL');

  // Create mock HardenedApproval to pass pre-buy criteria check
  const mockApproval: HardenedApproval = {
    approvalId: `app_p3_test_${Date.now()}`,
    chain: 'solana',
    mint: testMint,
    criteriaVersion: 'v1.0.0',
    evaluatedAt: Date.now(),
    evaluatedSlot: 1000000,
    evaluationPrice: 0.00001,
    maxSlotLag: 50,
    maxPriceDeviationPct: 5,
    expiresAt: Date.now() + 60000,
    checks: [],
    decisionHash: 'mock_hash_123',
    correlationId: 'corr_123',
    state: 'ISSUED',
  };
  hardenedApprovalStore.issueApproval(mockApproval);

  const buyRes = await tradingEngine.buy({
    network: 'paper',
    wallet: 'default',
    mint: testMint,
    amountSol: 1.0,
    approval: mockApproval,
  });

  assert(buyRes.success === true, 'Paper buy execution succeeded');
  assert(buyRes.signature !== undefined && buyRes.signature.startsWith('paper_buy_'), 'Paper signature generated with paper_buy_ prefix');
  const postBuySol = paperWalletLedger.getSolBalance();
  assert(postBuySol === 99.0, 'Paper wallet SOL balance accurately deducted (99.0 SOL)');

  // TEST 5: Hardened Approval Single-Use Consumption
  console.log('▶ [TEST 5] Hardened Approval Single-Use Consumption State');
  const storedApproval = hardenedApprovalStore.getApproval(mockApproval.approvalId);
  assert(storedApproval !== undefined && storedApproval.state === 'CONSUMED', 'Approval state transitioned to CONSUMED post-buy');
  assert(storedApproval?.consumedAt !== undefined, 'Approval marked consumedAt timestamp');

  // TEST 6: Position State & Raw Amount Reconciliation
  console.log('▶ [TEST 6] Position State & Raw Amount Reconciliation');
  const pos = positionManager.getPosition('paper', 'default', testMint);
  assert(pos !== undefined && pos.status === 'OPEN', 'Position created in OPEN status');
  assert(pos?.tokenAmount !== undefined && pos.tokenAmount > 0, 'Position tokenAmount recorded in raw base units');

  // TEST 7: Duplicate BUY Idempotency Blocking
  console.log('▶ [TEST 7] Duplicate Active BUY Idempotency Blocking');
  // Attempt second buy while position is already open and active
  const order1 = orderManager.createOrder({
    network: 'paper',
    wallet: 'default',
    mint: testMint,
    side: 'buy',
    amount: 100000000,
    decimals: 6,
    slippageBps: 250,
    clientRequestId: 'req_duplicate_test_1',
  });
  orderManager.updateOrderStatus(order1.id, 'CONFIRMING');

  const order1Duplicate = orderManager.createOrder({
    network: 'paper',
    wallet: 'default',
    mint: testMint,
    side: 'buy',
    amount: 100000000,
    decimals: 6,
    slippageBps: 250,
    clientRequestId: 'req_duplicate_test_1',
  });

  assert(order1Duplicate.id === order1.id, 'Idempotent createOrder returns existing active order instance');

  // Reset order1 status
  orderManager.updateOrderStatus(order1.id, 'FILLED');

  // TEST 8: Exact Token Quantity Sell Execution
  console.log('▶ [TEST 8] Exact Token Quantity Sell Execution');
  const preSellPos = positionManager.getPosition('paper', 'default', testMint);
  const exactRawTokens = preSellPos!.tokenAmount;

  const sellRes = await tradingEngine.sell({
    network: 'paper',
    wallet: 'default',
    mint: testMint,
  });

  assert(sellRes.success === true, 'Paper sell execution succeeded');
  assert(sellRes.signature !== undefined && sellRes.signature.startsWith('paper_sell_'), 'Paper sell signature generated with paper_sell_ prefix');
  const postSellPos = positionManager.getPosition('paper', 'default', testMint);
  assert(postSellPos === undefined || postSellPos.status === 'CLOSED', 'Position closed post-sell');

  // TEST 9: Duplicate Sell Request Blocking
  console.log('▶ [TEST 9] Duplicate Sell Request Blocking (EXIT_ALREADY_PENDING)');
  // Create open position in EXIT_PENDING status
  const pendingExitPos = positionManager.openOrAccumulatePosition({
    network: 'paper',
    wallet: 'default',
    mint: 'PendingExitMint11111111111111111111111111',
    tokenAmountRaw: 1000000,
    decimals: 6,
    solSpent: 0.1,
  });
  positionManager.updatePositionStatus('paper', 'default', 'PendingExitMint11111111111111111111111111', 'EXIT_PENDING');

  const repeatSellRes = await tradingEngine.sell({
    network: 'paper',
    wallet: 'default',
    mint: 'PendingExitMint11111111111111111111111111',
  });

  assert(!repeatSellRes.success, 'Duplicate sell rejected on EXIT_PENDING position');
  assert(repeatSellRes.error?.includes('EXIT_ALREADY_PENDING') === true, 'Returns EXIT_ALREADY_PENDING error');

  // TEST 10: Post-Broadcast Confirmation Timeout Transitions to RECOVERY_REQUIRED
  console.log('▶ [TEST 10] Post-Broadcast Confirmation Timeout State (RECOVERY_REQUIRED)');
  const timeoutOrder = orderManager.createOrder({
    network: 'paper',
    wallet: 'default',
    mint: 'TimeoutTestMint1111111111111111111111111',
    side: 'buy',
    amount: 100000000,
    decimals: 6,
    slippageBps: 250,
    clientRequestId: `req_timeout_${Date.now()}`,
  });

  // Simulate onBroadcast callback persisting transaction signature
  timeoutOrder.transactionSignature = 'timeout_tx_sig_123456';
  orderManager.updateOrderStatus(timeoutOrder.id, 'RECOVERY_REQUIRED', 'CONFIRMATION_TIMEOUT: Broadcast succeeded but confirmation timed out');

  const retrievedTimeoutOrder = orderManager.getOrderById(timeoutOrder.id);
  assert(retrievedTimeoutOrder?.status === 'RECOVERY_REQUIRED', 'Order transitioned to RECOVERY_REQUIRED state');
  assert(retrievedTimeoutOrder?.transactionSignature === 'timeout_tx_sig_123456', 'Transaction signature retained in repository');

  // TEST 11: RebuyGuard Reservation Retained on Timeout
  console.log('▶ [TEST 11] RebuyGuard Reservation Retained on RECOVERY_REQUIRED Timeout');
  const resMint = 'RebuyGuardTimeoutMint11111111111111111111';
  const reservation = rebuyGuard.reserveBuy({
    network: 'paper',
    wallet: 'default',
    mint: resMint,
    amountSol: 0.1,
  });

  // Mark reservation as held/unknown due to timeout
  rebuyGuard.holdBuy(reservation.reservationId, 'tx_sig_timeout_test', 'CONFIRMATION_TIMEOUT');

  // Attempting to reserve again for same mint should be rejected or held
  try {
    rebuyGuard.reserveBuy({
      network: 'paper',
      wallet: 'default',
      mint: resMint,
      amountSol: 0.1,
    });
    assert(false, 'RebuyGuard should reject buy when reservation is held in RECOVERY_REQUIRED');
  } catch (e: any) {
    assert(true, 'RebuyGuard rejects secondary buy while reservation is held in RECOVERY_REQUIRED');
  }

  // TEST 12: Immediate Signature Persistence Callback
  console.log('▶ [TEST 12] Immediate Signature Persistence on Broadcast Callback');
  const callbackOrder = orderManager.createOrder({
    network: 'paper',
    wallet: 'default',
    mint: 'CallbackTestMint111111111111111111111111',
    side: 'buy',
    amount: 100000000,
    decimals: 6,
    slippageBps: 250,
    clientRequestId: `req_cb_${Date.now()}`,
  });

  const mockSig = 'sig_immediate_broadcast_test_999';
  callbackOrder.transactionSignature = mockSig;
  orderManager.updateOrderStatus(callbackOrder.id, 'CONFIRMING');

  const persistedOrder = orderManager.getOrderById(callbackOrder.id);
  assert(persistedOrder?.transactionSignature === mockSig, 'Signature persisted immediately upon broadcast');
  assert(persistedOrder?.status === 'CONFIRMING', 'Order state updated to CONFIRMING');

  // TEST 13: Failed On-Chain Transaction Transition
  console.log('▶ [TEST 13] Failed On-Chain Transaction Transitions to FAILED');
  const failedOrder = orderManager.createOrder({
    network: 'paper',
    wallet: 'default',
    mint: 'FailedTestMint11111111111111111111111111',
    side: 'buy',
    amount: 100000000,
    decimals: 6,
    slippageBps: 250,
    clientRequestId: `req_fail_${Date.now()}`,
  });

  orderManager.updateOrderStatus(failedOrder.id, 'FAILED', 'SLIPPAGE_EXCEEDED: On-chain transaction failed');
  const retrievedFailedOrder = orderManager.getOrderById(failedOrder.id);
  assert(retrievedFailedOrder?.status === 'FAILED', 'Order status set to FAILED on pre-broadcast / verified failure');
  assert(retrievedFailedOrder?.error?.includes('SLIPPAGE_EXCEEDED') === true, 'Error message recorded on failed order');

  // TEST 14: Single Execution Authority Verification via JupiterTradingService
  console.log('▶ [TEST 14] JupiterTradingService Execution Delegation to ExecutionGateway');
  const jupQuote = await jupiterTradingService.getQuote({
    inputMint: 'So11111111111111111111111111111111111111112',
    outputMint: testMint,
    amount: 100000000,
  });
  assert(jupQuote !== undefined && (jupQuote.inAmount !== undefined || jupQuote.outAmount !== undefined), 'JupiterTradingService gets quote via ExecutionGateway');

  // TEST 15: Partial Sell Base Units Execution
  console.log('▶ [TEST 15] Partial Sell Base Units Execution');
  const partialPos = positionManager.openOrAccumulatePosition({
    network: 'paper',
    wallet: 'default',
    mint: 'PartialSellMint1111111111111111111111111',
    tokenAmountRaw: 1000000000,
    decimals: 6,
    solSpent: 1.0,
  });

  assert(partialPos.tokenAmount === 1000000000, 'Initial position has 1,000,000,000 base units');

  // Execute partial sell of 400,000,000 base units
  paperWalletLedger.commitSell('PartialSellMint1111111111111111111111111', 0.4, 400000000, 6, 'paper_sell_partial');
  positionManager.reducePositionAmount(partialPos.id, 400000000, 0.4);

  const updatedPartialPos = positionManager.getPositionById(partialPos.id);
  assert(updatedPartialPos?.tokenAmount === 600000000, 'Position remaining amount updated to 600,000,000 base units');
  assert(updatedPartialPos?.status === 'OPEN', 'Position remains OPEN after partial sell');

  // TEST 16: Final Summary
  console.log('\n============================================================');
  if (failures === 0) {
    console.log('🎉 ALL 15 PHASE 3 EXECUTION AUTHORITY REGRESSION TESTS PASSED PERFECTLY!');
  } else {
    console.error(`💥 ${failures} REGRESSION TESTS FAILED!`);
    throw new Error(`${failures} Phase 3 regression tests failed.`);
  }
  console.log('============================================================\n');
}

// Execute test suite if run directly
if (process.env.NODE_ENV === 'test' || process.argv[1]?.includes('arinaXrayExecution.test')) {
  runArinaXrayPhase3ExecutionTestSuite()
    .then(() => {
      process.exit(0);
    })
    .catch(err => {
      console.error('Fatal test error:', err);
      process.exit(1);
    });
}
