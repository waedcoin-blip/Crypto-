// server/trading/PositionValuationEngine.ts
import { Position } from './PositionManager.js';
import { executionGateway } from '../execution/ExecutionGateway.js';

export interface PositionValuation {
  mint: string;

  tokenAmountRaw: bigint | string;
  tokenDecimals: number;

  entryCostSol: number;

  currentPriceSol?: number;

  executableValueSol?: number;

  pnlSol?: number;
  pnlPercent?: number;

  source:
    | 'JUPITER'
    | 'LASERSTREAM'
    | 'WSS'
    | 'HELIUS_WSS'
    | 'UNAVAILABLE';

  lastMarketEventAt?: number;
  lastMarketPriceAt?: number;
  lastExecutableQuoteAt?: number;

  valuationUpdatedAt: number;

  status:
    | 'LIVE'
    | 'STALE'
    | 'UNAVAILABLE';

  // Observability & context fields
  positionId?: string;
  network?: string;
  wallet?: string;
  tokenQuantity?: number;
  averageEntryPriceSol?: number;
  quoteAgeMs?: number;
  marketDataAgeMs?: number;
  sequenceNumber?: number;
}

export interface ValuationConfig {
  quoteRefreshMs: number;
  staleThresholdMs: number;
}

/**
 * Safe conversion of raw token balance to UI quantity without floating truncation.
 */
export function safeTokenQuantity(rawAmount: bigint | number | string, decimals: number): number {
  if (typeof decimals !== 'number' || isNaN(decimals) || decimals < 0) {
    return 0;
  }
  try {
    const rawBig = typeof rawAmount === 'bigint' ? rawAmount : BigInt(String(rawAmount));
    const divisor = BigInt(10 ** decimals);
    const whole = rawBig / divisor;
    const fraction = rawBig % divisor;
    return Number(whole) + Number(fraction) / (10 ** decimals);
  } catch {
    return typeof rawAmount === 'number' ? rawAmount / (10 ** decimals) : 0;
  }
}

export class PositionValuationEngine {
  private static instance: PositionValuationEngine;
  private valuations: Map<string, PositionValuation> = new Map();
  private sequences: Map<string, number> = new Map();
  private pendingQuotePromises: Map<string, Promise<PositionValuation | null>> = new Map();

  private config: ValuationConfig = {
    quoteRefreshMs: 1000,
    staleThresholdMs: 5000,
  };

  private constructor() {}

  public static getInstance(): PositionValuationEngine {
    if (!PositionValuationEngine.instance) {
      PositionValuationEngine.instance = new PositionValuationEngine();
    }
    return PositionValuationEngine.instance;
  }

  private getKey(network: string, wallet: string, mint: string): string {
    return `${network}:${wallet}:${mint}`;
  }

  /**
   * Returns authoritative valuation for a position, evaluating freshness.
   */
  public getValuation(network: string, wallet: string, mint: string): PositionValuation | undefined {
    const val = this.valuations.get(this.getKey(network, wallet, mint));
    if (!val) return undefined;

    const now = Date.now();
    // Stale check if quote or price is older than threshold
    if (val.status === 'LIVE') {
      const lastTime = Math.max(val.lastExecutableQuoteAt || 0, val.lastMarketPriceAt || 0);
      if (lastTime > 0 && (now - lastTime > this.config.staleThresholdMs)) {
        val.status = 'STALE';
      }
    }

    if (val.lastExecutableQuoteAt) {
      val.quoteAgeMs = now - val.lastExecutableQuoteAt;
    }
    if (val.lastMarketPriceAt) {
      val.marketDataAgeMs = now - val.lastMarketPriceAt;
    }

    return val;
  }

