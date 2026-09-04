// server/trading/ProfitabilityEngine.ts
import { EnrichedCandidate } from './CandidateEnricher.js';
import { jupiterTradingService } from '../services/JupiterTradingService.js';
import { defaultTradingConfig } from '../config/TradingConfig.js';

export const SOL_MINT = 'So11111111111111111111111111111111111111112';

export interface ExecutableProfitabilityMetrics {
  mint: string;
  buyInputLamports: bigint;
  expectedTokensRaw: bigint;
  expectedExitLamports: bigint;
  networkFeesLamports: bigint;
  priorityFeesLamports: bigint;
  dexFeesLamports: bigint;
  totalExecutionCostsLamports: bigint;
  expectedNetProfitLamports: bigint;
  expectedNetProfitPercent: number;
  quoteFreshnessMs: number;
  status: 'AUTHORIZED' | 'UNPROFITABLE' | 'STALE' | 'DATA_UNAVAILABLE' | 'BLOCKED';
  reason?: string;
  buyQuote?: any;
  sellQuote?: any;
}

export class ProfitabilityEngine {
  private static instance: ProfitabilityEngine;

  private constructor() {}

  public static getInstance(): ProfitabilityEngine {
    if (!ProfitabilityEngine.instance) {
      ProfitabilityEngine.instance = new ProfitabilityEngine();
    }
    return ProfitabilityEngine.instance;
  }

  /**
   * Calculates executable SOL profitability using fresh Jupiter BUY and SELL quotes in BigInt lamports.
   */
  public async evaluateExecutableProfitability(
    mint: string,
    buyInputLamports: bigint,
    slippageBps: number = 250
  ): Promise<ExecutableProfitabilityMetrics> {
    const startTime = Date.now();

    if (!mint || buyInputLamports <= 0n) {
      return this.createBlockedMetrics(mint, buyInputLamports, 'INVALID_INPUTS', 'DATA_UNAVAILABLE');
    }

    try {
      // 1. Fetch Jupiter BUY Quote (SOL -> Mint)
      const buyQuote = await jupiterTradingService.getQuote({
        inputMint: SOL_MINT,
        outputMint: mint,
        amount: buyInputLamports,
        slippageBps,
      });

      if (!buyQuote || !buyQuote.outAmount) {
        return this.createBlockedMetrics(mint, buyInputLamports, 'NO_BUY_QUOTE_AVAILABLE', 'DATA_UNAVAILABLE');
      }

      const expectedTokensRaw = BigInt(buyQuote.outAmount);
      if (expectedTokensRaw <= 0n) {
        return this.createBlockedMetrics(mint, buyInputLamports, 'ZERO_EXPECTED_TOKENS', 'UNPROFITABLE');
      }

      // 2. Fetch Jupiter SELL Quote (Mint -> SOL) for resulting token amount
      let sellQuote: any = null;
      try {
        sellQuote = await jupiterTradingService.getQuote({
          inputMint: mint,
          outputMint: SOL_MINT,
          amount: expectedTokensRaw,
          slippageBps,
        });
      } catch (err: any) {
        return this.createBlockedMetrics(
          mint,
          buyInputLamports,
          `SELL_QUOTE_FAILED: ${err?.message || err}`,
          'DATA_UNAVAILABLE'
        );
      }

      if (!sellQuote || !sellQuote.outAmount) {
        return this.createBlockedMetrics(mint, buyInputLamports, 'NO_SELL_QUOTE_AVAILABLE', 'DATA_UNAVAILABLE');
      }

      const expectedExitLamports = BigInt(sellQuote.outAmount);
      const quoteAgeMs = Date.now() - startTime;

      if (quoteAgeMs > defaultTradingConfig.maxQuoteAgeMs) {
        return this.createBlockedMetrics(
          mint,
          buyInputLamports,
          `QUOTE_EXPIRED: Quote latency ${quoteAgeMs}ms exceeds max ${defaultTradingConfig.maxQuoteAgeMs}ms`,
          'STALE'
        );
      }

      // 3. Execution Costs in BigInt Lamports
      const networkFeesLamports = 10_000n; // 0.00001 SOL
      const priorityFeesLamports = 1_500_000n; // 0.0015 SOL priority fee
      const dexFeesLamports = (buyInputLamports * 30n) / 10000n; // ~0.3% DEX fee
      const totalExecutionCostsLamports = networkFeesLamports + priorityFeesLamports + dexFeesLamports;

      // 4. Executable Net SOL Profit
      const expectedNetProfitLamports = expectedExitLamports - buyInputLamports - totalExecutionCostsLamports;
      const expectedNetProfitPercent =
        buyInputLamports > 0n
          ? Number((expectedNetProfitLamports * 10000n) / buyInputLamports) / 100
          : 0;

      // 5. Hard Profitability Gate Check
      const minRequiredProfitLamports = defaultTradingConfig.minimumNetProfitLamports;
      const isProfitable = expectedNetProfitLamports >= minRequiredProfitLamports;

      const status = isProfitable ? 'AUTHORIZED' : 'UNPROFITABLE';
      const reason = isProfitable
        ? `PROFITABLE: Net executable PnL = +${expectedNetProfitLamports} lamports (${expectedNetProfitPercent.toFixed(2)}%)`
        : `UNPROFITABLE: Net executable PnL = ${expectedNetProfitLamports} lamports (${expectedNetProfitPercent.toFixed(2)}%) < required ${minRequiredProfitLamports} lamports`;

      return {
        mint,
        buyInputLamports,
        expectedTokensRaw,
        expectedExitLamports,
        networkFeesLamports,
        priorityFeesLamports,
        dexFeesLamports,
        totalExecutionCostsLamports,
        expectedNetProfitLamports,
        expectedNetProfitPercent,
        quoteFreshnessMs: quoteAgeMs,
        status,
        reason,
        buyQuote,
        sellQuote,
      };
    } catch (err: any) {
      return this.createBlockedMetrics(
        mint,
        buyInputLamports,
        `PROFITABILITY_EVALUATION_FAILED: ${err?.message || err}`,
        'DATA_UNAVAILABLE'
      );
    }
  }

