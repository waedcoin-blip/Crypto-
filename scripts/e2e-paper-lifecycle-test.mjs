// scripts/e2e-paper-lifecycle-test.mjs
// End-to-End Paper Trading Lifecycle Test
// Tests: BUY → Position → Price Pump → TP Trigger → SELL → Close → PnL
//
// Run: node scripts/e2e-paper-lifecycle-test.mjs

import assert from 'node:assert/strict';

// ==========================================
// DYNAMIC IMPORTS (avoids circular dependency issues)
// ==========================================

const { tradingSupervisor } = await import('../server/trading/TradingSupervisor.js');
const { tradingEngine } = await import('../server/trading/TradingEngine.js');
const { positionManager } = await import('../server/trading/PositionManager.js');
const { unifiedExitEngine } = await import('../server/trading/UnifiedExitEngine.js');
const { positionValuationEngine } = await import('../server/trading/PositionValuationEngine.js');
const { paperWalletLedger } = await import('../server/wallet/PaperWalletLedger.js');
const { rebuyGuard } = await import('../server/trading/RebuyGuard.js');
const { orderManager } = await import('../server/trading/OrderManager.js');
const { pnlEngine } = await import('../server/trading/PnLEngine.js');

// ==========================================
// TEST CONFIGURATION
// ==========================================

const TEST_MINT = 'TestMint111111111111111111111111111111111111';
const NETWORK = 'paper';
const WALLET = 'default';
const BUY_AMOUNT_SOL = 0.1;
const TP_PCT = 20;   // Take profit at +20%
const SL_PCT = 10;   // Stop loss at -10%

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ PASSED: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAILED: ${name}`);
    console.error(`     Error: ${err.message}`);
    failed++;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  ✅ PASSED: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAILED: ${name}`);
    console.error(`     Error: ${err.message}`);
    failed++;
  }
}

// ==========================================
// PHASE 0: ENVIRONMENT SETUP
// ==========================================

console.log('\n🚀 ARINA X-RAY — E2E Paper Trading Lifecycle Test\n');
console.log('■ [PHASE 0] Environment Setup');

// Ensure paper mode environment
process.env.IS_LIVE_TRADING = 'false';
process.env.AUTO_SNIPER_ENABLED = 'false';
process.env.DEFAULT_NETWORK = 'paper';

// Reset paper wallet and clear paper trade records for clean test
paperWalletLedger.resetWallet(WALLET);
const { tradeRepository } = await import('../server/repositories/TradeRepository.js');
tradeRepository.clear(NETWORK);
rebuyGuard.clear();

test('Paper wallet initialized with 10 SOL', () => {
  const balance = paperWalletLedger.getSolBalance(WALLET);
  assert.ok(Math.abs(balance - 10.0) < 0.001, `Expected 10 SOL, got ${balance}`);
});

// ==========================================
// PHASE 1: TRADING SUPERVISOR STARTUP
// ==========================================

console.log('\n■ [PHASE 1] Trading Supervisor Startup');

await testAsync('Supervisor starts in paper mode', async () => {
  const startRes = await tradingSupervisor.startTrading({
    network: 'paper',
    wallet: WALLET,
    isLiveTrading: false,
  });

  assert.equal(startRes.state, 'TRADING', `Expected TRADING, got ${startRes.state}`);
  assert.equal(startRes.network, 'paper', `Expected paper network, got ${startRes.network}`);
  assert.equal(startRes.isLiveTrading, false, 'Should not be live trading');
});

test('Supervisor health map shows all components ready', () => {
  const status = tradingSupervisor.getStatus();
  assert.equal(status.healthMap.wallet, 'READY', 'Wallet should be READY');
  assert.equal(status.healthMap.criteriaEngine, 'READY', 'Criteria engine should be READY');
  assert.equal(status.healthMap.positionManager, 'READY', 'Position manager should be READY');
});

// ==========================================
// PHASE 2: EXECUTE BUY
// ==========================================

console.log('\n■ [PHASE 2] Execute Paper BUY');

let positionId = null;
let buySignature = null;

await testAsync('TradingEngine.buy() succeeds in paper mode', async () => {
  const buyRes = await tradingEngine.buy({
    network: NETWORK,
    wallet: WALLET,
    mint: TEST_MINT,
    amountSol: BUY_AMOUNT_SOL,
    decimals: 6,
    slippageBps: 250,
    tpPct: TP_PCT,
    slPct: SL_PCT,
    maxRebuyTimes: 1,
    tradeOnlyOnce: true,
    label: 'e2e_test_buy',
  });

  // DEBUG: Print full response if failed
  if (!buyRes.success) {
    console.error(`     Buy response:`, JSON.stringify(buyRes, null, 2));
  }

  assert.equal(buyRes.success, true, `Buy should succeed. Error: ${buyRes.error}`);
  assert.ok(buyRes.orderId, 'Buy should return orderId');
  assert.ok(buyRes.positionId, 'Buy should return positionId');
  assert.ok(buyRes.signature, 'Buy should return signature');

  positionId = buyRes.positionId;
  buySignature = buyRes.signature;
});

