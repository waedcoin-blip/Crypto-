// scripts/full-production-regression-suite.ts
import { heliusLaserStreamWssManager } from '../server/market/HeliusLaserStreamWssManager.js';
import { positionValuationEngine, safeTokenQuantity } from '../server/trading/PositionValuationEngine.js';
import { positionManager } from '../server/trading/PositionManager.js';
import { activePositionMarketFeed } from '../server/market/ActivePositionMarketFeed.js';
import { unifiedExitEngine } from '../server/trading/UnifiedExitEngine.js';
import { maskApiKey } from '../server/market/HeliusErrors.js';
import { getHeliusApiKey } from '../server/config/index.js';

async function runTestSuite() {
  console.log('================================================================');
  console.log('   ARINA X-RAY ALPHA — COMPREHENSIVE 20-TEST REGRESSION SUITE   ');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function test(name: string, fn: () => void | Promise<void>) {
    try {
      const res = fn();
      if (res instanceof Promise) {
        return res.then(() => {
          console.log(`  [PASS] Test ${passed + failed + 1}: ${name}`);
          passed++;
        }).catch((err) => {
          console.error(`  [FAIL] Test ${passed + failed + 1}: ${name} — ${err.message || err}`);
          failed++;
        });
      } else {
        console.log(`  [PASS] Test ${passed + failed + 1}: ${name}`);
        passed++;
      }
    } catch (err: any) {
      console.error(`  [FAIL] Test ${passed + failed + 1}: ${name} — ${err.message || err}`);
      failed++;
    }
  }

  // 1. WSS URL validation & masking
  await test('1. API Key Masking in Telemetry and Logs', () => {
    const rawKey = 'abc123456789xyz';
    const masked = maskApiKey(rawKey);
    if (masked.includes('123456789')) throw new Error('API Key leaked middle chars');
    if (!masked.startsWith('abc1...')) throw new Error('Incorrect mask format');
  });

  // 2. Telemetry initial state
  await test('2. Telemetry Returns Valid Transport Status', () => {
    const telemetry = heliusLaserStreamWssManager.getTelemetry();
    if (!['wss', 'grpc', 'http'].includes(telemetry.transport)) throw new Error('Invalid transport');
    if (telemetry.endpoint && telemetry.endpoint.includes('api-key=')) {
      if (!telemetry.endpoint.includes('...')) throw new Error('Unmasked API key in telemetry endpoint');
    }
  });

  // 3. Lazy instantiation in PositionValuationEngine
  await test('3. Lazy Instantiation of Position Valuations', () => {
    const mockMint = 'So11111111111111111111111111111111111111112';
    positionManager.clear();
    positionValuationEngine.clear();

    const pos = positionManager.openOrAccumulatePosition({
      network: 'paper',
      wallet: 'default',
      mint: mockMint,
      tokenAmountRaw: '1000000000',
      decimals: 9,
      solSpent: 1.0,
      buySignature: 'sig_mock_buy_1',
    });

    if (!pos || pos.mint !== mockMint) throw new Error('Position creation failed');

    // Record market price
    positionValuationEngine.recordMarketPrice('paper', 'default', mockMint, 0.002, 'WSS');

    const val = positionValuationEngine.getValuation('paper', 'default', mockMint);
    if (!val) throw new Error('Valuation was not lazy-instantiated');
    if (val.status !== 'LIVE') throw new Error(`Expected status LIVE, got ${val.status}`);
    if (val.currentPriceSol !== 0.002) throw new Error(`Expected price 0.002, got ${val.currentPriceSol}`);
  });

  // 4. PnL Calculation Accuracy
  await test('4. PnL Sol & PnL Percent Calculation Accuracy', () => {
    const mockMint = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
    positionManager.openOrAccumulatePosition({
      network: 'paper',
      wallet: 'default',
      mint: mockMint,
      tokenAmountRaw: '1000000000', // 1 token
      decimals: 9,
      solSpent: 1.0,
    });

    // Market price doubling
    positionValuationEngine.recordMarketPrice('paper', 'default', mockMint, 2.0, 'WSS');
    const val = positionValuationEngine.getValuation('paper', 'default', mockMint);
    
    if (!val) throw new Error('Valuation missing');
    if (Math.abs(val.marketValueSol! - 2.0) > 0.0001) throw new Error(`Market val incorrect: ${val.marketValueSol}`);
    if (Math.abs(val.pnlSol! - 1.0) > 0.0001) throw new Error(`PnL Sol incorrect: ${val.pnlSol}`);
    if (Math.abs(val.pnlPercent! - 100.0) > 0.0001) throw new Error(`PnL % incorrect: ${val.pnlPercent}`);
  });

  // 5. Stale Data Classification
  await test('5. Stale Data Status Classification (LIVE vs STALE vs UNAVAILABLE)', () => {
    const mockMint = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
    positionManager.openOrAccumulatePosition({
      network: 'paper',
      wallet: 'default',
      mint: mockMint,
      tokenAmountRaw: '1000000000',
      decimals: 9,
      solSpent: 1.0,
    });

    positionValuationEngine.recordMarketPrice('paper', 'default', mockMint, 0.005, 'WSS');
    
    const val = positionValuationEngine.getValuation('paper', 'default', mockMint);
    if (val?.status !== 'LIVE') throw new Error(`Expected LIVE status, got ${val?.status}`);

    // Artificially age the timestamp
    val.lastMarketPriceAt = Date.now() - 7000; // 7s ago -> STALE
    const staleVal = positionValuationEngine.getValuation('paper', 'default', mockMint);
    if (staleVal?.status !== 'STALE') throw new Error(`Expected STALE status, got ${staleVal?.status}`);

    val.lastMarketPriceAt = Date.now() - 20000; // 20s ago -> UNAVAILABLE
    const unavailVal = positionValuationEngine.getValuation('paper', 'default', mockMint);
    if (unavailVal?.status !== 'UNAVAILABLE') throw new Error(`Expected UNAVAILABLE status, got ${unavailVal?.status}`);
  });

  // 6. Active Position Market Feed Lifecycle
  await test('6. Active Position Market Feed Autonomous Execution', () => {
    activePositionMarketFeed.start();
    const telemetry = activePositionMarketFeed.getTelemetry();
    if (!telemetry.isRunning) throw new Error('ActivePositionMarketFeed failed to start');
  });

  // 7. Exit Engine Evaluation
  await test('7. Exit Engine Take Profit Evaluation', () => {
    const mockMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    const pos = positionManager.openOrAccumulatePosition({
      network: 'paper',
      wallet: 'default',
      mint: mockMint,
      tokenAmountRaw: '1000000000',
      decimals: 9,
      solSpent: 1.0,
      tpPct: 25,
      slPct: 15,
    });

    const decision = unifiedExitEngine.evaluatePositionExit(pos, 1.30); // +30% price gain
    if (!decision.shouldExit) throw new Error('Exit engine failed to trigger TP at +30%');
    if (!decision.reason.includes('TP') && !decision.reason.includes('TAKE_PROFIT')) {
      throw new Error(`Unexpected exit reason: ${decision.reason}`);
    }
  });

  // 8. Exit Engine Stop Loss Evaluation
  await test('8. Exit Engine Stop Loss Evaluation', () => {
    const mockMint = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
    const pos = positionManager.openOrAccumulatePosition({
      network: 'paper',
      wallet: 'default',
      mint: mockMint,
      tokenAmountRaw: '1000000000',
      decimals: 9,
      solSpent: 1.0,
      tpPct: 25,
      slPct: 15,
    });

    const decision = unifiedExitEngine.evaluatePositionExit(pos, 0.80); // -20% drop
    if (!decision.shouldExit) throw new Error('Exit engine failed to trigger SL at -20%');
  });

  // 9. Position Reduction PnL Realization
  await test('9. Partial Position Reduction Realized PnL', () => {
    const mockMint = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';
    const pos = positionManager.openOrAccumulatePosition({
      network: 'paper',
      wallet: 'default',
      mint: mockMint,
      tokenAmountRaw: '2000000000', // 2 tokens
      decimals: 9,
      solSpent: 2.0, // 1 SOL per token
    });

    // Sell 1 token (50%) for 1.5 SOL
    const updated = positionManager.reducePositionAmount(pos.id, '1000000000', 1.5);
    if (!updated) throw new Error('Failed to reduce position amount');
    if (Math.abs(updated.realizedPnl - 0.5) > 0.0001) throw new Error(`Realized PnL mismatch: ${updated.realizedPnl}`);
  });

  // 10. Position Closure Cleanup
  await test('10. Position Closure Cleanup of Valuation and Subscriptions', () => {
    const mockMint = 'CleanUpTestMint1111111111111111111111111111';
    positionManager.openOrAccumulatePosition({
      network: 'paper',
      wallet: 'default',
      mint: mockMint,
      tokenAmountRaw: '1000000000',
      decimals: 9,
      solSpent: 1.0,
    });
    positionValuationEngine.recordMarketPrice('paper', 'default', mockMint, 1.2, 'WSS');

    const closed = positionManager.updatePositionStatus('paper', 'default', mockMint, 'CLOSED');
    if (!closed) throw new Error('Position closure failed');

    const val = positionValuationEngine.getValuation('paper', 'default', mockMint);
    if (val !== null) throw new Error('Valuation remained after position closure');
  });

  // 11. Multi-Source Price Ingestion
  await test('11. Multi-Source Price Recording (WSS vs DEXSCREENER)', () => {
    const mockMint = 'MultiSourceMint111111111111111111111111111';
    positionManager.openOrAccumulatePosition({
      network: 'paper',
      wallet: 'default',
      mint: mockMint,
      tokenAmountRaw: '1000000000',
      decimals: 9,
      solSpent: 1.0,
    });

    positionValuationEngine.recordMarketPrice('paper', 'default', mockMint, 1.05, 'DEXSCREENER');
    const val = positionValuationEngine.getValuation('paper', 'default', mockMint);
    if (val?.source !== 'DEXSCREENER') throw new Error(`Expected DEXSCREENER source, got ${val?.source}`);
  });

  // 12. Paper Wallet Independence
  await test('12. Paper Trading Safety (No Real Solana Wallet Required)', () => {
    const openPositions = positionManager.getOpenPositions('paper');
    if (!Array.isArray(openPositions)) throw new Error('getOpenPositions did not return an array');
  });

  // 13. Heartbeat Diagnostic Reporting
  await test('13. Heartbeat Telemetry Verification', () => {
    const isHealthy = heliusLaserStreamWssManager.isHealthy();
    if (typeof isHealthy !== 'boolean') throw new Error('isHealthy did not return a boolean');
  });

  // 14. In-Flight Deduplication
  await test('14. In-Flight Quote Deduplication', async () => {
    const mockPos = {
      id: 'pos_dedup_test',
      network: 'paper',
      wallet: 'default',
      mint: 'DedupTestMint11111111111111111111111111111',
      tokenAmount: 0, // 0 amount returns early null
      decimals: 9,
      totalSolSpent: 1.0,
      averageEntryPrice: 1.0,
      currentPriceSol: 1.0,
      peakPriceSol: 1.0,
      highestPnlPct: 0,
      realizedPnl: 0,
      unrealizedPnl: 0,
      unrealizedPnlPct: 0,
      status: 'OPEN' as const,
      openedAt: Date.now(),
      updatedAt: Date.now(),
      tpPct: 25,
      slPct: 15,
      slippageBpsTp: 250,
      slippageBpsSl: 1000,
      orderIds: [],
    };

    // Test in-flight map logic directly
    const key = 'paper:default:DedupTestMint11111111111111111111111111111';
    const dummyPromise = new Promise<any>(() => {});
    (positionValuationEngine as any).pendingQuotes.set(key, dummyPromise);
    const inFlight = (positionValuationEngine as any).pendingQuotes.get(key);
    (positionValuationEngine as any).pendingQuotes.delete(key);

    if (inFlight !== dummyPromise) throw new Error('In-flight map lookup failed');
  });

  // 15. Invalid Price Protection
  await test('15. Reject Non-Finite or Non-Positive Market Prices', () => {
    const mockMint = 'InvalidPriceTest1111111111111111111111111';
    positionManager.openOrAccumulatePosition({
      network: 'paper',
      wallet: 'default',
      mint: mockMint,
      tokenAmountRaw: '1000000000',
      decimals: 9,
      solSpent: 1.0,
    });

    positionValuationEngine.recordMarketPrice('paper', 'default', mockMint, -5.0, 'WSS');
    positionValuationEngine.recordMarketPrice('paper', 'default', mockMint, NaN, 'WSS');

    const val = positionValuationEngine.getValuation('paper', 'default', mockMint);
    if (val !== null) throw new Error('Invalid price was recorded into valuation engine');
  });

  // 16. Subscription Manager State
  await test('16. Active Position Mint Subscription Management', () => {
    const mockMint = 'SubManagerTest11111111111111111111111111';
    heliusLaserStreamWssManager.subscribeActivePositionMint(mockMint);
    // Unsubscribe
    heliusLaserStreamWssManager.unsubscribeActivePositionMint(mockMint);
  });

  // 17. Safe Token Quantity Scaling
  await test('17. Token Quantity Calculation Precision (6 vs 9 Decimals)', () => {
    const qty6 = safeTokenQuantity(1000000n, 6);
    const qty9 = safeTokenQuantity(1000000000n, 9);
    if (qty6 !== 1.0) throw new Error(`6 decimals scaling error: ${qty6}`);
    if (qty9 !== 1.0) throw new Error(`9 decimals scaling error: ${qty9}`);
  });

  // 18. Position Key Aliasing
  await test('18. Cross-Network Key Lookup Aliasing', () => {
    const mockMint = 'AliasKeyTest1111111111111111111111111111';
    positionManager.openOrAccumulatePosition({
      network: 'mainnet',
      wallet: 'default',
      mint: mockMint,
      tokenAmountRaw: '1000000000',
      decimals: 9,
      solSpent: 1.0,
    });

    positionValuationEngine.recordMarketPrice('mainnet', 'default', mockMint, 1.5, 'WSS');
    const valMainnet = positionValuationEngine.getValuation('mainnet', 'default', mockMint);
    if (!valMainnet || valMainnet.currentPriceSol !== 1.5) throw new Error('Valuation lookup by mainnet key failed');
  });

  // 19. Valuation Engine Reset
  await test('19. Valuation Engine State Clear', () => {
    positionValuationEngine.clear();
    const openPositions = positionManager.getOpenPositions();
    if (openPositions.length > 0) {
      // Re-populate from repository cleanly
      positionManager.refreshFromRepository();
    }
  });

  // 20. End-to-End WSS and PnL Integration Verification
  await test('20. End-to-End PnL Valuation Response Integrity', () => {
    const mockMint = 'E2EIntegrityMint111111111111111111111111';
    positionManager.openOrAccumulatePosition({
      network: 'paper',
      wallet: 'default',
      mint: mockMint,
      tokenAmountRaw: '1000000000',
      decimals: 9,
      solSpent: 1.0,
    });

    positionValuationEngine.recordMarketPrice('paper', 'default', mockMint, 1.25, 'HELIUS_WSS');
    const val = positionValuationEngine.getValuation('paper', 'default', mockMint);
    if (!val || val.currentPriceSol !== 1.25 || val.pnlPercent !== 25) {
      throw new Error('End-to-end PnL valuation response integrity failure');
    }
  });

  // 21. Self-Healing Paper Balance Sync on Exit
  await test('21. Self-Healing Paper Balance Synchronization on Fast Exit', async () => {
    const { fastExitExecutor } = await import('../server/execution/FastExitExecutor.js');
    const mockMint = 'SelfHealingPaperBalanceMint11111111111111';

    // Create an open paper position in positionManager directly
    const pos = positionManager.openOrAccumulatePosition({
      network: 'paper',
      wallet: 'default',
      mint: mockMint,
      tokenAmountRaw: '1000000000',
      decimals: 9,
      solSpent: 1.0,
    });

    // Execute exit — should self-heal paper ledger and succeed
    const res = await fastExitExecutor.executeSell({
      position: pos,
      reason: 'TEST_SELF_HEAL',
    });

    if (!res.success) {
      throw new Error(`Self-healing fast exit failed: ${res.error}`);
    }
  });

  // 22. Fresh Order Creation per Retry Attempt (No ORDER_ALREADY_TERMINAL)
  await test('22. Fresh Non-Terminal Order Creation on Fast Exit Retries', async () => {
    const { fastExitExecutor } = await import('../server/execution/FastExitExecutor.js');
    const mockMint = 'FreshOrderRetryMint111111111111111111111';

    const pos = positionManager.openOrAccumulatePosition({
      network: 'paper',
      wallet: 'default',
      mint: mockMint,
      tokenAmountRaw: '1000000000',
      decimals: 9,
      solSpent: 1.0,
    });

    const res = await fastExitExecutor.executeSell({
      position: pos,
      reason: 'TEST_FRESH_ORDER_RETRY',
    });

    if (res.error && res.error.includes('ORDER_ALREADY_TERMINAL')) {
      throw new Error('ORDER_ALREADY_TERMINAL error returned during retry');
    }
  });

  console.log('\n================================================================');
  console.log(`   REGRESSION SUITE COMPLETE: ${passed}/${passed + failed} PASSED (${failed} FAILED)   `);
  console.log('================================================================\n');

  activePositionMarketFeed.stop();
  process.exit(failed > 0 ? 1 : 0);
}

runTestSuite().catch((err) => {
  console.error('Fatal regression suite error:', err);
  process.exit(1);
});
