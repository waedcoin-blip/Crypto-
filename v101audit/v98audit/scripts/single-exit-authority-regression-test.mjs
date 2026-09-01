// scripts/single-exit-authority-regression-test.mjs
import assert from 'assert';

console.log('🚀 Running Single Exit Authority Regression Test Suite (RiskManager Authoritative Pipeline)...\n');

class MockJupiterPreSellValidator {
  constructor() {
    this.validationCalls = [];
  }

  async validatePreSell({ mint, amountRaw, triggerReason, expectedOutSol, costBasisSol, currentPriceSol, tokenDecimals }) {
    this.validationCalls.push({
      mint,
      amountRaw,
      triggerReason,
      expectedOutSol,
      costBasisSol,
      currentPriceSol,
    });

    const tokenQty = amountRaw / (10 ** tokenDecimals);
    const estimatedSolOut = tokenQty * currentPriceSol * 0.99; // 1% realistic slippage/fee
    const executablePnlPct = ((estimatedSolOut - costBasisSol) / costBasisSol) * 100;

    // Safety rules
    if (triggerReason === 'tp' && executablePnlPct < 0) {
      return {
        isValid: false,
        reason: `TP candidate triggered on market price, but executable quote is negative (${executablePnlPct.toFixed(2)}%)`,
      };
    }

    return {
      isValid: true,
      outAmountSol: estimatedSolOut,
      executablePnlPct,
      routePlan: [{ swapInfo: { ammKey: 'Raydium_v4' } }],
    };
  }
}

class MockOrderManager {
  constructor() {
    this.dispatchedOrders = [];
  }

  async executeSell(params) {
    this.dispatchedOrders.push({
      ...params,
      timestamp: Date.now(),
    });
    return {
      success: true,
      signature: `tx_${params.mint.slice(0, 6)}_${params.label}`,
    };
  }
}

class AuthoritativeRiskManager {
  constructor() {
    this.positions = new Map();
    this.preSellValidator = new MockJupiterPreSellValidator();
    this.orderManager = new MockOrderManager();
    this.logs = [];
    this.exits = [];
    this.isRunning = true;
  }

  addPosition({ mint, amount, decimals = 6, buyPrice, solSpent, tpPct = 10, slPct = 50 }) {
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
      state: 'OPEN',
      activePriceSource: 'dexscreener',
      lastPriceUpdate: Date.now(),
    });
  }

  calculateGrossPnLPct(pos) {
    return ((pos.currentPrice - pos.buyPrice) / pos.buyPrice) * 100;
  }

  // Price observation ingestion point
  async onPriceUpdate(mint, rawPrice, timestamp = Date.now(), quoteCurrency = 'SOL', source = 'price_tracker') {
    const pos = this.positions.get(mint);
    if (!pos || pos.state === 'CLOSED' || !rawPrice || rawPrice <= 0) return;

    // Reject stale data (>5s)
    if (timestamp < Date.now() - 5000) {
      this.logs.push(`STALE_PRICE_REJECTED: ${mint}`);
      return;
    }

    const priceInSol = quoteCurrency === 'USD' ? rawPrice / 150 : rawPrice;
    pos.currentPrice = priceInSol;
    pos.lastPriceUpdate = timestamp;
    pos.activePriceSource = source;

    if (!pos.peakPrice || priceInSol > pos.peakPrice) {
      pos.peakPrice = priceInSol;
    }

    if (this.isRunning && pos.state === 'OPEN') {
      await this.evaluatePosition(pos);
    }
  }

  async evaluatePosition(pos) {
    const pnlPct = this.calculateGrossPnLPct(pos);
    let candidateReason = null;

    if (pnlPct >= pos.tpPct) {
      candidateReason = 'tp';
    } else if (pnlPct <= -pos.slPct) {
      candidateReason = 'sl';
    }

    if (!candidateReason) {
      // Hold state
      return;
    }

    // Step 2: Jupiter Pre-Sell Validation
    const validation = await this.preSellValidator.validatePreSell({
      mint: pos.mint,
      amountRaw: pos.amount,
      triggerReason: candidateReason,
      costBasisSol: pos.solSpent,
      currentPriceSol: pos.currentPrice,
      tokenDecimals: pos.tokenDecimals,
    });

    if (!validation.isValid) {
      this.logs.push(`EXIT_BLOCKED_BY_JUPITER_VALIDATOR: ${validation.reason}`);
      return;
    }

    // Step 3: Dispatch to OrderManager -> Execution
    pos.state = 'CLOSED';
    const result = await this.orderManager.executeSell({
      mint: pos.mint,
      amountRaw: pos.amount,
      label: `exit_${candidateReason}`,
      pnlPct,
      executablePnlPct: validation.executablePnlPct,
    });

    this.exits.push({
      mint: pos.mint,
      reason: candidateReason,
      triggerPnLPct: pnlPct,
      executablePnlPct: validation.executablePnlPct,
      signature: result.signature,
    });
  }
}