  public getAllValuations(): PositionValuation[] {
    const now = Date.now();
    return Array.from(this.valuations.values()).map(val => {
      if (val.status === 'LIVE') {
        const lastTime = Math.max(val.lastExecutableQuoteAt || 0, val.lastMarketPriceAt || 0);
        if (lastTime > 0 && (now - lastTime > this.config.staleThresholdMs)) {
          val.status = 'STALE';
        }
      }
      if (val.lastExecutableQuoteAt) {
        val.quoteAgeMs = now - val.lastExecutableQuoteAt;
      }
      if (val.lastMarketPriceAt) {
        val.marketDataAgeMs = now - val.lastMarketPriceAt;
      }
      return val;
    });
  }

  /**
   * Evaluates position valuation using real market event (WSS/LaserStream).
   * Enforces:
   * - Fail-closed on unresolved decimals
   * - Event ordering (rejects older timestamps)
   * - Pure SOL accounting: pnlSol = executableValueSol - entryCostSol
   */
  public updateFromMarketEvent(
    position: Position,
    priceSol: number,
    eventTimestamp: number,
    source: 'LASERSTREAM' | 'WSS' | 'HELIUS_WSS' = 'WSS'
  ): PositionValuation | null {
    if (!position || priceSol <= 0 || !Number.isFinite(priceSol)) {
      return this.getValuation(position.network, position.wallet, position.mint) || null;
    }

    const key = this.getKey(position.network, position.wallet, position.mint);
    const existing = this.valuations.get(key);

    // Decimal verification — FAIL CLOSED (Do NOT invent 6)
    if (typeof position.decimals !== 'number' || isNaN(position.decimals) || position.decimals < 0) {
      this.logValuationFailure(position.mint, 'DECIMALS_UNRESOLVED_FAIL_CLOSED');
      const unavail: PositionValuation = {
        mint: position.mint,
        tokenAmountRaw: String(position.tokenAmount),
        tokenDecimals: -1,
        entryCostSol: position.totalSolSpent || 0,
        valuationUpdatedAt: Date.now(),
        source: 'UNAVAILABLE',
        status: 'UNAVAILABLE',
        positionId: position.id,
        network: position.network,
        wallet: position.wallet,
      };
      this.valuations.set(key, unavail);
      return unavail;
    }

    // Event ordering: Reject older events
    if (existing && existing.lastMarketEventAt && eventTimestamp < existing.lastMarketEventAt) {
      console.log(`[PNL VALUATION REJECTED] Out-of-order market event for ${position.mint}: ${eventTimestamp} < ${existing.lastMarketEventAt}`);
      return existing;
    }

    const now = Date.now();
    const decimals = position.decimals;
    const tokenQuantity = safeTokenQuantity(position.tokenAmount, decimals);
    const entryCostSol = position.totalSolSpent > 0 ? position.totalSolSpent : 0;
    const averageEntryPriceSol = tokenQuantity > 0 && entryCostSol > 0 ? entryCostSol / tokenQuantity : position.averageEntryPrice;

    // When no fresh Jupiter quote is active, compute executable market value from verified token balance
    const currentPriceSol = priceSol;
    const executableValueSol = tokenQuantity * currentPriceSol;
    const pnlSol = executableValueSol - entryCostSol;
    const pnlPercent = entryCostSol > 0 ? (pnlSol / entryCostSol) * 100 : 0;

    const currentSeq = (this.sequences.get(key) || 0) + 1;
    this.sequences.set(key, currentSeq);

    const valuation: PositionValuation = {
      mint: position.mint,
      tokenAmountRaw: String(position.tokenAmount),
      tokenDecimals: decimals,
      entryCostSol,
      currentPriceSol,
      executableValueSol,
      pnlSol,
      pnlPercent,
      source,
      lastMarketEventAt: eventTimestamp,
      lastMarketPriceAt: now,
      lastExecutableQuoteAt: existing?.lastExecutableQuoteAt,
      valuationUpdatedAt: now,
      status: 'LIVE',
      positionId: position.id,
      network: position.network,
      wallet: position.wallet,
      tokenQuantity,
      averageEntryPriceSol,
      marketDataAgeMs: 0,
      quoteAgeMs: existing?.lastExecutableQuoteAt ? now - existing.lastExecutableQuoteAt : undefined,
      sequenceNumber: currentSeq,
    };

    this.valuations.set(key, valuation);
    this.logValuation(valuation);
    return valuation;
  }

