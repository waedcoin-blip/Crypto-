// scripts/e2e-paper-lifecycle-test.ts
import assert from 'node:assert/strict';
import { tradingSupervisor } from '../server/trading/TradingSupervisor.js';
import { tradingEngine } from '../server/trading/TradingEngine.js';
import { positionManager } from '../server/trading/PositionManager.js';
import { positionRepository } from '../server/repositories/PositionRepository.js';
import { tradeRepository } from '../server/repositories/TradeRepository.js';
import { rebuyGuard } from '../server/trading/RebuyGuard.js';
import { unifiedExitEngine } from '../server/trading/UnifiedExitEngine.js';
import { paperWalletLedger } from '../server/wallet/PaperWalletLedger.js';
import { hardenedApprovalStore } from '../server/trading/HardenedApprovalStore.js';
import { HardenedApproval } from '../server/types/index.js';

// Mock Mint for Paper Testing (e.g., BONK / SPL Token)
const MOCK_MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const NETWORK = 'paper';
const WALLET = 'default';

async function runE2ELifecycleTest() {
  console.log('🚀 Starting End-to-End Paper Trading Lifecycle Test...\n');

  // ==========================================
  // PHASE 1: INITIALIZATION
  // ==========================================
  console.log('■ [PHASE 1] Initializing Trading Supervisor (Paper Mode)');
  const startRes = await tradingSupervisor.startTrading({ network: 'paper', wallet: 'default' });
  assert.equal(startRes.state, 'TRADING', 'Supervisor should be in TRADING state');
  console.log('✔ Supervisor started successfully.\n');

  // Clean existing positions & trades for test mint & reset paper wallet & rebuy guard
  const allPositions = positionRepository.getAllPositions();
  for (const pos of allPositions) {
    positionRepository.deletePosition(pos.id);
  }
  positionManager.refreshFromRepository();

  rebuyGuard.clear();
  tradeRepository.clear(NETWORK);

  paperWalletLedger.resetWallet('default');
  paperWalletLedger.addSol(10.0, 'default');

  // ==========================================
  // PHASE 2: EXECUTE BUY WITH HARDENED APPROVAL
  // ==========================================
  console.log('■ [PHASE 2] Executing Paper BUY (0.1 SOL)');
  const now = Date.now();
  const testApproval: HardenedApproval = {
    approvalId: `appr_test_${Date.now()}`,
    chain: 'solana',
    mint: MOCK_MINT,
    criteriaVersion: '1.0.0',
    evaluatedAt: now,
    evaluatedSlot: 100,
    evaluationPrice: 0.00001,
    maxSlotLag: 500,
    maxPriceDeviationPct: 50,
    expiresAt: now + 60000,
    checks: [
      { ruleId: 'MCAP', name: 'Market Cap', status: 'PASS', passed: true },
      { ruleId: 'LIQ', name: 'Liquidity', status: 'PASS', passed: true },
    ],
    decisionHash: 'test_hash',
    correlationId: 'test_corr',
    state: 'ISSUED',
  };
  hardenedApprovalStore.issueApproval(testApproval);

  const buyRes = await tradingEngine.buy({
    network: NETWORK,
    wallet: WALLET,
    mint: MOCK_MINT,
    amountSol: 0.1,
    slippageBps: 250,
    tpPct: 20,   // Take profit at +20%
    slPct: 10,   // Stop loss at -10%
    label: 'e2e_test_buy',
    approval: testApproval,
  });

  assert.equal(buyRes.success, true, `Buy should succeed. Error: ${buyRes.error}`);
  assert.ok(buyRes.positionId, 'Buy should return a positionId');
  console.log(`✔ BUY confirmed. PositionId: ${buyRes.positionId}, Signature: ${buyRes.signature}\n`);

  // ==========================================
  // PHASE 3: VERIFY POSITION STATE
  // ==========================================
  console.log('■ [PHASE 3] Verifying Position State');
  const openPositions = positionManager.getOpenPositions(NETWORK, WALLET);
  assert.equal(openPositions.length, 1, 'Should have exactly 1 open position');
  
  const position = openPositions[0];
  assert.equal(position.mint, MOCK_MINT, 'Position mint should match');
  assert.equal(position.status, 'OPEN', 'Position status should be OPEN');
  assert.ok(position.totalSolSpent > 0, 'Position should have recorded SOL spent');
  console.log(`✔ Position verified. Entry Price: ${position.averageEntryPrice}, Spent: ${position.totalSolSpent} SOL\n`);

  // ==========================================
  // PHASE 4: SIMULATE PRICE PUMP & TRIGGER TP
  // ==========================================
  console.log('■ [PHASE 4] Simulating Price Pump to Trigger Take-Profit (+25%)');
  
  // Inject a fake price pump directly into the valuation engine
  const entryPrice = position.averageEntryPrice;
  const pumpedPrice = entryPrice * 1.25; // +25% (well above the 20% TP threshold)
  
  // Update position price manually to simulate market feed
  positionManager.updatePositionPrice(NETWORK, WALLET, MOCK_MINT, pumpedPrice, { isMarketEvent: true });
  
  // Evaluate exit conditions
  const exitDecision = unifiedExitEngine.evaluatePositionExit(position, pumpedPrice);
  assert.equal(exitDecision.shouldExit, true, 'Exit should be triggered');
  assert.equal(exitDecision.reason, 'TP', 'Exit reason should be Take Profit (TP)');
  console.log(`✔ TP Triggered! PnL: ${exitDecision.currentPnlPct.toFixed(2)}%, Reason: ${exitDecision.reason}\n`);

  // ==========================================
  // PHASE 5: EXECUTE EXIT & VERIFY CLOSURE
  // ==========================================
  console.log('■ [PHASE 5] Executing Exit via UnifiedExitEngine');
  const exitRes = await unifiedExitEngine.evaluateAndExecuteExit(position, pumpedPrice);
  assert.equal(exitRes.success, true, `Exit should succeed. Error: ${exitRes.error}`);
  console.log(`✔ SELL confirmed. Signature: ${exitRes.signature}\n`);

  // Verify position is closed
  const closedPositions = positionManager.getOpenPositions(NETWORK, WALLET);
  assert.equal(closedPositions.length, 0, 'Should have 0 open positions after exit');
  
  const finalPosition = positionManager.getPositionById(position.id);
  assert.equal(finalPosition?.status, 'CLOSED', 'Position status should be CLOSED');
  assert.ok((finalPosition?.realizedPnl ?? 0) >= 0, 'Realized PnL should be recorded');
  console.log(`✔ Position closed. Realized PnL: ${finalPosition?.realizedPnl.toFixed(6)} SOL\n`);

  // ==========================================
  // CLEANUP
  // ==========================================
  await tradingSupervisor.stopTrading();
  console.log('🎉 ALL END-TO-END PAPER LIFECYCLE TESTS PASSED SUCCESSFULLY!\n');
  process.exit(0);
}

runE2ELifecycleTest().catch((err) => {
  console.error('❌ FATAL TEST ERROR:', err);
  process.exit(1);
});
