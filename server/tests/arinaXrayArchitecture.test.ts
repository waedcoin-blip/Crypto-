// server/tests/arinaXrayArchitecture.test.ts
import { tradingSupervisor } from '../trading/TradingSupervisor.js';
import { positionManager } from '../trading/PositionManager.js';
import { positionRepository } from '../repositories/PositionRepository.js';
import { paperWalletLedger } from '../wallet/PaperWalletLedger.js';
import { reconcileDatabaseWithMainnet } from '../workers/StartupReconciliationWorker.js';

async function runArinaXrayRegressionSuite() {
  console.log('🚀 Starting ARINA X-RAY Phase 2 Trading Lifecycle Regression Test Suite...\n');
  let failures = 0;

  function assert(condition: boolean, message: string) {
    if (condition) {
      console.log(`  ✔ [PASS] ${message}`);
    } else {
      console.error(`  ❌ [FAIL] ${message}`);
      failures++;
    }
  }

  // TEST 1: TradingSupervisor State Machine Lifecycle & Health Map
  console.log('▶ [TEST 1] TradingSupervisor State Machine & Health Tracking');
  await tradingSupervisor.stopTrading();
  const initStatus = tradingSupervisor.getStatus();
  assert(initStatus.state === 'STOPPED', 'Initial supervisor state is STOPPED');

  const startRes = await tradingSupervisor.startTrading({ network: 'paper', wallet: 'default' });
  assert(startRes.state === 'TRADING', 'TradingSupervisor transitions to TRADING state on valid params');
  assert(startRes.network === 'paper', 'Network recorded explicitly as paper');
  assert(startRes.sessionId !== null && startRes.sessionId.startsWith('sess_'), 'Session ID generated');
  assert(startRes.health.wallet === 'READY', 'Wallet component is READY');
  assert(startRes.health.executionGateway === 'READY', 'ExecutionGateway is READY');
  assert(startRes.health.paperLedger === 'READY', 'PaperWalletLedger is READY');

  // TEST 2: Idempotent Start / Stop
  console.log('▶ [TEST 2] Start/Stop Idempotency & Mutex Safety');
  const sess1 = tradingSupervisor.getStatus().sessionId;
  const repeatStart1 = await tradingSupervisor.startTrading({ network: 'paper', wallet: 'default' });
  const repeatStart2 = await tradingSupervisor.startTrading({ network: 'paper', wallet: 'default' });
  assert(repeatStart1.sessionId === sess1, 'Repeat start returns identical active session');
  assert(repeatStart2.sessionId === sess1, 'Second repeat start returns identical active session');

  const stop1 = await tradingSupervisor.stopTrading();
  const stop2 = await tradingSupervisor.stopTrading();
  assert(stop1.state === 'STOPPED', 'First stop request sets state to STOPPED');
  assert(stop2.state === 'STOPPED', 'Second stop request is idempotent STOPPED');

  const restartRes = await tradingSupervisor.startTrading({ network: 'paper', wallet: 'default' });
  assert(restartRes.state === 'TRADING', 'Clean restart transitions back to TRADING');
  assert(restartRes.sessionId !== sess1, 'Clean restart generates a new unique session ID');

  // TEST 3: Fail-Closed Invalid Network Handling & Failure Injection
  console.log('▶ [TEST 3] Fail-Closed Network Guard & Failure Injection');
  await tradingSupervisor.stopTrading();
  const invalidNetRes = await tradingSupervisor.startTrading({ network: 'invalid_network_xyz' as any });
  assert(invalidNetRes.state === 'START_FAILED', 'Invalid network transitions to START_FAILED');
  assert(invalidNetRes.lastError !== null && invalidNetRes.lastError.includes('INVALID_NETWORK'), 'Preserves explicit INVALID_NETWORK error');
  assert(invalidNetRes.health.executionGateway === 'FAILED' || invalidNetRes.state === 'START_FAILED', 'Execution gateway / state reflects failure');

  // Reset supervisor back to paper TRADING for position tests
  await tradingSupervisor.stopTrading();
  await tradingSupervisor.startTrading({ network: 'paper', wallet: 'default' });

  // TEST 4: Paper Wallet Ledger Integrity
  console.log('▶ [TEST 4] Paper Wallet Ledger Integrity');
  paperWalletLedger.reset(100.0);
  const initialSol = paperWalletLedger.getSolBalance();
  assert(initialSol === 100.0, 'Paper wallet initialized with 100 SOL balance');

  const testMint = 'PaperTestMint111111111111111111111111111111';
  paperWalletLedger.commitBuy(testMint, 1.0, 1000000000, 9, 'paper_tx_test_buy');
  const postBuySol = paperWalletLedger.getSolBalance();
  const postBuyToken = paperWalletLedger.getTokenBalance(testMint);
  assert(postBuySol === 99.0, 'Paper SOL balance deducted accurately on buy (99 SOL)');
  assert(postBuyToken === 1000000000, 'Paper token balance credited accurately on buy');

  // TEST 5: Position Survival Across Workers/Reconciliation
  console.log('▶ [TEST 5] Paper Position Persistence & Reconciliation Survival');
  const newPos = positionManager.openOrAccumulatePosition({
    network: 'paper',
    wallet: 'default',
    mint: testMint,
    tokenAmountRaw: 1000000000,
    decimals: 9,
    solSpent: 1.0,
    tpPct: 25,
    slPct: 15,
  });

  assert(newPos.status === 'OPEN', 'Position opened successfully in state OPEN');
  const storedInRepoBefore = positionRepository.getPosition(newPos.id);
  assert(storedInRepoBefore !== undefined && storedInRepoBefore.state === 'OPEN', 'Position persisted in SQLite repository in state OPEN');

  // Run StartupReconciliationWorker
  await reconcileDatabaseWithMainnet();

  const storedInRepoAfter = positionRepository.getPosition(newPos.id);
  assert(storedInRepoAfter !== undefined && storedInRepoAfter.state === 'OPEN', 'Paper position remains OPEN after reconciliation');

  // TEST 6: Stop Trading Does NOT Delete Positions
  console.log('▶ [TEST 6] Stop Trading Disables Entries But Preserves Positions');
  await tradingSupervisor.stopTrading();
  const stopStatus = tradingSupervisor.getStatus();
  assert(stopStatus.state === 'STOPPED', 'Trading supervisor transitioned to STOPPED');

  const openPosAfterStop = positionRepository.getPosition(newPos.id);
  assert(openPosAfterStop !== undefined && openPosAfterStop.state === 'OPEN', 'Open position remains OPEN when supervisor is stopped');

  // Clean up
  positionManager.updatePositionStatus('paper', 'default', testMint, 'CLOSED');
  paperWalletLedger.reset(100.0);

  console.log('\n======================================================');
  if (failures === 0) {
    console.log('🎉 ALL ARINA X-RAY PHASE 2 LIFECYCLE TESTS PASSED! ✅');
    process.exit(0);
  } else {
    console.error(`❌ ${failures} TESTS FAILED IN REGRESSION SUITE.`);
    process.exit(1);
  }
}

runArinaXrayRegressionSuite().catch(err => {
  console.error('[TEST SUITE FATAL]', err);
  process.exit(1);
});

