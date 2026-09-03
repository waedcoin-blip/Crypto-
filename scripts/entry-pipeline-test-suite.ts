// scripts/entry-pipeline-test-suite.ts
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { tokenMintResolver } from '../server/market/TokenMintResolver.js';
import { OnChainEventNormalizer } from '../server/market/OnChainEventNormalizer.js';
import { candidateEnricher, EnrichedCandidate } from '../server/trading/CandidateEnricher.js';
import { opportunityScorer } from '../server/trading/OpportunityScorer.js';
import { serverEntryGate } from '../server/trading/ServerEntryGate.js';
import { entryEngine } from '../server/trading/EntryEngine.js';
import { rebuyGuard } from '../server/trading/RebuyGuard.js';
import { positionManager } from '../server/trading/PositionManager.js';
import { tradingEngine } from '../server/trading/TradingEngine.js';
import { tokenRepository } from '../server/repositories/TokenRepository.js';

let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ [PASS] ${testName}`);
  } else {
    console.error(`  ❌ [FAIL] ${testName}${detail ? ` - ${detail}` : ''}`);
    throw new Error(`Test assertion failed: ${testName} (${detail || ''})`);
  }
}

async function runTestSuite() {
  console.log('\n======================================================');
  console.log('   ARINA X-RAY: COMPLETE ENTRY PIPELINE AUDIT & TEST   ');
  console.log('======================================================\n');

  // ==========================================================
  // SUITE 1: TOKEN MINT RESOLVER & WSS LOG PARSING
  // ==========================================================
  console.log('--- SUITE 1: TokenMintResolver & Program ID Filtering ---');

  const systemProg = '11111111111111111111111111111111';
  const pumpProg = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
  const raydiumProg = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';
  const jupProg = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
  const wsolMint = 'So11111111111111111111111111111111111111112';

  assert(!tokenMintResolver.isValidMint(systemProg), 'Rejects Solana System Program');
  assert(!tokenMintResolver.isValidMint(pumpProg), 'Rejects Pump.fun Program ID');
  assert(!tokenMintResolver.isValidMint(raydiumProg), 'Rejects Raydium AMM Program ID');
  assert(!tokenMintResolver.isValidMint(jupProg), 'Rejects Jupiter v6 Program ID');
  assert(!tokenMintResolver.isValidMint(wsolMint), 'Rejects WSOL Base Mint');
  assert(!tokenMintResolver.isValidMint('invalid_base58_token_123'), 'Rejects non-base58 strings');
  assert(!tokenMintResolver.isValidMint(''), 'Rejects empty string');

  const genuineMint = Keypair.generate().publicKey.toBase58();
  assert(tokenMintResolver.isValidMint(genuineMint), 'Accepts genuine SPL token mint');

  // Log Parsing Tests
  const pumpLogs = [
    `Program ${pumpProg} invoke [1]`,
    `Program log: Instruction: Create`,
    `Program log: mint: ${genuineMint}`,
    `Program ${pumpProg} success`,
  ];
  const extractedMint = tokenMintResolver.extractMintFromLogs(pumpLogs);
  assert(extractedMint === genuineMint, 'Extracts mint from Pump.fun creation logs');

  const normalizedWss = OnChainEventNormalizer.normalizeWssNotification({
    method: 'logsNotification',
    params: {
      result: {
        context: { slot: 1234567 },
        value: {
          signature: 'sig_test_123',
          logs: pumpLogs,
          err: null,
        },
      },
    },
  });
  assert(normalizedWss !== null, 'Normalizes Helius WSS logs notification');
  assert(normalizedWss?.candidateMint === genuineMint, 'Normalized event extracts candidate token mint');

  // ==========================================================
  // SUITE 2: CANDIDATE ENRICHMENT & ZERO FAKE METRICS
  // ==========================================================
  console.log('\n--- SUITE 2: CandidateEnricher & Zero Fake Metrics ---');

  const unlistedMint = Keypair.generate().publicKey.toBase58();
  const rawCandidate = await candidateEnricher.enrichCandidate(unlistedMint, 'paper');

  assert(rawCandidate.marketCapUsd.state === 'UNAVAILABLE', 'Unlisted token MCAP state is UNAVAILABLE');
  assert(rawCandidate.marketCapUsd.value === null, 'Unlisted token MCAP value is null (no fake fallback)');
  assert(rawCandidate.liquidityUsd.state === 'UNAVAILABLE', 'Unlisted token Liquidity state is UNAVAILABLE');
  assert(rawCandidate.liquidityUsd.value === null, 'Unlisted token Liquidity value is null (no fake fallback)');
  assert(rawCandidate.devWalletOwnershipPct.state === 'UNAVAILABLE', 'Dev ownership state is UNAVAILABLE when unknown');

  // Seed repository with verified on-chain data
  const testCandidateMint = Keypair.generate().publicKey.toBase58();
  tokenRepository.upsertToken({
    mintAddress: testCandidateMint,
    network: 'paper',
    symbol: 'ALPHATEST',
    name: 'Alpha Test Token',
    discoveredAt: Date.now() - 60000,
    updatedAt: Date.now(),
    signal: 'TEST_SEED',
    metadata: {
      dexId: 'raydium',
      priceUsd: 0.00015,
      marketCapUsd: 95000,
      liquidityUsd: 25000,
      devOwnershipPct: 3.5,
      top10HoldersPct: 18.0,
      riskScore: 12,
      bondingCurveProgress: 100,
      decimals: 6,
    },
  });

  const enriched = await candidateEnricher.enrichCandidate(testCandidateMint, 'paper');
  assert(enriched.marketCapUsd.value === 95000, 'Reads real MCAP from verified repository record');
  assert(enriched.liquidityUsd.value === 25000, 'Reads real Liquidity from verified repository record');
  assert(enriched.devWalletOwnershipPct.value === 3.5, 'Reads dev ownership as percentage (3.5%)');
  assert(enriched.top10HoldersPct.value === 18.0, 'Reads top 10 ownership as percentage (18.0%)');

  // ==========================================================
  // SUITE 3: OPPORTUNITY SCORING & SERVER ENTRY GATE
  // ==========================================================
  console.log('\n--- SUITE 3: Opportunity Scoring & Server Entry Gate Boundaries ---');

  const scoreBreakdown = opportunityScorer.scoreCandidate(enriched);
  assert(scoreBreakdown.totalScore > 0, `Scores candidate positively: ${scoreBreakdown.totalScore}/100`);

  // Gate check with autoSniper = false
  const decisionDisabled = await serverEntryGate.evaluateEntry({
    candidate: enriched,
    network: 'paper',
    wallet: 'default',
    autoSniperEnabled: false,
  });
  assert(!decisionDisabled.allowed, 'Entry Gate blocks when autoSniper is disabled');
  assert(decisionDisabled.blockingReasons.includes('AUTO_SNIPER_DISABLED'), 'Reason matches AUTO_SNIPER_DISABLED');

  // Gate check with autoSniper = true (Passing candidate)
  const decisionEnabled = await serverEntryGate.evaluateEntry({
    candidate: enriched,
    network: 'paper',
    wallet: 'default',
    autoSniperEnabled: true,
  });
  if (!decisionEnabled.allowed) {
    console.log('Blocking reasons for decisionEnabled:', decisionEnabled.blockingReasons, decisionEnabled.criteriaResults);
  }
  assert(decisionEnabled.allowed, 'Entry Gate allows valid candidate meeting all criteria', decisionEnabled.blockingReasons.join(', '));
  assert(decisionEnabled.decision === 'BUY', 'Decision is BUY');

  // Boundary check: Dev ownership > threshold
  const highDevMint = Keypair.generate().publicKey.toBase58();
  tokenRepository.upsertToken({
    mintAddress: highDevMint,
    network: 'paper',
    symbol: 'DEVHIGH',
    metadata: {
      marketCapUsd: 75000,
      liquidityUsd: 18000,
      devOwnershipPct: 12.5, // > 10%
      top10HoldersPct: 18.0,
      riskScore: 12,
    },
  });
  const enrichedHighDev = await candidateEnricher.enrichCandidate(highDevMint, 'paper');
  const decisionDevBlock = await serverEntryGate.evaluateEntry({
    candidate: enrichedHighDev,
    network: 'paper',
    wallet: 'default',
    autoSniperEnabled: true,
    criteria: { hardenedMaxDevOwnership: 10 },
  });
  assert(!decisionDevBlock.allowed, 'Entry Gate blocks when dev ownership exceeds maximum threshold');
  assert(decisionDevBlock.blockingReasons.some((r) => r.includes('DEV_OWNERSHIP_TOO_HIGH')), 'Reports DEV_OWNERSHIP_TOO_HIGH');

  // ==========================================================
  // SUITE 4: LIFECYCLE & REBUY GUARD INTEGRITY
  // ==========================================================
  console.log('\n--- SUITE 4: RebuyGuard & Position Lifecycle ---');

  const lifecycleMint = Keypair.generate().publicKey.toBase58();
  const initialRebuyCheck = rebuyGuard.canBuy({
    network: 'paper',
    wallet: 'default',
    mint: lifecycleMint,
    maxRebuyTimes: 1,
    tradeOnlyOnce: true,
  });
  assert(initialRebuyCheck.allowed, 'Brand new token allowed by RebuyGuard');

  // Discovery does NOT increment buy count
  assert(rebuyGuard.getCompletedBuyCount('paper', 'default', lifecycleMint) === 0, 'Discovery does not increment buy count');

  // Simulate confirmed trade
  const buyRes = await tradingEngine.buy({
    network: 'paper',
    wallet: 'default',
    mint: lifecycleMint,
    amountSol: 0.1,
    label: 'test_buy',
  });
  assert(buyRes.success, 'Paper buy execution succeeds');

  const secondRebuyCheck = rebuyGuard.canBuy({
    network: 'paper',
    wallet: 'default',
    mint: lifecycleMint,
    maxRebuyTimes: 1,
    tradeOnlyOnce: true,
  });
  assert(!secondRebuyCheck.allowed, 'RebuyGuard blocks second buy when tradeOnlyOnce is true');

  const openPos = positionManager.getPosition('paper', 'default', lifecycleMint);
  assert(openPos !== null && openPos.status === 'OPEN', 'Position opened in PositionManager');

  // Close position
  const closeRes = await tradingEngine.sell({
    network: 'paper',
    wallet: 'default',
    mint: lifecycleMint,
    reason: 'TEST_CLOSE',
  });
  assert(closeRes.success, 'Position successfully closed');

  const openPosAfterClose = positionManager.getPosition('paper', 'default', lifecycleMint);
  assert(openPosAfterClose === undefined, 'Position cleared from active open positions after close');

  const allPositions = positionManager.getAllPositions();
  const closedRecord = allPositions.find((p) => p.mint === lifecycleMint);
  assert(closedRecord !== undefined && closedRecord.status === 'CLOSED', 'Position marked CLOSED in PositionManager history');

  // ==========================================================
  // SUITE 5: CONCURRENCY & ATOMIC LOCKING
  // ==========================================================
  console.log('\n--- SUITE 5: Concurrency & Atomic Lock Protection ---');

  const concurrentMint = Keypair.generate().publicKey.toBase58();
  tokenRepository.upsertToken({
    mintAddress: concurrentMint,
    network: 'paper',
    symbol: 'CONCUR',
    metadata: {
      dexId: 'raydium',
      marketCapUsd: 80000,
      liquidityUsd: 25000,
      devOwnershipPct: 2.0,
      top10HoldersPct: 15.0,
      riskScore: 10,
      bondingCurveProgress: 100,
      decimals: 6,
    },
  });

  entryEngine.setConfig({ autoSniperEnabled: true, network: 'paper' });

  // Fire 10 parallel evaluations for the same token mint
  const promises = Array.from({ length: 10 }, () =>
    entryEngine.evaluateAndTrade(concurrentMint, 'CONCURRENT_TEST')
  );
  const results = await Promise.all(promises);

  const buyConfirmedCount = results.filter((r) => r.stage === 'POSITION_OPEN' || r.tradeResponse?.success).length;
  assert(buyConfirmedCount <= 1, `Atomic lock prevents multiple buys for same mint (actual buys: ${buyConfirmedCount})`);

  // ==========================================================
  // SUMMARY
  // ==========================================================
  console.log('\n======================================================');
  console.log(`   ALL TESTS PASSED: ${passedTests}/${totalTests} ✅        `);
  console.log('======================================================\n');
}

runTestSuite().catch((err) => {
  console.error('\n❌ Test Suite Failed:', err);
  process.exit(1);
});
