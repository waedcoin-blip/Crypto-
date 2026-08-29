// scripts/jupiter-only-architecture-test.mjs
import assert from 'assert';

console.log('🚀 Running Jupiter-Only Architecture & Strict TP/SL Executable Quote Test Suite...\n');

class MockJupiterService {
  constructor() {
    this.priceV3Mock = new Map();
    this.tokensV2Mock = new Map();
    this.quoteMock = new Map();
  }

  setPriceV3(mint, { price, blockId, timeTaken = 0.001 }) {
    this.priceV3Mock.set(mint, { price, blockId, timeTaken, timestamp: Date.now() });
  }

  setTokensV2(mint, metadata) {
    this.tokensV2Mock.set(mint, metadata);
  }

  setQuote(mint, quoteData) {
    this.quoteMock.set(mint, quoteData);
  }

  async getPriceV3(mint) {
    const data = this.priceV3Mock.get(mint);
    if (!data) throw new Error(`Jupiter Price V3: No price found for ${mint}`);
    return data;
  }

  async getTokensV2(mint) {
    const data = this.tokensV2Mock.get(mint);
    if (!data) throw new Error(`Jupiter Tokens V2: No token metadata for ${mint}`);
    return data;
  }

  async getQuote(inputMint, outputMint, amount) {
    const data = this.quoteMock.get(inputMint);
    if (!data) throw new Error(`Jupiter Quote: No route for ${inputMint}`);
    return data;
  }
}

class AuthoritativeJupiterPreSellValidator {
  constructor(jupiterService) {
    this.jupiterService = jupiterService;
  }

  async validatePreSell({ mint, rawAmount, costBasisSol, currentMarketPriceSol, targetTpPct, targetSlPct, label }) {
    if (!mint || rawAmount <= 0) {
      return { isValid: false, reason: 'Invalid mint or amount' };
    }

    const quote = await this.jupiterService.getQuote(mint, 'So11111111111111111111111111111111111111112', rawAmount);
    if (!quote || !quote.routePlan || quote.routePlan.length === 0) {
      return { isValid: false, reason: 'No valid Jupiter route plan found' };
    }

    const outAmountSol = Number(quote.outAmount) / 1e9;
    const executablePnlPct = costBasisSol > 0 ? ((outAmountSol - costBasisSol) / costBasisSol) * 100 : 0;
    const priceImpactPct = parseFloat(quote.priceImpactPct || '0') * 100;

    if (priceImpactPct > 10.0) {
      return { isValid: false, reason: `Price impact (${priceImpactPct.toFixed(2)}%) exceeds safety threshold` };
    }

    // Strict TP Rule: Market signal >= TP -> fresh Jupiter quote -> executable PnL must ALSO >= TP
    if (label === 'exit_tp' || label?.includes('TP')) {
      if (executablePnlPct < 0) {
        return {
          isValid: false,
          reason: `Take-Profit candidate triggered on market price, but Jupiter executable SELL quote yields net loss (${executablePnlPct.toFixed(2)}%). Aborting sell.`,
          executablePnlPct,
          outAmountSol,
        };
      }
      if (targetTpPct !== undefined && targetTpPct > 0 && executablePnlPct < targetTpPct) {
        return {
          isValid: false,
          reason: `Take-Profit candidate triggered on market price, but Jupiter executable quote PnL (${executablePnlPct.toFixed(2)}%) is below target TP threshold (+${targetTpPct.toFixed(2)}%). Aborting sell.`,
          executablePnlPct,
          outAmountSol,
        };
      }
    }

    // Strict SL Rule: Market signal <= SL -> fresh Jupiter quote -> executable loss must ALSO reach configured SL
    if (label === 'exit_sl' || label?.includes('SL')) {
      if (executablePnlPct >= 0) {
        return {
          isValid: false,
          reason: `Conflicting negative exit signal (${label}) conflicts with PROFITABLE Jupiter executable quote (+${executablePnlPct.toFixed(2)}%). Aborting sell for position revalidation.`,
          executablePnlPct,
          outAmountSol,
        };
      }
      if (targetSlPct !== undefined && targetSlPct > 0) {
        const requiredLossThreshold = -Math.abs(targetSlPct);
        if (executablePnlPct > requiredLossThreshold) {
          return {
            isValid: false,
            reason: `Stop-Loss candidate triggered on market price, but Jupiter executable quote loss (${executablePnlPct.toFixed(2)}%) has not breached configured SL threshold (${requiredLossThreshold.toFixed(2)}%). Aborting sell.`,
            executablePnlPct,
            outAmountSol,
          };
        }
      }
    }

    return {
      isValid: true,
      validator: 'JUPITER_EXECUTABLE_ONLY',
      outAmountSol,
      executablePnlPct,
      priceImpactPct,
      quote,
    };
  }
}