  /**
   * Synchronous candidate profitability modeling fallback using candidate SOL price.
   */
  public calculateProfitability(
    candidate: EnrichedCandidate,
    buyAmountSol: number,
    targetProfitPct: number = 25
  ): ExecutableProfitabilityMetrics {
    const mint = candidate.mintAddress;
    const now = Date.now();
    const buyInputLamports = BigInt(Math.round(buyAmountSol * 1e9));

    const priceSol = candidate.priceSol?.value;
    if (!priceSol || priceSol <= 0) {
      return this.createBlockedMetrics(mint, buyInputLamports, 'Price data is missing or non-positive', 'DATA_UNAVAILABLE');
    }

    const priceAgeMs = candidate.priceSol?.timestamp ? now - candidate.priceSol.timestamp : 0;
    if (priceAgeMs > defaultTradingConfig.maxMarketDataAgeMs) {
      return this.createBlockedMetrics(mint, buyInputLamports, 'Price quote is stale', 'STALE');
    }

    // Direct SOL-denominated liquidity calculations using dynamic SOL/USD rate
    const solUsdRate = (candidate.priceUsd?.value && candidate.priceSol?.value && candidate.priceSol.value > 0)
      ? candidate.priceUsd.value / candidate.priceSol.value
      : (candidate.priceSol?.value ? 1 / candidate.priceSol.value : 180);
    const liquiditySol = candidate.liquidityUsd?.value ? candidate.liquidityUsd.value / solUsdRate : 10;
    const estimatedSlippagePct = Math.min(15, (buyAmountSol / Math.max(0.1, liquiditySol)) * 100 + 0.5);
    const estimatedSlippageLamports = BigInt(Math.round(buyInputLamports.toString() as any * (estimatedSlippagePct / 100)));

    const networkFeesLamports = 10_000n;
    const priorityFeesLamports = 1_500_000n;
    const dexFeesLamports = (buyInputLamports * 30n) / 10000n;
    const totalExecutionCostsLamports = networkFeesLamports + priorityFeesLamports + dexFeesLamports;

    const grossExitLamports = BigInt(Math.round(Number(buyInputLamports) * (1 + targetProfitPct / 100)));
    const expectedNetProfitLamports = grossExitLamports - buyInputLamports - estimatedSlippageLamports - totalExecutionCostsLamports;
    const expectedNetProfitPercent = buyInputLamports > 0n ? (Number(expectedNetProfitLamports) / Number(buyInputLamports)) * 100 : 0;

    const status = expectedNetProfitLamports > 0n ? 'AUTHORIZED' : 'UNPROFITABLE';

    return {
      mint,
      buyInputLamports,
      expectedTokensRaw: 0n,
      expectedExitLamports: grossExitLamports,
      networkFeesLamports,
      priorityFeesLamports,
      dexFeesLamports,
      totalExecutionCostsLamports,
      expectedNetProfitLamports,
      expectedNetProfitPercent,
      quoteFreshnessMs: priceAgeMs,
      status,
      reason: `Estimated SOL Profitability: ${status}`,
    };
  }

  private createBlockedMetrics(
    mint: string,
    buyInputLamports: bigint,
    reason: string,
    status: 'UNPROFITABLE' | 'STALE' | 'DATA_UNAVAILABLE' | 'BLOCKED'
  ): ExecutableProfitabilityMetrics {
    return {
      mint,
      buyInputLamports,
      expectedTokensRaw: 0n,
      expectedExitLamports: 0n,
      networkFeesLamports: 0n,
      priorityFeesLamports: 0n,
      dexFeesLamports: 0n,
      totalExecutionCostsLamports: 0n,
      expectedNetProfitLamports: 0n,
      expectedNetProfitPercent: 0,
      quoteFreshnessMs: 999999,
      status,
      reason,
    };
  }
}

export const profitabilityEngine = ProfitabilityEngine.getInstance();
