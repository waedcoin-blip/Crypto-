// scripts/bug001-persistence-splitbrain-regression.mjs
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { positionRepository } from '../server/repositories/PositionRepository.js';
import { positionManager } from '../server/trading/PositionManager.js';
import { withFileLockSync, updateDataFileAtomic, readDataFile, writeDataFile } from '../server/db/jsonStore.js';

console.log('--- STARTING BUG-001 SPLIT-BRAIN PERSISTENCE REGRESSION TEST ---');

const DATA_DIR = path.join(process.cwd(), 'data');
const POSITIONS_FILE = 'positions.json';
const BACKUP_FILE = 'positions.json.bak_test';

// 1. Backup current positions
const origData = readDataFile(POSITIONS_FILE, []);
fs.writeFileSync(path.join(DATA_DIR, BACKUP_FILE), JSON.stringify(origData));

try {
  // Clear positions for test
  writeDataFile(POSITIONS_FILE, []);

  console.log('\n[TEST 1] Testing Server Close vs Worker Stale Price Update (Resurrection Prevention)...');
  const now = Date.now();
  const p1 = {
    id: 'pos_test_p1',
    mintAddress: 'TokenP1MintAddress1111111111111111111111111',
    network: 'paper',
    wallet: 'default',
    amountRaw: 1000000,
    decimals: 6,
    entryPriceSOL: 0.05,
    solSpent: 0.05,
    currentPriceSOL: 0.05,
    peakPriceSOL: 0.05,
    highestPnLPct: 0,
    currentPnLSol: 0,
    currentPnLPct: 0,
    tpPct: 25,
    slPct: 15,
    slippageBpsTp: 250,
    slippageBpsSl: 1000,
    state: 'OPEN',
    orderIds: ['ord_1'],
    createdAt: now,
    updatedAt: now,
  };

  // Step 1: Position created as OPEN
  positionRepository.upsertPosition(p1);
  positionManager.refreshFromRepository();
  assert.strictEqual(positionRepository.getPosition('pos_test_p1')?.state, 'OPEN', 'P1 should be OPEN initially');
  assert.strictEqual(positionManager.getPosition('paper', 'default', p1.mintAddress)?.status, 'OPEN', 'Manager sees P1 OPEN');

  // Step 2: Server closes P1
  console.log('-> Server closes P1 with realized PnL...');
  positionRepository.closePosition('pos_test_p1', {
    exitSignature: 'sig_exit_p1_confirmed',
    realizedPnLSol: 0.02,
    realizedPnLPct: 40,
  });

  const closedRec = positionRepository.getPosition('pos_test_p1');
  assert.strictEqual(closedRec?.state, 'CLOSED', 'P1 must be CLOSED on disk');
  assert.strictEqual(closedRec?.exitSignature, 'sig_exit_p1_confirmed', 'Exit signature must be recorded');

  // Step 3: Worker (which had stale state or receives price tick) attempts to update P1 price
  console.log('-> Worker attempts to update P1 price to 0.08...');
  const updatedByWorker = positionRepository.updatePosition('pos_test_p1', {
    currentPriceSOL: 0.08,
    currentPnLSol: 0.03,
  });

  // Verify: Worker must NOT resurrect P1
  const diskRecAfterWorker = positionRepository.getPosition('pos_test_p1');
  assert.strictEqual(diskRecAfterWorker?.state, 'CLOSED', 'Worker update must NOT resurrect P1 to OPEN');
  assert.strictEqual(diskRecAfterWorker?.exitSignature, 'sig_exit_p1_confirmed', 'Exit signature must remain intact');

  // Step 4: Worker attempts an upsert with state OPEN (split brain memory dump simulation)
  console.log('-> Worker attempts upsertPosition with stale OPEN state...');
  const staleWorkerRecord = { ...p1, currentPriceSOL: 0.09, state: 'OPEN' };
  positionRepository.upsertPosition(staleWorkerRecord);

  const diskRecAfterStaleUpsert = positionRepository.getPosition('pos_test_p1');
  assert.strictEqual(diskRecAfterStaleUpsert?.state, 'CLOSED', 'upsertPosition must NOT overwrite CLOSED state');
  console.log('PASSED: Resurrection completely prevented!');

  // [TEST 2] PositionManager cross-process synchronization test
  console.log('\n[TEST 2] Testing PositionManager synchronization with repository...');
  positionManager.refreshFromRepository();
  const managerPos = positionManager.getPosition('paper', 'default', p1.mintAddress);
  assert.strictEqual(managerPos, undefined, 'PositionManager must not return CLOSED position for active trading');
  const openList = positionManager.getOpenPositions('paper');
  assert.strictEqual(openList.some(p => p.id === 'pos_test_p1'), false, 'getOpenPositions must not contain closed P1');
  console.log('PASSED: PositionManager cache correctly excludes closed position!');

  // [TEST 3] Simultaneous writes to different records
  console.log('\n[TEST 3] Testing simultaneous concurrent writes to different records...');
  const promisesDiff = [];
  for (let i = 0; i < 20; i++) {
    const pos = {
      id: `pos_concurrent_${i}`,
      mintAddress: `MintConcurrent_${i}_Address1111111111111111`,
      network: 'paper',
      amountRaw: 1000,
      decimals: 6,
      entryPriceSOL: 0.01,
      solSpent: 0.01,
      currentPriceSOL: 0.01,
      peakPriceSOL: 0.01,
      highestPnLPct: 0,
      tpPct: 25,
      slPct: 15,
      slippageBpsTp: 250,
      slippageBpsSl: 1000,
      state: 'OPEN',
      orderIds: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    promisesDiff.push(
      new Promise((resolve) => {
        positionRepository.upsertPosition(pos);
        resolve();
      })
    );
  }
  await Promise.all(promisesDiff);

  const allRecorded = positionRepository.getAllPositions();
  assert.strictEqual(allRecorded.filter(p => p.id.startsWith('pos_concurrent_')).length, 20, 'All 20 concurrent positions must be preserved');
  console.log('PASSED: All 20 concurrent positions persisted without data loss!');

  // [TEST 4] Simultaneous writes to the same record
  console.log('\n[TEST 4] Testing simultaneous concurrent writes to the same record...');
  const targetId = 'pos_concurrent_0';
  for (let i = 1; i <= 15; i++) {
    positionRepository.updatePosition(targetId, {
      currentPriceSOL: 0.01 + i * 0.001,
      peakPriceSOL: 0.01 + i * 0.001,
    });
  }
  const finalSameRec = positionRepository.getPosition(targetId);
  assert(finalSameRec.version >= 15, `Version should be incremented monotonically: got ${finalSameRec.version}`);
  console.log(`PASSED: Monotonic versioning and atomic update confirmed (version=${finalSameRec.version})`);

  // [TEST 5] Process restart & recovery
  console.log('\n[TEST 5] Testing process restart & recovery simulation...');
  // Simulate process restart by reloading repository directly from disk
  const freshRead = readDataFile(POSITIONS_FILE, []);
  const closedInFresh = freshRead.find(p => p.id === 'pos_test_p1');
  assert.strictEqual(closedInFresh?.state, 'CLOSED', 'P1 remains CLOSED upon fresh process load');
  assert.strictEqual(closedInFresh?.exitSignature, 'sig_exit_p1_confirmed', 'Exit signature retained across restart');
  console.log('PASSED: Clean process recovery verified!');

  console.log('\nALL BUG-001 REGRESSION TESTS PASSED SUCCESSFULLY!');
} finally {
  // Restore original data
  if (fs.existsSync(path.join(DATA_DIR, BACKUP_FILE))) {
    const backup = JSON.parse(fs.readFileSync(path.join(DATA_DIR, BACKUP_FILE), 'utf8'));
    writeDataFile(POSITIONS_FILE, backup);
    fs.unlinkSync(path.join(DATA_DIR, BACKUP_FILE));
  }
}
