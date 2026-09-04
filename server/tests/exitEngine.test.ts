// server/tests/exitEngine.test.ts
import { positionManager } from '../trading/PositionManager.js';
import { unifiedExitEngine } from '../trading/UnifiedExitEngine.js';
import { pnlEngine } from '../trading/PnLEngine.js';
import { positionRepository } from '../repositories/PositionRepository.js';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  } else {
    console.log(`✅ PASS: ${message}`);
  }
}

export async function runExitEngineTests(): Promise<void> {
  console.log('\n==================================================');
  console.log('🧪 RUNNING UNIFIED EXIT ENGINE AUTOMATED SUITE');
  console.log('==================================================\n');

  const testNetwork = 'paper';
  const testWallet = 'test_wallet_suite';
  const testMint = 'TestMint11111111111111111111111111111111111111';

  // Cleanup existing position for test mint
  const existing = positionManager.getPosition(testNetwork, testWallet, testMint);
  if (existing) {
    positionManager.updatePositionStatus(testNetwork, testWallet, testMint, 'CLOSED');
  }

  // TEST 1: Open Position with 25% TP and 15% SL
  console.log('--- TEST 1: Position Creation & Parameter Persistence ---');
  const pos = positionManager.openOrAccumulatePosition({
    network: testNetwork,
    wallet: testWallet,
    mint: testMint,
    tokenAmountRaw: 1000000000, // 1 token (9 decimals)
    decimals: 9,
    solSpent: 1.0, // 1 SOL spent -> entry price = 1.0 SOL per token
    tpPct: 25,
    slPct: 15,
  });

  assert(pos.status === 'OPEN', 'Position status is OPEN');
  assert(pos.averageEntryPrice === 1.0, 'Average entry price is 1.0 SOL');
  assert(pos.tpPct === 25, 'TP % is set to 25%');
  assert(pos.slPct === 15, 'SL % is set to 15%');

  // TEST 2: Price Update without Breach (+10% PnL)
  console.log('\n--- TEST 2: Price Update without Breach (+10% PnL) ---');
  let decision = await unifiedExitEngine.evaluatePositionExit(pos, 1.10); // +10%
  assert(!decision.shouldExit, 'Should NOT exit on +10% PnL (TP is +25%)');

  // TEST 3: Take Profit Hit (+25% PnL)
  console.log('\n--- TEST 3: Take Profit Hit (+25% PnL) ---');
  decision = await unifiedExitEngine.evaluatePositionExit(pos, 1.25); // +25%
  assert(decision.shouldExit === true, 'Should exit when TP (+25%) is reached');
  assert(decision.reason === 'TAKE_PROFIT', 'Exit reason is TAKE_PROFIT');

  // TEST 4: Stop Loss Hit (-15% PnL)
  console.log('\n--- TEST 4: Stop Loss Hit (-15% PnL) ---');
  decision = await unifiedExitEngine.evaluatePositionExit(pos, 0.85); // -15%
  assert(decision.shouldExit === true, 'Should exit when SL (-15%) is reached');
  assert(decision.reason === 'STOP_LOSS', 'Exit reason is STOP_LOSS');

  // TEST 5: Negative SL Configuration Handling (`slPct = -15`)
  console.log('\n--- TEST 5: Negative SL Configuration Handling (`slPct = -15`) ---');
  pos.slPct = -15; // User or legacy config passed -15
  decision = await unifiedExitEngine.evaluatePositionExit(pos, 0.85); // -15%
  assert(decision.shouldExit === true, 'Negative slPct (-15) correctly triggers STOP_LOSS when price drops -15%');
  assert(decision.reason === 'STOP_LOSS', 'Reason is STOP_LOSS');

  // TEST 6: Atomic Deduplication / Lock Protection
  console.log('\n--- TEST 6: Atomic Lock Protection against Duplicate Events ---');
  // Acquire lock
  const lock1 = unifiedExitEngine.acquireExitLock(testNetwork, testWallet, testMint);
  assert(lock1 === true, 'First lock acquisition succeeds');

  const lock2 = unifiedExitEngine.acquireExitLock(testNetwork, testWallet, testMint);
  assert(lock2 === false, 'Second concurrent lock acquisition fails (deduplicated)');

  unifiedExitEngine.releaseExitLock(testNetwork, testWallet, testMint);
  const lock3 = unifiedExitEngine.acquireExitLock(testNetwork, testWallet, testMint);
  assert(lock3 === true, 'Lock re-acquisition succeeds after release');
  unifiedExitEngine.releaseExitLock(testNetwork, testWallet, testMint);

  // TEST 7: Full Execution Flow & Position Closure
  console.log('\n--- TEST 7: Full Authoritative Exit Execution & Position Closure ---');
  // Trigger real exit execution
  const executed = await unifiedExitEngine.evaluateAndExecuteExit(pos, 1.30); // +30% TP
  assert(executed === true, 'Exit execution succeeded');

  const closedPos = positionManager.getPositionById(pos.id);
  assert(closedPos?.status === 'CLOSED', 'Position status is authoritatively CLOSED');

  // TEST 8: Repository Persistence & Recovery
  console.log('\n--- TEST 8: Repository Persistence & Recovery Test ---');
  const freshPos = positionManager.openOrAccumulatePosition({
    network: testNetwork,
    wallet: testWallet,
    mint: 'RecoveryMint1111111111111111111111111111111111',
    tokenAmountRaw: 500000000,
    decimals: 9,
    solSpent: 0.5,
    tpPct: 30,
    slPct: 20,
  });

  positionManager.refreshFromRepository();
  const recovered = positionManager.getPositionById(freshPos.id);
  assert(recovered !== undefined, 'Position successfully recovered from repository');
  assert(recovered?.tpPct === 30, 'Recovered TP % matches persisted value (30%)');
  assert(recovered?.slPct === 20, 'Recovered SL % matches persisted value (20%)');

  // Cleanup
  positionManager.updatePositionStatus(recovered!.network, recovered!.wallet, recovered!.mint, 'CLOSED');

  console.log('\n==================================================');
  console.log('🎉 ALL UNIFIED EXIT ENGINE AUTOMATED TESTS PASSED!');
  console.log('==================================================\n');
  process.exit(0);
}

// Allow direct execution
if (process.argv[1]?.endsWith('exitEngine.test.ts')) {
  runExitEngineTests().catch(err => {
    console.error('Test Suite Failed:', err);
    process.exit(1);
  });
}
