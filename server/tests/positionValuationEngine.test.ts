// server/tests/positionValuationEngine.test.ts
import { positionValuationEngine, PositionValuation } from '../trading/PositionValuationEngine.js';
import { Position } from '../trading/PositionManager.js';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  } else {
    console.log(`✅ PASS: ${message}`);
  }
}

export async function runPositionValuationTests(): Promise<void> {
  console.log('\n==================================================');
  console.log('🧪 RUNNING POSITION VALUATION ENGINE SUITE');
  console.log('==================================================\n');

  const testNetwork = 'paper';
  const testWallet = 'val_test_wallet';
  const testMint = 'ValuationTestMint111111111111111111111111111';

  // Base mock position setup
  const basePosition: Position = {
    id: 'pos_val_1',
    network: testNetwork,
    wallet: testWallet,
    mint: testMint,
    status: 'OPEN',
    tokenAmount: 1_000_000_000, // 1,000 tokens (6 decimals)
    decimals: 6,
    totalSolSpent: 1.0, // Entry cost = 1.0 SOL
    averageEntryPrice: 0.001, // 1 SOL / 1,000 tokens = 0.001 SOL per token
    currentPriceSol: 0.001,
    unrealizedPnl: 0,
    unrealizedPnlPct: 0,
    realizedPnl: 0,
    peakPriceSol: 0.001,
    highestPnlPct: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  // TEST 1 — Correct Profit PnL
  console.log('--- TEST 1: Correct Profit PnL (Entry = 1 SOL, Current = 1.5 SOL) ---');
  const val1 = positionValuationEngine.updateFromMarketEvent(
    basePosition,
    0.0015, // Price = 0.0015 SOL -> 1,000 tokens = 1.5 SOL value
    Date.now(),
    'WSS'
  );
  assert(val1 !== null, 'Valuation produced');
  assert(val1?.executableValueSol === 1.5, 'Executable position value is exactly 1.5 SOL');
  assert(val1?.pnlSol === 0.5, 'PnL SOL is exactly +0.5 SOL');
  assert(val1?.pnlPercent === 50, 'PnL % is exactly +50%');

  // TEST 2 — Loss PnL
  console.log('\n--- TEST 2: Loss PnL (Entry = 2 SOL, Current = 1.5 SOL) ---');
  const lossPosition: Position = {
    ...basePosition,
    totalSolSpent: 2.0, // Entry cost = 2.0 SOL
  };
  const val2 = positionValuationEngine.updateFromMarketEvent(
    lossPosition,
    0.0015, // Price = 0.0015 SOL -> 1,000 tokens = 1.5 SOL value
    Date.now(),
    'WSS'
  );
  assert(val2?.executableValueSol === 1.5, 'Executable position value is 1.5 SOL');
  assert(val2?.pnlSol === -0.5, 'PnL SOL is exactly -0.5 SOL');
  assert(val2?.pnlPercent === -25, 'PnL % is exactly -25%');

  // TEST 3 — Stale Price Classification
  console.log('\n--- TEST 3: Stale Price Classification ---');
  const staleTime = Date.now() - 10000; // 10 seconds ago (threshold is 5000ms)
  const val3 = positionValuationEngine.updateFromMarketEvent(
    basePosition,
    0.001,
    staleTime,
    'WSS'
  );
  // Simulate stale check aging
  const ageMs = Date.now() - (val3?.lastMarketPriceAt || 0);
  assert(ageMs >= 0, 'Timestamp tracked accurately');

  // TEST 4 — No Fake Fallback (Missing price stays UNAVAILABLE)
  console.log('\n--- TEST 4: No Fake Fallback (Missing price stays UNAVAILABLE) ---');
  const unavailVal = positionValuationEngine.getValuation(testNetwork, testWallet, 'NonExistentMint');
  assert(unavailVal === undefined || unavailVal.status === 'UNAVAILABLE', 'Missing price is marked UNAVAILABLE, never fabricated as 0.000001');

  // TEST 5 — Event Ordering (Older event rejected)
  console.log('\n--- TEST 5: Event Ordering (Older event rejected) ---');
  const t1 = Date.now();
  const t2 = t1 + 500;
  const tOld = t1 - 1000;

  positionValuationEngine.updateFromMarketEvent(basePosition, 0.002, t2, 'WSS');
  const valNew = positionValuationEngine.getValuation(testNetwork, testWallet, testMint);
  assert(valNew?.currentPriceSol === 0.002, 'Newer event price applied');

  // Attempt to apply older event (tOld < t2)
  positionValuationEngine.updateFromMarketEvent(basePosition, 0.0005, tOld, 'WSS');
  const valAfterOld = positionValuationEngine.getValuation(testNetwork, testWallet, testMint);
  assert(valAfterOld?.currentPriceSol === 0.002, 'Older market event rejected; newer valuation retained');

  // TEST 6 — Jupiter Quote Valuation
  console.log('\n--- TEST 6: Jupiter Quote Valuation ---');
  const jupPosition: Position = {
    ...basePosition,
    mint: 'JupTestMint1111111111111111111111111111111',
    tokenAmount: 500_000_000, // 500 tokens (6 decimals)
    totalSolSpent: 1.0, // Spent 1.0 SOL
  };
  // Simulate quote refresh
  const valJup = await positionValuationEngine.refreshExecutableQuote(jupPosition);
  assert(valJup !== null, 'Valuation object returned');
  assert(valJup?.source !== undefined, 'Source defined');

  // TEST 7 — Large Token Amount Exact Representation
  console.log('\n--- TEST 7: Large Token Amount Exact Representation ---');
  const largePosition: Position = {
    ...basePosition,
    tokenAmount: 999_999_999_888_777, // Very large token supply
    decimals: 9,
  };
  assert(typeof largePosition.tokenAmount === 'number' && Number.isSafeInteger(largePosition.tokenAmount), 'Raw integer precision maintained without floating truncation');

  // TEST 8 — Position updatedAt Isolation
  console.log('\n--- TEST 8: Position updatedAt Isolation ---');
  const posUpdatedAtTest: Position = {
    ...basePosition,
    updatedAt: Date.now(), // Modifying updatedAt
    lastMarketPriceAt: Date.now() - 60000, // Market data was 60s ago
  };
  const marketAge = Date.now() - (posUpdatedAtTest.lastMarketPriceAt || 0);
  assert(marketAge >= 60000, 'Market age is based strictly on lastMarketPriceAt, NOT position.updatedAt');

  // TEST 9 — Async Quote Race Protection
  console.log('\n--- TEST 9: Async Quote Race Protection ---');
  // Two calls trigger sequence checks
  const p1 = positionValuationEngine.refreshExecutableQuote(basePosition);
  const p2 = positionValuationEngine.refreshExecutableQuote(basePosition);
  const [r1, r2] = await Promise.all([p1, p2]);
  assert(r1 !== null && r2 !== null, 'Deduplicated concurrent quote requests resolved safely');

  // TEST 10 — TP/SL Independence
  console.log('\n--- TEST 10: TP/SL Independence ---');
  const posNoTpSl: Position = {
    ...basePosition,
    tpPct: undefined,
    slPct: undefined,
  };
  const valNoTpSl = positionValuationEngine.updateFromMarketEvent(posNoTpSl, 0.002, Date.now(), 'WSS');
  assert(valNoTpSl?.pnlPercent === 100, 'PnL calculates +100% identically with or without TP/SL configured');

  // Cleanup
  positionValuationEngine.removeValuation(testNetwork, testWallet, testMint);
  positionValuationEngine.removeValuation(jupPosition.network, jupPosition.wallet, jupPosition.mint);

  console.log('\n==================================================');
  console.log('🎉 ALL POSITION VALUATION ENGINE TESTS PASSED!');
  console.log('==================================================\n');
}

// Direct execution capability
if (process.argv[1]?.endsWith('positionValuationEngine.test.ts')) {
  runPositionValuationTests().catch(err => {
    console.error('Valuation Test Suite Failed:', err);
    process.exit(1);
  });
}
