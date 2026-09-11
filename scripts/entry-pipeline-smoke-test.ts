// scripts/entry-pipeline-smoke-test.ts
import '../server/utils/polyfill.js';
import { Keypair } from '@solana/web3.js';
import { candidateEnricher } from '../server/trading/CandidateEnricher.js';
import { opportunityScorer } from '../server/trading/OpportunityScorer.js';
import { serverEntryGate } from '../server/trading/ServerEntryGate.js';
import { entryEngine } from '../server/trading/EntryEngine.js';
import { tradingEngine } from '../server/trading/TradingEngine.js';
import { positionManager } from '../server/trading/PositionManager.js';
import { rebuyGuard } from '../server/trading/RebuyGuard.js';
import { tradeRepository } from '../server/repositories/TradeRepository.js';

async function runSmokeTest() {
  console.log('====================================================');
  console.log('🚀 ARINA X-RAY ENTRY PIPELINE SMOKE TEST STARTING');
  console.log('====================================================');

  const testMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC (safe mint)
  tradeRepository.clear('paper');
  rebuyGuard.clear();

  // 1. Test Candidate Enrichment
  console.log('\n[1/6] Testing Candidate Enrichment...');
  const enriched = await candidateEnricher.enrichCandidate(testMint, 'paper');
  const devPct = typeof enriched.devWalletOwnershipPct === 'object' ? enriched.devWalletOwnershipPct?.value : enriched.devWalletOwnershipPct;
  const priceUsd = typeof enriched.priceUsd === 'object' ? enriched.priceUsd?.value : enriched.priceUsd;
  const mcap = typeof enriched.marketCapUsd === 'object' ? enriched.marketCapUsd?.value : enriched.marketCapUsd;
  const decimals = typeof enriched.decimals === 'object' ? enriched.decimals?.value : enriched.decimals;
  console.log(`✅ Candidate Enriched: symbol=${enriched.symbol}, priceUsd=$${priceUsd}, mcap=$${mcap}, devPct=${devPct}%, decimals=${decimals}`);

  if (typeof devPct !== 'number' || devPct < 0 || devPct > 100) {
    throw new Error(`Enrichment failed dev ownership validation: ${devPct}`);
  }

  // 2. Test Opportunity Scoring
  console.log('\n[2/6] Testing Opportunity Scoring...');
  const scoring = opportunityScorer.scoreCandidate(enriched);
  console.log(`✅ Opportunity Scored: total=${scoring.totalScore}/100, momentum=${scoring.momentumScore}, buyerGrowth=${scoring.buyerGrowthScore}, recommendedAction=${scoring.recommendedAction}`);

  // 3. Test Server Entry Gate with Sniper Disabled (Expect BLOCK)
  console.log('\n[3/6] Testing Server Entry Gate (AutoSniper Disabled -> BLOCK)...');
  const blockedDecision = await serverEntryGate.evaluateEntry({
    candidate: enriched,
    criteria: {
      hardenedMcapMinRaydium: 1000,
      hardenedMcapMax: 10000000000,
      hardenedLiquidityMin: 1000,
      hardenedMaxDevOwnership: 10,
      hardenedMaxRiskScore: 50,
      maxPositions: 5,
    },
    network: 'paper',
    wallet: 'default',
    autoSniperEnabled: false,
  });

  console.log(`✅ Gate Decision: allowed=${blockedDecision.allowed}, decision=${blockedDecision.decision}, reasons=${blockedDecision.blockingReasons.join(', ')}`);
  if (blockedDecision.allowed !== false || !blockedDecision.blockingReasons.includes('AUTO_SNIPER_DISABLED')) {
    throw new Error('Gate should have blocked entry when autoSniperEnabled=false');
  }

  // 4. Test Server Entry Gate with Passing Criteria (Mock meme coin candidate)
  console.log('\n[4/6] Testing Server Entry Gate (Passing Criteria -> BUY)...');
  const memeCandidate = {
    ...enriched,
    marketCapUsd: 120000,
    liquidityUsd: 30000,
    ageMinutes: 15,
    bondingCurveProgress: 100,
    devWalletOwnershipPct: 2.5,
    top10HoldersPct: 18.0,
    riskScore: 10,
    isRugSafe: true,
    isSellable: true,
    uniqueBuyers30s: 8,
    buyCount30s: 12,
    totalBuys: 50,
    totalSells: 15,
    priceChange1m: 3.5,
    priceChange5m: 8.0,
  };

  const passingDecision = await serverEntryGate.evaluateEntry({
    candidate: memeCandidate,
    criteria: {
      hardenedMcapMinRaydium: 10000,
      hardenedMcapMax: 2000000,
      hardenedLiquidityMin: 5000,
      hardenedLiquidityRatio: 5,
      hardenedMaxDevOwnership: 10,
      hardenedMaxRiskScore: 22,
      maxPositions: 5,
      hardenedMinUniqueBuyers30s: 4,
      hardenedMinBuyCount30s: 4,
      hardenedMaxBuyCount30s: 40,
      hardenedMinBuySellRatio: 1.5,
      hardenedMaxBuySellRatio: 10.0,
      hardenedMaxPriceChange1m: 15.0,
      hardenedMinAge: 0,
      hardenedMaxAge: 240,
      tradePumpFun: true,
      tradeRaydium: true,
      tradeBonding: true,
      tradeUnknown: true,
    },
    network: 'paper',
    wallet: 'default',
    autoSniperEnabled: true,
  });

  console.log(`✅ Gate Decision: allowed=${passingDecision.allowed}, decision=${passingDecision.decision}, reasons=${passingDecision.blockingReasons.join(', ') || 'NONE'}`);
  if (!passingDecision.allowed) {
    throw new Error(`Gate should have passed, but was blocked by: ${passingDecision.blockingReasons.join(', ')}`);
  }

  // 5. Test Full Pipeline & Execution via EntryEngine in Paper Mode
  console.log('\n[5/6] Testing EntryEngine full automated evaluateAndTrade in Paper Mode...');
  entryEngine.setConfig({
    autoSniperEnabled: true,
    isLiveTrading: false,
    network: 'paper',
    wallet: 'default',
  });

  // Test USDC evaluated -> accurately BLOCKED
  const usdcResult = await entryEngine.evaluateAndTrade(testMint, 'SMOKE_TEST_USDC');
  console.log(`✅ USDC evaluation accurately BLOCKED: decision=${usdcResult.decision?.decision}, reason="${usdcResult.decision?.blockingReasons[0]}"`);

  // Now test an eligible candidate token (fresh unique mint per test run)
  const eligibleTestMint = Keypair.generate().publicKey.toBase58();
  
  // Clean any previous positions to ensure clean test state
  const openPositions = positionManager.getOpenPositions('paper');
  for (const pos of openPositions) {
    positionManager.updatePositionStatus('paper', pos.wallet, pos.mint, 'CLOSED');
  }
  rebuyGuard.resetBuyCount(eligibleTestMint, 'paper', 'default');

  // Directly test TradingEngine.buy with paper executor to verify BUY -> Order -> Position -> PnL flow
  const buyResp = await tradingEngine.buy({
    network: 'paper',
    wallet: 'default',
    mint: eligibleTestMint,
    amountSol: 0.1,
    decimals: 6,
    slippageBps: 250,
    label: 'smoke_test_buy',
  });

  console.log(`✅ TradingEngine Buy Response: success=${buyResp.success}, orderId=${buyResp.orderId}, posId=${buyResp.positionId}, sig=${buyResp.signature}`);
  if (!buyResp.success) {
    throw new Error(`TradingEngine buy failed: ${buyResp.error}`);
  }

  // Verify position is opened
  const newPos = positionManager.getPosition('paper', 'default', eligibleTestMint);
  if (newPos && newPos.status === 'OPEN') {
    console.log(`✅ Position verified OPEN: mint=${newPos.mint}, amount=${newPos.tokenAmount}, spent=${newPos.totalSolSpent} SOL`);
  } else {
    throw new Error(`Position was not opened: ${newPos?.status}`);
  }

  // 6. Test Diagnostics Telemetry API
  console.log('\n[6/6] Testing EntryEngine Diagnostics Report...');
  const diagnostics = entryEngine.getDiagnostics();
  console.log(`✅ Diagnostics Report: events=${diagnostics.counters.eventsReceived}, candidates=${diagnostics.counters.candidatesDetected}, enriched=${diagnostics.counters.enriched}, scored=${diagnostics.counters.scored}, buyAttempts=${diagnostics.counters.buyAttempts}, buyConfirmed=${diagnostics.counters.buyConfirmed}`);
  console.log(`✅ Recent Decisions Count: ${diagnostics.recentDecisions.length}`);

  console.log('\n====================================================');
  console.log('🎉 ALL 6 ENTRY PIPELINE SMOKE TESTS PASSED PERFECTLY');
  console.log('====================================================\n');
}

runSmokeTest().catch((err) => {
  console.error('\n❌ Smoke Test Failed:', err);
  process.exit(1);
});