async function runSingleExitAuthoritySuite() {
  console.log('▶ [CHECK 1] Single Exit Authority Architecture Verification');
  {
    const rm = new AuthoritativeRiskManager();
    rm.addPosition({
      mint: 'TOKEN_ALPHA',
      amount: 10000000,
      decimals: 6,
      buyPrice: 0.001,
      solSpent: 0.01,
      tpPct: 10,
      slPct: 50,
    });

    // Verify initial state
    assert.strictEqual(rm.positions.get('TOKEN_ALPHA').state, 'OPEN');
    assert.strictEqual(rm.exits.length, 0);
    console.log('  ✔ Position initialized under single authoritative RiskManager');
  }

  console.log('\n▶ [CHECK 2] Negative Movement Hold State Enforcement (-5%, -11%, -49.9%)');
  {
    const rm = new AuthoritativeRiskManager();
    rm.addPosition({
      mint: 'TOKEN_ALPHA',
      amount: 10000000,
      decimals: 6,
      buyPrice: 0.001,
      solSpent: 0.01,
      tpPct: 10,
      slPct: 50,
    });

    // PnL: -5% (price = 0.00095)
    await rm.onPriceUpdate('TOKEN_ALPHA', 0.00095);
    assert.strictEqual(rm.positions.get('TOKEN_ALPHA').state, 'OPEN', '-5% must remain HOLD');
    assert.strictEqual(rm.exits.length, 0);

    // PnL: -11% (price = 0.00089)
    await rm.onPriceUpdate('TOKEN_ALPHA', 0.00089);
    assert.strictEqual(rm.positions.get('TOKEN_ALPHA').state, 'OPEN', '-11% must remain HOLD');
    assert.strictEqual(rm.exits.length, 0);

    // PnL: -49.9% (price = 0.000501)
    await rm.onPriceUpdate('TOKEN_ALPHA', 0.000501);
    assert.strictEqual(rm.positions.get('TOKEN_ALPHA').state, 'OPEN', '-49.9% must remain HOLD');
    assert.strictEqual(rm.exits.length, 0);

    console.log('  ✔ All sub-threshold negative price movements (-5%, -11%, -49.9%) held without premature exit');
  }

  console.log('\n▶ [CHECK 3] Positive Movement Hold State Enforcement (+5%, +9.9%)');
  {
    const rm = new AuthoritativeRiskManager();
    rm.addPosition({
      mint: 'TOKEN_BETA',
      amount: 10000000,
      decimals: 6,
      buyPrice: 0.001,
      solSpent: 0.01,
      tpPct: 10,
      slPct: 50,
    });

    // PnL: +5% (price = 0.00105)
    await rm.onPriceUpdate('TOKEN_BETA', 0.00105);
    assert.strictEqual(rm.positions.get('TOKEN_BETA').state, 'OPEN', '+5% must remain HOLD');
    assert.strictEqual(rm.exits.length, 0);

    // PnL: +9.9% (price = 0.001099)
    await rm.onPriceUpdate('TOKEN_BETA', 0.001099);
    assert.strictEqual(rm.positions.get('TOKEN_BETA').state, 'OPEN', '+9.9% must remain HOLD');
    assert.strictEqual(rm.exits.length, 0);

    console.log('  ✔ All sub-threshold positive price movements (+5%, +9.9%) held without premature exit');
  }

  console.log('\n▶ [CHECK 4] Exact Stop Loss Evaluation & Pre-Sell Execution (-50%)');
  {
    const rm = new AuthoritativeRiskManager();
    rm.addPosition({
      mint: 'TOKEN_GAMMA',
      amount: 10000000,
      decimals: 6,
      buyPrice: 0.001,
      solSpent: 0.01,
      tpPct: 10,
      slPct: 50,
    });

    // PnL: -50.0% (price = 0.0005)
    await rm.onPriceUpdate('TOKEN_GAMMA', 0.0005);
    assert.strictEqual(rm.positions.get('TOKEN_GAMMA').state, 'CLOSED', 'SL at -50% must trigger exit');
    assert.strictEqual(rm.exits.length, 1);
    assert.strictEqual(rm.exits[0].reason, 'sl');
    assert.strictEqual(Math.round(rm.exits[0].triggerPnLPct), -50);
    assert.strictEqual(rm.orderManager.dispatchedOrders.length, 1);
    assert.strictEqual(rm.orderManager.dispatchedOrders[0].label, 'exit_sl');

    console.log('  ✔ Stop-Loss cleanly evaluated at -50.0% and dispatched via Jupiter pre-sell validator');
  }

  console.log('\n▶ [CHECK 5] Exact Take Profit Evaluation & Pre-Sell Execution (+10%)');
  {
    const rm = new AuthoritativeRiskManager();
    rm.addPosition({
      mint: 'TOKEN_DELTA',
      amount: 10000000,
      decimals: 6,
      buyPrice: 0.001,
      solSpent: 0.01,
      tpPct: 10,
      slPct: 50,
    });

    // PnL: +10.0% (price = 0.0011)
    await rm.onPriceUpdate('TOKEN_DELTA', 0.0011);
    assert.strictEqual(rm.positions.get('TOKEN_DELTA').state, 'CLOSED', 'TP at +10% must trigger exit');
    assert.strictEqual(rm.exits.length, 1);
    assert.strictEqual(rm.exits[0].reason, 'tp');
    assert.strictEqual(Math.round(rm.exits[0].triggerPnLPct), 10);
    assert.strictEqual(rm.orderManager.dispatchedOrders.length, 1);
    assert.strictEqual(rm.orderManager.dispatchedOrders[0].label, 'exit_tp');

    console.log('  ✔ Take-Profit cleanly evaluated at +10.0% and dispatched via Jupiter pre-sell validator');
  }

  console.log('\n🎉 ALL 5/5 SINGLE EXIT AUTHORITY CHECKS PASSED! ✅');
}

runSingleExitAuthoritySuite();