// ==========================================
// PHASE 3: VERIFY POSITION STATE
// ==========================================

console.log('\n■ [PHASE 3] Verify Position State');

test('Position exists and is OPEN', () => {
  const pos = positionManager.getPosition(NETWORK, WALLET, TEST_MINT);
  assert.ok(pos, 'Position should exist');
  assert.equal(pos.status, 'OPEN', `Position status should be OPEN, got ${pos.status}`);
  assert.equal(pos.mint, TEST_MINT, 'Position mint should match');
  assert.ok(pos.totalSolSpent > 0, 'Position should have recorded SOL spent');
  assert.ok(pos.tokenAmount > 0, 'Position should have token amount');
  assert.ok(pos.averageEntryPrice > 0, 'Position should have entry price');
});

test('Position has correct TP/SL configuration', () => {
  const pos = positionManager.getPosition(NETWORK, WALLET, TEST_MINT);
  assert.equal(pos.tpPct, TP_PCT, `TP should be ${TP_PCT}%`);
  assert.equal(pos.slPct, SL_PCT, `SL should be ${SL_PCT}%`);
});

test('Paper wallet SOL decreased after buy', () => {
  const balance = paperWalletLedger.getSolBalance(WALLET);
  assert.ok(balance < 10.0, `Balance should be less than 10 SOL after buy, got ${balance}`);
  assert.ok(Math.abs(balance - (10.0 - BUY_AMOUNT_SOL)) < 0.01,
    `Balance should be ~${10.0 - BUY_AMOUNT_SOL} SOL, got ${balance}`);
});

test('Order was created and filled', () => {
  const orders = orderManager.getOrders();
  const buyOrder = orders.find(o => o.mint === TEST_MINT && o.side === 'buy');
  assert.ok(buyOrder, 'Buy order should exist');
  assert.equal(buyOrder.status, 'FILLED', `Order should be FILLED, got ${buyOrder.status}`);
});

test('RebuyGuard allows only 1 buy (tradeOnlyOnce)', () => {
  const guardState = rebuyGuard.getGuardState(NETWORK, WALLET, TEST_MINT);
  assert.equal(guardState.completedBuyCount, 1, 'Should have 1 completed buy');
  assert.equal(guardState.isReserved, false, 'Should not be reserved after completion');
});

// ==========================================
// PHASE 4: SIMULATE PRICE PUMP → TP TRIGGER
// ==========================================

console.log('\n■ [PHASE 4] Simulate Price Pump (+25%) → TP Trigger');

const pos = positionManager.getPosition(NETWORK, WALLET, TEST_MINT);
const entryPrice = pos.averageEntryPrice;
const pumpedPrice = entryPrice * 1.25; // +25% (above 20% TP threshold)

test('Price update propagates to position', () => {
  const updated = positionManager.updatePositionPrice(
    NETWORK, WALLET, TEST_MINT, pumpedPrice,
    { isMarketEvent: true, timestamp: Date.now() }
  );
  assert.ok(updated, 'Position should be updated');
  assert.ok(Math.abs(updated.currentPriceSol - pumpedPrice) < 0.000001,
    'Current price should match pumped price');
});

test('Unrealized PnL is positive after pump', () => {
  const pos = positionManager.getPosition(NETWORK, WALLET, TEST_MINT);
  assert.ok(pos.unrealizedPnl > 0, `Unrealized PnL should be positive, got ${pos.unrealizedPnl}`);
  assert.ok(pos.unrealizedPnlPct > 0, `Unrealized PnL% should be positive, got ${pos.unrealizedPnlPct}`);
});

test('Exit decision triggers TP', () => {
  const exitDecision = unifiedExitEngine.evaluatePositionExit(pos, pumpedPrice);
  assert.equal(exitDecision.shouldExit, true, 'Exit should be triggered');
  assert.equal(exitDecision.reason, 'TP', `Exit reason should be TP, got ${exitDecision.reason}`);
  assert.ok(exitDecision.currentPnlPct >= TP_PCT,
    `PnL% should be >= ${TP_PCT}%, got ${exitDecision.currentPnlPct}%`);
});