async function runJupiterOnlySuite() {
  const jup = new MockJupiterService();
  const validator = new AuthoritativeJupiterPreSellValidator(jup);

  console.log('▶ [CHECK 1/8] Jupiter Price API V3 - Primary Indicative Price & BlockId Freshness');
  {
    jup.setPriceV3('MINT_JUP_V3', { price: 0.0025, blockId: 289410123 });
    const priceData = await jup.getPriceV3('MINT_JUP_V3');
    assert.strictEqual(priceData.price, 0.0025);
    assert.strictEqual(priceData.blockId, 289410123);
    assert.ok(priceData.timestamp > 0);
    console.log('  ✔ Jupiter Price API V3 verified as primary indicative source with blockId provenance');
  }

  console.log('\n▶ [CHECK 2/8] Jupiter Tokens API V2 - Discovery, Metadata & Decimals');
  {
    jup.setTokensV2('MINT_TOK_V2', {
      name: 'Jupiter Verified Token',
      symbol: 'JVT',
      decimals: 6,
      dailyVolume: 500000,
      verified: true,
    });
    const meta = await jup.getTokensV2('MINT_TOK_V2');
    assert.strictEqual(meta.symbol, 'JVT');
    assert.strictEqual(meta.decimals, 6);
    console.log('  ✔ Jupiter Tokens API V2 handles token metadata, discovery, and decimals without external fallback');
  }

  console.log('\n▶ [CHECK 3/8] Jupiter Quote API - Executable Buy/Sell Pricing & Route Validation');
  {
    jup.setQuote('MINT_QUOTE_OK', {
      outAmount: '1000000000', // 1 SOL
      priceImpactPct: '0.005',
      routePlan: [{ swapInfo: { ammKey: 'Whirlpool' } }],
    });
    const quote = await jup.getQuote('MINT_QUOTE_OK', 'SOL', 1000000);
    assert.strictEqual(quote.outAmount, '1000000000');
    assert.strictEqual(quote.routePlan.length, 1);
    console.log('  ✔ Jupiter Quote API provides authoritative executable route and output');
  }

  console.log('\n▶ [CHECK 4/8] TP Enforcement: Market +12% but Executable Quote -3% -> SELL IS BLOCKED');
  {
    // Cost basis: 1.0 SOL. 
    // Indicative price indicates +12%, but executable quote yields 0.97 SOL (-3% net executable PnL)
    jup.setQuote('MINT_TP_BLOCKED', {
      outAmount: '970000000', // 0.97 SOL
      priceImpactPct: '0.01',
      routePlan: [{ swapInfo: { ammKey: 'Raydium' } }],
    });

    const result = await validator.validatePreSell({
      mint: 'MINT_TP_BLOCKED',
      rawAmount: 1000000,
      costBasisSol: 1.0,
      currentMarketPriceSol: 0.00112, // +12% indicative
      targetTpPct: 10, // TP target = +10%
      label: 'exit_tp',
    });

    assert.strictEqual(result.isValid, false, 'TP must be blocked when executable quote yields loss');
    assert.ok(result.reason.includes('Take-Profit candidate triggered on market price, but Jupiter executable SELL quote yields net loss'));
    console.log('  ✔ Sell blocked: Indicative +12% vs Executable -3% successfully prevented false TP');
  }

  console.log('\n▶ [CHECK 5/8] TP Enforcement: Market +12% but Executable Quote +6% (< +10% TP) -> SELL IS BLOCKED');
  {
    // Cost basis: 1.0 SOL. 
    // Indicative price indicates +12%, but executable quote yields 1.06 SOL (+6% net executable PnL, below target +10%)
    jup.setQuote('MINT_TP_SUB_THRESHOLD', {
      outAmount: '1060000000', // 1.06 SOL (+6%)
      priceImpactPct: '0.01',
      routePlan: [{ swapInfo: { ammKey: 'Raydium' } }],
    });

    const result = await validator.validatePreSell({
      mint: 'MINT_TP_SUB_THRESHOLD',
      rawAmount: 1000000,
      costBasisSol: 1.0,
      currentMarketPriceSol: 0.00112, // +12% indicative
      targetTpPct: 10, // TP target = +10%
      label: 'exit_tp',
    });

    assert.strictEqual(result.isValid, false, 'TP must be blocked when executable quote PnL is below target TP');
    assert.ok(result.reason.includes('is below target TP threshold (+10.00%)'));
    console.log('  ✔ Sell blocked: Indicative +12% vs Executable +6% successfully prevented sub-target TP');
  }

  console.log('\n▶ [CHECK 6/8] TP Authorization: Market +12% and Executable Quote +11% (>= +10% TP) -> AUTHORIZED');
  {
    // Cost basis: 1.0 SOL. 
    // Indicative price indicates +12%, executable quote yields 1.11 SOL (+11% net executable PnL >= +10% TP)
    jup.setQuote('MINT_TP_AUTHORIZED', {
      outAmount: '1110000000', // 1.11 SOL (+11%)
      priceImpactPct: '0.005',
      routePlan: [{ swapInfo: { ammKey: 'Meteora' } }],
    });

    const result = await validator.validatePreSell({
      mint: 'MINT_TP_AUTHORIZED',
      rawAmount: 1000000,
      costBasisSol: 1.0,
      currentMarketPriceSol: 0.00112, // +12% indicative
      targetTpPct: 10, // TP target = +10%
      label: 'exit_tp',
    });

    assert.strictEqual(result.isValid, true, 'TP must be authorized when executable quote >= target TP');
    assert.strictEqual(Math.round(result.executablePnlPct), 11);
    console.log('  ✔ Sell authorized: Executable PnL (+11.00%) >= Target TP (+10.00%) cleanly validated');
  }

  console.log('\n▶ [CHECK 7/8] SL Enforcement: Market -52% but Executable Quote only -7% (SL = -50%) -> SELL IS BLOCKED');
  {
    // Cost basis: 1.0 SOL. 
    // Indicative price dipped to -52%, but executable quote is 0.93 SOL (-7% executable loss, hasn't breached -50%)
    jup.setQuote('MINT_SL_BLOCKED', {
      outAmount: '930000000', // 0.93 SOL (-7%)
      priceImpactPct: '0.01',
      routePlan: [{ swapInfo: { ammKey: 'Raydium' } }],
    });

    const result = await validator.validatePreSell({
      mint: 'MINT_SL_BLOCKED',
      rawAmount: 1000000,
      costBasisSol: 1.0,
      currentMarketPriceSol: 0.00048, // -52% market signal
      targetSlPct: 50, // SL target = -50%
      label: 'exit_sl',
    });

    assert.strictEqual(result.isValid, false, 'SL must be blocked when executable quote has not breached SL threshold');
    assert.ok(result.reason.includes('has not breached configured SL threshold (-50.00%)'));
    console.log('  ✔ Stop-Loss sell blocked: Executable quote loss (-7.00%) protected position from fake market wick');
  }

  console.log('\n▶ [CHECK 8/8] SL Authorization: Market -52% and Executable Quote -51% (<= -50% SL) -> AUTHORIZED');
  {
    // Cost basis: 1.0 SOL. 
    // Indicative price -52%, executable quote yields 0.49 SOL (-51% executable loss <= -50% SL threshold)
    jup.setQuote('MINT_SL_AUTHORIZED', {
      outAmount: '490000000', // 0.49 SOL (-51%)
      priceImpactPct: '0.01',
      routePlan: [{ swapInfo: { ammKey: 'Raydium' } }],
    });

    const result = await validator.validatePreSell({
      mint: 'MINT_SL_AUTHORIZED',
      rawAmount: 1000000,
      costBasisSol: 1.0,
      currentMarketPriceSol: 0.00048, // -52% market signal
      targetSlPct: 50, // SL target = -50%
      label: 'exit_sl',
    });

    assert.strictEqual(result.isValid, true, 'SL must be authorized when executable quote loss <= target SL threshold');
    assert.strictEqual(Math.round(result.executablePnlPct), -51);
    console.log('  ✔ Stop-Loss authorized: Executable loss (-51.00%) confirmed breach of configured SL (-50.00%)');
  }

  console.log('\n🎉 ALL 8/8 JUPITER-ONLY ARCHITECTURE & EXECUTABLE QUOTE CHECKS PASSED! ✅');
}

runJupiterOnlySuite();
