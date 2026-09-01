// scripts/tpsl-evaluation-pipeline-test.mjs
import assert from 'assert';

console.log('🚀 Running TP/SL Evaluation Pipeline & Source Propagation Suite...\n');

// Mock Position State
class MockRiskManager {
  constructor() {
    this.positions = new Map();
    this.logs = [];
    this.exitsExecuted = [];
  }

  addPosition({ mint, amount, decimals = 6, buyPrice, solSpent, tpPct = 25, slPct = 15 }) {
    const calculatedBuyPrice = buyPrice || (solSpent / (amount / (10 ** decimals)));
    this.positions.set(mint, {
      mint,
      amount,
      tokenDecimals: decimals,
      buyPrice: calculatedBuyPrice,
      solSpent,
      tpPct,
      slPct,
      currentPrice: calculatedBuyPrice,
      peakPrice: calculatedBuyPrice,
      highestPnLPct: 0,
      state: 'OPEN',
      activePriceSource: 'dexscreener',
      lastPriceUpdate: Date.now(),
    });
  }

  calculateGrossPnLPct(pos) {
    return ((pos.currentPrice - pos.buyPrice) / pos.buyPrice) * 100;
  }

  onPriceUpdate(mint, rawPrice, timestamp = Date.now(), quoteCurrency = 'SOL', source = 'dexscreener') {
    const pos = this.positions.get(mint);
    if (!pos || pos.state === 'CLOSED' || !rawPrice || rawPrice <= 0 || !Number.isFinite(rawPrice)) return;

    const now = Date.now();
    // Stale timestamp guard: Reject updates older than 5 seconds
    if (timestamp < now - 5000) {
      this.logs.push(`REJECTED_STALE: ${mint}`);
      return;
    }

    // Monotonic timestamp guard: Reject older timestamps
    if (pos.lastPriceUpdate && timestamp < pos.lastPriceUpdate) {
      this.logs.push(`REJECTED_OUT_OF_ORDER: ${mint}`);
      return;
    }

    const priceInSol = quoteCurrency === 'USD' ? rawPrice / 150 : rawPrice;
    if (priceInSol <= 0) return;

    // Direct update: update price and track source origin without PnL bias
    pos.currentPrice = priceInSol;
    pos.lastPriceUpdate = timestamp;
    pos.activePriceSource = source;

    if (!pos.peakPrice || priceInSol > pos.peakPrice) {
      pos.peakPrice = priceInSol;
    }

    const grossPnl = this.calculateGrossPnLPct(pos);
    if (grossPnl > (pos.highestPnLPct || 0)) {
      pos.highestPnLPct = grossPnl;
    }

    this.evaluatePosition(pos);
  }

  async evaluatePosition(pos) {
    const pnlPct = this.calculateGrossPnLPct(pos);
    let candidateReason = null;

    if (pnlPct >= pos.tpPct) {
      candidateReason = 'tp';
    } else if (pnlPct <= -pos.slPct) {
      candidateReason = 'sl';
    }

    if (!candidateReason) return;

    // Safety: Jupiter Executable Pre-Sell Validation is the final check before exit
    const validationResult = await this.mockJupiterPreSellValidation(pos, candidateReason);
    if (!validationResult.isValid) {
      this.logs.push(`PRE_SELL_BLOCKED: ${validationResult.reason}`);
      return;
    }

    // Passed pre-sell validation -> Exit
    pos.state = 'CLOSED';
    this.exitsExecuted.push({
      mint: pos.mint,
      exitReason: candidateReason,
      triggerPriceSol: pos.currentPrice,
      triggerPnLPct: pnlPct,
      executablePnlPct: validationResult.executablePnlPct,
      outAmountSol: validationResult.outAmountSol,
      source: pos.activePriceSource,
    });
  }

  async mockJupiterPreSellValidation(pos, candidateReason) {
    // Mock Jupiter executable quote validation logic
    const tokenQty = pos.amount / (10 ** pos.tokenDecimals);
    const estimatedSolOut = tokenQty * pos.currentPrice * 0.99; // 1% simulated slippage/spread
    const executablePnlPct = ((estimatedSolOut - pos.solSpent) / pos.solSpent) * 100;

    // Safety checks matching JupiterPreSellValidator
    if (candidateReason === 'tp' && executablePnlPct < 0) {
      return {
        isValid: false,
        reason: `Take-Profit candidate triggered on market price, but Jupiter quote yields net loss (${executablePnlPct.toFixed(2)}%).`,
      };
    }

    return {
      isValid: true,
      outAmountSol: estimatedSolOut,
      executablePnlPct,
    };
  }
}

