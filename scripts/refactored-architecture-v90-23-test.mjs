// scripts/refactored-architecture-v90-23-test.mjs
if (typeof globalThis.window === 'undefined') {
  globalThis.window = globalThis;
}

async function runTestSuite() {
  const { tradingEngine } = await import('../server/trading/TradingEngine.js');
  const { orderManager } = await import('../server/trading/OrderManager.js');
  const { positionManager } = await import('../server/trading/PositionManager.js');
  const { rebuyGuard } = await import('../server/trading/RebuyGuard.js');
  const { pnlEngine } = await import('../server/trading/PnLEngine.js');
  const { yellowstoneConnectionManager } = await import('../server/market/YellowstoneConnectionManager.js');
  const { walletManager } = await import('../server/wallet/WalletManager.js');

  console.log('🚀 Running Refactored Architecture V90.23 Integration Suite...\n');

  // TEST 1: Wallet Isolation (Devnet Wallet A vs Devnet Wallet B vs Paper)
  console.log('▶ [TEST 1] Multi-Wallet & Multi-Network Isolation');
  const paperAcc = walletManager.getAccount('paper:default');
  const devnetA = walletManager.getAccount('devnet:wallet_a');
  const devnetB = walletManager.getAccount('devnet:wallet_b');
  const mainnetAcc = walletManager.getAccount('mainnet:default');

  if (!paperAcc || !devnetA || !devnetB || !mainnetAcc) {
    throw new Error('FAIL: Wallet identities missing');
  }
  console.log('  ✔ All wallet identities (Paper, Devnet A, Devnet B, Mainnet) verified');

  // TEST 2: RebuyGuard Atomic Reservation & Failure Release
  console.log('▶ [TEST 2] RebuyGuard Atomic Reservation & Release');
  const testMint = 'TESTMINT11111111111111111111111111111111111';
  const res = rebuyGuard.reserveBuy({
    network: 'paper',
    wallet: 'default',
    mint: testMint,
    amountSol: 0.1,
    maxRebuyTimes: 1, // 2 total allowed
  });

  if (!res || !res.reservationId) {
    throw new Error('FAIL: RebuyGuard reservation failed');
  }

  // Attempt second buy while reservation active
  const checkConflict = rebuyGuard.canBuy({
    network: 'paper',
    wallet: 'default',
    mint: testMint,
    maxRebuyTimes: 1,
  });

  if (checkConflict.allowed) {
    throw new Error('FAIL: RebuyGuard allowed concurrent buy while reservation active');
  }
  console.log('  ✔ Atomic reservation blocked concurrent buy request');

  // Release reservation (simulating execution failure)
  rebuyGuard.releaseBuy(res.reservationId);
  const checkRetry = rebuyGuard.canBuy({
    network: 'paper',
    wallet: 'default',
    mint: testMint,
    maxRebuyTimes: 1,
  });

  if (!checkRetry.allowed) {
    throw new Error('FAIL: RebuyGuard failed to release reservation on failure');
  }
  console.log('  ✔ Release on failure cleanly unblocked future retry');

  // TEST 3: TradingEngine Centralized BUY & Position Creation
  console.log('▶ [TEST 3] TradingEngine Centralized BUY & Position Lifecycle');
  const buyRes = await tradingEngine.buy({
    network: 'paper',
    wallet: 'default',
    mint: testMint,
    amountSol: 0.1,
    tpPct: 20,
    slPct: 10,
    maxRebuyTimes: 1,
  });

  if (!buyRes.success || !buyRes.positionId) {
    throw new Error(`FAIL: TradingEngine buy failed: ${buyRes.error}`);
  }

  const pos = positionManager.getPosition('paper', 'default', testMint);
  if (!pos || pos.status !== 'OPEN' || pos.tokenAmount <= 0) {
    throw new Error('FAIL: Position not properly created or marked OPEN');
  }
  console.log(`  ✔ BUY executed cleanly, position ${pos.id} created with ${pos.tokenAmount} tokens`);

  // TEST 4: Rebuy via TradingEngine
  console.log('▶ [TEST 4] TradingEngine REBUY & Position Accumulation');
  const rebuyRes = await tradingEngine.rebuy({
    network: 'paper',
    wallet: 'default',
    mint: testMint,
    amountSol: 0.1,
    maxRebuyTimes: 1, // Max 1 rebuy (2 total buys)
  });

  if (!rebuyRes.success) {
    throw new Error(`FAIL: Rebuy failed: ${rebuyRes.error}`);
  }

  const accumulatedPos = positionManager.getPosition('paper', 'default', testMint);
  if (accumulatedPos.tokenAmount <= pos.tokenAmount || accumulatedPos.totalSolSpent <= 0.1) {
    throw new Error('FAIL: Position cost basis accumulation failed');
  }
  console.log(`  ✔ REBUY accumulated cost basis to ${accumulatedPos.totalSolSpent.toFixed(2)} SOL`);

  // Attempt 3rd buy (exceeding maxRebuyTimes = 1)
  const thirdBuyRes = await tradingEngine.buy({
    network: 'paper',
    wallet: 'default',
    mint: testMint,
    amountSol: 0.1,
    maxRebuyTimes: 1,
  });

  if (thirdBuyRes.success) {
    throw new Error('FAIL: RebuyGuard allowed exceeding maxRebuyTimes');
  }
  console.log('  ✔ RebuyGuard strictly enforced maxRebuyTimes boundary');

  // TEST 5: Authoritative PnL Calculation
  console.log('▶ [TEST 5] Authoritative PnLEngine Calculation');
  const pnl = pnlEngine.calculatePnL(accumulatedPos, accumulatedPos.averageEntryPrice * 1.5);
  if (pnl.unrealizedPnlPercent < 45 || pnl.unrealizedPnlPercent > 55) {
    throw new Error(`FAIL: PnLEngine returned wrong unrealized PnL %: ${pnl.unrealizedPnlPercent}`);
  }
  console.log(`  ✔ PnLEngine calculated +50% price move as +${pnl.unrealizedPnlPercent.toFixed(2)}% net unrealized PnL`);

  // TEST 6: TradingEngine SELL Execution & Position Closure
  console.log('▶ [TEST 6] TradingEngine Centralized SELL & Position Closure');
  const sellRes = await tradingEngine.sell({
    network: 'paper',
    wallet: 'default',
    mint: testMint,
    reason: 'TP',
  });

  if (!sellRes.success) {
    throw new Error(`FAIL: TradingEngine sell failed: ${sellRes.error}`);
  }

  const closedPos = positionManager.getPosition('paper', 'default', testMint);
  if (closedPos) {
    throw new Error('FAIL: Closed position still returned as active by position key');
  }
  console.log('  ✔ SELL executed cleanly, position closed and removed from active key registry');

  // TEST 7: Yellowstone Connection Telemetry
  console.log('▶ [TEST 7] Yellowstone gRPC Telemetry');
  const telemetry = yellowstoneConnectionManager.getTelemetry();
  if (telemetry.network !== 'mainnet') {
    throw new Error('FAIL: Yellowstone telemetry network invalid');
  }
  console.log(`  ✔ Yellowstone telemetry active for ${telemetry.network}`);

  console.log('\n🎉 ALL REFACTORED ARCHITECTURE V90.23 TESTS PASSED SUCCESSFULLY! ✅');
}

runTestSuite().catch((err) => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
});