// ==========================================
// PHASE 5: EXECUTE EXIT
// ==========================================

console.log('\n■ [PHASE 5] Execute Exit via UnifiedExitEngine');

let exitSignature = null;

await testAsync('UnifiedExitEngine executes sell successfully', async () => {
  const exitRes = await unifiedExitEngine.evaluateAndExecuteExit(pos, pumpedPrice);

  if (!exitRes.success) {
    console.error(`     Exit response:`, JSON.stringify(exitRes, null, 2));
  }

  assert.equal(exitRes.success, true, `Exit should succeed. Error: ${exitRes.error}`);
  assert.ok(exitRes.signature, 'Exit should return signature');
  exitSignature = exitRes.signature;
});

// ==========================================
// PHASE 6: VERIFY POSITION CLOSURE
// ==========================================

console.log('\n■ [PHASE 6] Verify Position Closure');

test('Position is CLOSED after exit', () => {
  const closedPos = positionManager.getPositionById(positionId);
  assert.ok(closedPos, 'Position should still exist in memory');
  assert.equal(closedPos.status, 'CLOSED', `Position should be CLOSED, got ${closedPos.status}`);
  assert.ok(closedPos.closedAt > 0, 'Position should have closedAt timestamp');
});

test('Realized PnL is positive', () => {
  const closedPos = positionManager.getPositionById(positionId);
  assert.ok(closedPos.realizedPnl > 0,
    `Realized PnL should be positive, got ${closedPos.realizedPnl}`);
});

test('Position no longer appears in open positions', () => {
  const openPositions = positionManager.getOpenPositions(NETWORK, WALLET);
  const found = openPositions.find(p => p.mint === TEST_MINT);
  assert.equal(found, undefined, 'Closed position should not appear in open positions');
});

test('Paper wallet SOL increased after sell', () => {
  const balance = paperWalletLedger.getSolBalance(WALLET);
  // After buy (-0.1) and sell (+~0.125), balance should be > 9.9
  assert.ok(balance > 9.9, `Balance should be > 9.9 SOL after profitable trade, got ${balance}`);
});

test('Valuation record was purged after close', () => {
  const valuation = positionValuationEngine.getValuation(NETWORK, WALLET, TEST_MINT);
  assert.equal(valuation, null, 'Valuation should be removed after position close');
});

// ==========================================
// PHASE 7: PNL ENGINE VERIFICATION
// ==========================================

console.log('\n■ [PHASE 7] PnL Engine Verification');

test('PnL engine calculates correct metrics', () => {
  const closedPos = positionManager.getPositionById(positionId);
  const metrics = pnlEngine.calculatePnL(closedPos, pumpedPrice);

  assert.ok(metrics.tokenQuantity > 0, 'Token quantity should be positive');
  assert.ok(metrics.totalSolSpent > 0, 'Total SOL spent should be positive');
  assert.ok(metrics.currentValueSol > 0, 'Current value should be positive');
});

// ==========================================
// PHASE 8: REBUY GUARD BLOCKING SECOND BUY
// ==========================================

console.log('\n■ [PHASE 8] Rebuy Guard Blocks Second Buy');

await testAsync('Second buy is blocked by RebuyGuard (tradeOnlyOnce)', async () => {
  const secondBuyRes = await tradingEngine.buy({
    network: NETWORK,
    wallet: WALLET,
    mint: TEST_MINT,
    amountSol: BUY_AMOUNT_SOL,
    decimals: 6,
    maxRebuyTimes: 1,
    tradeOnlyOnce: true,
    label: 'e2e_test_second_buy',
  });

  assert.equal(secondBuyRes.success, false, 'Second buy should be blocked');
  assert.ok(
    secondBuyRes.error.includes('REBUY') || secondBuyRes.error.includes('rebuy'),
    `Error should mention rebuy guard, got: ${secondBuyRes.error}`
  );
});

// ==========================================
// PHASE 9: SUPERVISOR SHUTDOWN
// ==========================================

console.log('\n■ [PHASE 9] Supervisor Shutdown');

await testAsync('Supervisor stops cleanly', async () => {
  const stopRes = await tradingSupervisor.stopTrading();
  assert.equal(stopRes.state, 'STOPPED', `Expected STOPPED, got ${stopRes.state}`);
});

// ==========================================
// RESULTS
// ==========================================

console.log('\n' + '='.repeat(50));
console.log(`📊 RESULTS: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

// Force cleanup of any lingering intervals
const intervals = setInterval(() => {}, 1000);
clearInterval(intervals);

// Give async operations time to complete, then force exit
setTimeout(() => {
  process.exit(failed > 0 ? 1 : 0);
}, 2000);