// TEST 1: Both Jupiter and DexScreener prices update the trigger engine without PnL bias
console.log('▶ [TEST 1] Price update ingestion without profit/loss filtering');
{
  const rm = new MockRiskManager();
  rm.addPosition({
    mint: 'MINT_1',
    amount: 10000000,
    buyPrice: 0.0001,
    solSpent: 1.0,
    tpPct: 25,
    slPct: 15,
  });

  // Negative price update from DexScreener
  rm.onPriceUpdate('MINT_1', 0.00009, Date.now(), 'SOL', 'dexscreener');
  let pos = rm.positions.get('MINT_1');
  assert.strictEqual(pos.currentPrice, 0.00009);
  assert.strictEqual(pos.activePriceSource, 'dexscreener');

  // Positive price update from DexScreener (previously blocked by PnL filter, now accepted)
  rm.onPriceUpdate('MINT_1', 0.00011, Date.now(), 'SOL', 'dexscreener');
  pos = rm.positions.get('MINT_1');
  assert.strictEqual(pos.currentPrice, 0.00011);
  assert.strictEqual(pos.activePriceSource, 'dexscreener');

  // Negative price update from Jupiter (previously blocked by PnL filter, now accepted)
  rm.onPriceUpdate('MINT_1', 0.000095, Date.now(), 'SOL', 'jupiter');
  pos = rm.positions.get('MINT_1');
  assert.strictEqual(pos.currentPrice, 0.000095);
  assert.strictEqual(pos.activePriceSource, 'jupiter');

  console.log('  ✔ Both DexScreener and Jupiter prices update position regardless of PnL status');
}

// TEST 2: Source propagation across all 4 supported source types
console.log('\n▶ [TEST 2] Source propagation (Jupiter, DexScreener, RPC/WS, Price Tracker)');
{
  const rm = new MockRiskManager();
  rm.addPosition({
    mint: 'MINT_2',
    amount: 10000000,
    buyPrice: 0.0001,
    solSpent: 1.0,
  });

  const sources = ['jupiter', 'dexscreener', 'rpc_ws', 'price_tracker'];
  for (const src of sources) {
    rm.onPriceUpdate('MINT_2', 0.000105, Date.now(), 'SOL', src);
    const pos = rm.positions.get('MINT_2');
    assert.strictEqual(pos.activePriceSource, src, `Source should be recorded as ${src}`);
  }

  console.log('  ✔ All 4 sources (jupiter, dexscreener, rpc_ws, price_tracker) tracked correctly');
}

// TEST 3: Stale market data rejection
console.log('\n▶ [TEST 3] Stale market data rejection (>5000ms old or backwards in time)');
{
  const rm = new MockRiskManager();
  rm.addPosition({
    mint: 'MINT_3',
    amount: 10000000,
    buyPrice: 0.0001,
    solSpent: 1.0,
  });

  const now = Date.now();
  // Valid initial update
  rm.onPriceUpdate('MINT_3', 0.0001, now, 'SOL', 'dexscreener');

  // Attempt to feed stale update (10 seconds in the past)
  rm.onPriceUpdate('MINT_3', 0.00015, now - 10000, 'SOL', 'dexscreener');
  let pos = rm.positions.get('MINT_3');
  assert.strictEqual(pos.currentPrice, 0.0001, 'Stale price update must be rejected');

  // Attempt to feed out-of-order timestamp
  rm.onPriceUpdate('MINT_3', 0.00015, now - 100, 'SOL', 'jupiter');
  pos = rm.positions.get('MINT_3');
  assert.strictEqual(pos.currentPrice, 0.0001, 'Out-of-order timestamp must be rejected');

  console.log('  ✔ Stale and out-of-order market-data responses are rejected and not forwarded');
}

// TEST 4: Full Pipeline: Fresh valid market price -> TP/SL evaluator -> Jupiter executable pre-sell validation -> exit
console.log('\n▶ [TEST 4] End-to-end pipeline: Market price -> TP/SL evaluator -> Jupiter pre-sell validation -> exit');
async function runTest4() {
  const rm = new MockRiskManager();
  rm.addPosition({
    mint: 'MINT_4',
    amount: 10000000,
    decimals: 6,
    buyPrice: 0.0001,
    solSpent: 0.001,
    tpPct: 20,
    slPct: 15,
  });

  const now = Date.now() + 10;
  // Send fresh market price triggering TP (+30% > 20% TP)
  rm.onPriceUpdate('MINT_4', 0.00013, now, 'SOL', 'rpc_ws');

  // Give async evaluatePosition a moment
  await new Promise(r => setTimeout(r, 50));

  assert.strictEqual(rm.exitsExecuted.length, 1);
  const exit = rm.exitsExecuted[0];
  assert.strictEqual(exit.mint, 'MINT_4');
  assert.strictEqual(exit.exitReason, 'tp');
  assert.strictEqual(exit.source, 'rpc_ws');
  assert.strictEqual(Math.round(exit.triggerPnLPct), 30);
  assert(exit.executablePnlPct > 0);

  console.log('  ✔ TP trigger validated by Jupiter executable pre-sell check and executed cleanly');
}

runTest4().then(() => {
  console.log('\n🎉 ALL TP/SL EVALUATION PIPELINE AND SOURCE PROPAGATION TESTS PASSED!');
});