  /**
   * Fetches fresh executable Jupiter quote for the ACTUAL current position balance.
   * Enforces:
   * - Actual token quantity quoted for SELL
   * - Fail-closed on missing decimals
   * - Request deduplication
   * - Async race condition protection
   */
  public async refreshExecutableQuote(position: Position): Promise<PositionValuation | null> {
    if (!position || position.tokenAmount <= 0) {
      return null;
    }

    const key = this.getKey(position.network, position.wallet, position.mint);
    const now = Date.now();
    const existing = this.valuations.get(key);

    // Decimal verification — FAIL CLOSED
    if (typeof position.decimals !== 'number' || isNaN(position.decimals) || position.decimals < 0) {
      this.logValuationFailure(position.mint, 'DECIMALS_UNRESOLVED_FAIL_CLOSED');
      const unavail: PositionValuation = {
        mint: position.mint,
        tokenAmountRaw: String(position.tokenAmount),
        tokenDecimals: -1,
        entryCostSol: position.totalSolSpent || 0,
        valuationUpdatedAt: now,
        source: 'UNAVAILABLE',
        status: 'UNAVAILABLE',
        positionId: position.id,
        network: position.network,
        wallet: position.wallet,
      };
      this.valuations.set(key, unavail);
      return unavail;
    }

    // Rate limit quote refresh throttle (e.g. 1000ms)
    if (existing && existing.lastExecutableQuoteAt && (now - existing.lastExecutableQuoteAt < this.config.quoteRefreshMs)) {
      return existing;
    }

    // Request deduplication: return in-flight promise
    if (this.pendingQuotePromises.has(key)) {
      return this.pendingQuotePromises.get(key)!;
    }

    const nextSeq = (this.sequences.get(key) || 0) + 1;
    this.sequences.set(key, nextSeq);

    const fetchPromise = (async (): Promise<PositionValuation | null> => {
      try {
        const WSOL = 'So11111111111111111111111111111111111111112';
        const quote = await executionGateway.quoteSell({
          inputMint: position.mint,
          outputMint: WSOL,
          amount: position.tokenAmount,
          slippageBps: position.slippageBpsSl || 1000,
          network: position.network,
        });

        const reqFinishedAt = Date.now();

        // Async race protection: discard if newer sequence was dispatched
        if (this.sequences.get(key) !== nextSeq) {
          console.warn(`[PNL VALUATION RACE DISCARDED] Sequence mismatch for ${position.mint}: ${nextSeq} vs current ${this.sequences.get(key)}`);
          return this.valuations.get(key) || null;
        }

        if (quote && quote.outAmount) {
          const outLamports = BigInt(quote.outAmount);
          const executableValueSol = Number(outLamports) / 1e9;
          const decimals = position.decimals;
          const tokenQuantity = safeTokenQuantity(position.tokenAmount, decimals);
          const currentPriceSol = tokenQuantity > 0 ? executableValueSol / tokenQuantity : 0;
          const entryCostSol = position.totalSolSpent > 0 ? position.totalSolSpent : 0;
          const averageEntryPriceSol = tokenQuantity > 0 && entryCostSol > 0 ? entryCostSol / tokenQuantity : position.averageEntryPrice;

          const pnlSol = executableValueSol - entryCostSol;
          const pnlPercent = entryCostSol > 0 ? (pnlSol / entryCostSol) * 100 : 0;

          const valuation: PositionValuation = {
            mint: position.mint,
            tokenAmountRaw: String(position.tokenAmount),
            tokenDecimals: decimals,
            entryCostSol,
            currentPriceSol,
            executableValueSol,
            pnlSol,
            pnlPercent,
            source: 'JUPITER',
            lastMarketEventAt: existing?.lastMarketEventAt,
            lastMarketPriceAt: existing?.lastMarketPriceAt,
            lastExecutableQuoteAt: reqFinishedAt,
            valuationUpdatedAt: reqFinishedAt,
            status: 'LIVE',
            positionId: position.id,
            network: position.network,
            wallet: position.wallet,
            tokenQuantity,
            averageEntryPriceSol,
            quoteAgeMs: 0,
            marketDataAgeMs: existing?.lastMarketPriceAt ? reqFinishedAt - existing.lastMarketPriceAt : undefined,
            sequenceNumber: nextSeq,
          };

          this.valuations.set(key, valuation);
          this.logValuation(valuation);
          return valuation;
        } else {
          this.logValuationFailure(position.mint, 'JUPITER_QUOTE_EMPTY');
        }
      } catch (err: any) {
        this.logValuationFailure(position.mint, `JUPITER_QUOTE_UNAVAILABLE: ${err?.message || err}`);
      } finally {
        this.pendingQuotePromises.delete(key);
      }

      // Fallback on previous valuation with stale checking
      if (existing) {
        const lastDataTime = Math.max(existing.lastExecutableQuoteAt || 0, existing.lastMarketPriceAt || 0);
        const age = Date.now() - lastDataTime;
        if (age > this.config.staleThresholdMs) {
          existing.status = 'STALE';
          this.logStalePrice(position.mint, age);
        }
        return existing;
      }

      // No price available: return UNAVAILABLE (never fabricate price)
      const unavailableValuation: PositionValuation = {
        mint: position.mint,
        tokenAmountRaw: String(position.tokenAmount),
        tokenDecimals: position.decimals,
        entryCostSol: position.totalSolSpent || 0,
        averageEntryPriceSol: position.averageEntryPrice,
        valuationUpdatedAt: Date.now(),
        source: 'UNAVAILABLE',
        status: 'UNAVAILABLE',
        positionId: position.id,
        network: position.network,
        wallet: position.wallet,
        sequenceNumber: nextSeq,
      };
      this.valuations.set(key, unavailableValuation);
      return unavailableValuation;
    })();

    this.pendingQuotePromises.set(key, fetchPromise);
    return fetchPromise;
  }

  public removeValuation(network: string, wallet: string, mint: string): void {
    const key = this.getKey(network, wallet, mint);
    this.valuations.delete(key);
    this.sequences.delete(key);
    this.pendingQuotePromises.delete(key);
    console.log(`[PNL VALUATION CLEANUP] Closed position valuation removed for ${mint}`);
  }

  private logValuation(val: PositionValuation): void {
    const sign = (val.pnlSol || 0) >= 0 ? '+' : '';
    console.log(
      `PNL VALUATION\n` +
      `Mint: ${val.mint}\n` +
      `Source: ${val.source}\n` +
      `Token Amount: ${val.tokenAmountRaw}\n` +
      `Executable SOL Value: ${val.executableValueSol !== undefined ? val.executableValueSol.toFixed(4) + ' SOL' : 'UNAVAILABLE'}\n` +
      `Entry Cost: ${val.entryCostSol.toFixed(4)} SOL\n` +
      `PnL: ${val.pnlSol !== undefined ? sign + val.pnlSol.toFixed(4) + ' SOL' : 'N/A'}\n` +
      `PnL %: ${val.pnlPercent !== undefined ? sign + val.pnlPercent.toFixed(2) + '%' : 'N/A'}\n` +
      `Quote Age: ${val.quoteAgeMs !== undefined ? val.quoteAgeMs + ' ms' : 'N/A'}\n` +
      `Status: ${val.status}`
    );
  }

  private logValuationFailure(mint: string, reason: string): void {
    console.warn(`PNL VALUATION FAILED\nMint: ${mint}\nReason: ${reason}`);
  }

  private logStalePrice(mint: string, ageMs: number): void {
    console.warn(`PNL PRICE STALE\nMint: ${mint}\nLast Market Price: ${(ageMs / 1000).toFixed(1)} seconds ago`);
  }
}

export const positionValuationEngine = PositionValuationEngine.getInstance();

