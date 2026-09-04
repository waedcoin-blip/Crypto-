// server/trading/PositionValuationEngine.ts
import { Position, positionManager } from './PositionManager.js';
import { executionGateway } from '../execution/ExecutionGateway.js';

export interface PositionValuation {
  positionId: string;
  network: string;
  wallet: string;
  mint: string;
  tokenAmount: number; // Raw integer token balance
  decimals: number;
  tokenQuantity: number;
  entryCostSol: number; // Actual SOL spent from executed BUY transaction
  averageEntryPriceSol: number;
  currentPriceSol?: number;
  executableValueSol?: number;
  pnlSol?: number;
  pnlPercent?: number;
  lastMarketEventAt?: number;
  lastMarketPriceAt?: number;
  lastExecutableQuoteAt?: number;
  valuationUpdatedAt: number;
  source: 'JUPITER' | 'LASERSTREAM' | 'WSS' | 'HELIUS_WSS' | 'OTHER' | 'UNAVAILABLE';
  status: 'LIVE' | 'STALE' | 'UNAVAILABLE';
  quoteAgeMs?: number;
  marketDataAgeMs?: number;
  sequenceNumber: number;
}

export interface ValuationConfig {
  quoteRefreshMs: number;
  staleThresholdMs: number;
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

  /**
   * Generates key for valuation cache: network:wallet:mint
   */
  private getKey(network: string, wallet: string, mint: string): string {
    return `${network}:${wallet}:${mint}`;
  }

  /**
   * Returns authoritative valuation for a position.
   */
  public getValuation(network: string, wallet: string, mint: string): PositionValuation | undefined {
    return this.valuations.get(this.getKey(network, wallet, mint));
  }

  /**
   * Returns all active valuations.
   */
  public getAllValuations(): PositionValuation[] {
    return Array.from(this.valuations.values());
  }

  /**
   * Evaluates position valuation using real market event (WSS/LaserStream).
   * Enforces event ordering (rejects older events).
   */
  public updateFromMarketEvent(
    position: Position,
    priceSol: number,
    eventTimestamp: number,
    source: 'LASERSTREAM' | 'WSS' | 'HELIUS_WSS' | 'OTHER' = 'WSS'
  ): PositionValuation | null {
    if (!position || priceSol <= 0 || !Number.isFinite(priceSol)) {
      return this.getValuation(position.network, position.wallet, position.mint) || null;
    }

    const key = this.getKey(position.network, position.wallet, position.mint);
    const existing = this.valuations.get(key);

    // Event ordering: Reject older events
    if (existing && existing.lastMarketEventAt && eventTimestamp < existing.lastMarketEventAt) {
      console.log(`[PNL VALUATION REJECTED] Out-of-order market event for ${position.mint}: ${eventTimestamp} < ${existing.lastMarketEventAt}`);
      return existing;
    }

    const now = Date.now();
    const decimals = position.decimals ?? 6;
    const tokenQuantity = position.tokenAmount / (10 ** decimals);
    const entryCostSol = position.totalSolSpent > 0 ? position.totalSolSpent : 0;
    const averageEntryPriceSol = tokenQuantity > 0 && entryCostSol > 0 ? entryCostSol / tokenQuantity : position.averageEntryPrice;

    const currentPriceSol = priceSol;
    const executableValueSol = tokenQuantity * currentPriceSol;
    const pnlSol = executableValueSol - entryCostSol;
    const pnlPercent = entryCostSol > 0 ? (pnlSol / entryCostSol) * 100 : 0;

    const currentSeq = (this.sequences.get(key) || 0) + 1;
    this.sequences.set(key, currentSeq);

    const valuation: PositionValuation = {
      positionId: position.id,
      network: position.network,
      wallet: position.wallet,
      mint: position.mint,
      tokenAmount: position.tokenAmount,
      decimals,
      tokenQuantity,
      entryCostSol,
      averageEntryPriceSol,
      currentPriceSol,
      executableValueSol,
      pnlSol,
      pnlPercent,
      lastMarketEventAt: eventTimestamp,
      lastMarketPriceAt: now,
      lastExecutableQuoteAt: existing?.lastExecutableQuoteAt,
      valuationUpdatedAt: now,
      source,
      status: 'LIVE',
      marketDataAgeMs: 0,
      quoteAgeMs: existing?.lastExecutableQuoteAt ? now - existing.lastExecutableQuoteAt : undefined,
      sequenceNumber: currentSeq,
    };

    this.valuations.set(key, valuation);
    this.logValuation(valuation);
    return valuation;
  }

  /**
   * Fetches fresh executable Jupiter quote for full position size with deduplication & race condition protection.
   */
  public async refreshExecutableQuote(position: Position): Promise<PositionValuation | null> {
    if (!position || position.tokenAmount <= 0) {
      return null;
    }

    const key = this.getKey(position.network, position.wallet, position.mint);
    const now = Date.now();
    const existing = this.valuations.get(key);

    // Rate limit / quote refresh throttle (e.g. 1000ms)
    if (existing && existing.lastExecutableQuoteAt && (now - existing.lastExecutableQuoteAt < this.config.quoteRefreshMs)) {
      return existing;
    }

    // Request deduplication: reuse in-flight request promise
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

        // Async race condition check: Ensure no newer sequence was initiated while waiting
        if (this.sequences.get(key) !== nextSeq) {
          console.warn(`[PNL VALUATION RACE DISCARDED] Sequence mismatch for ${position.mint}: ${nextSeq} vs current ${this.sequences.get(key)}`);
          return this.valuations.get(key) || null;
        }

        if (quote && quote.outAmount) {
          const outLamports = BigInt(quote.outAmount);
          const executableValueSol = Number(outLamports) / 1e9;
          const decimals = position.decimals ?? 6;
          const tokenQuantity = position.tokenAmount / (10 ** decimals);
          const currentPriceSol = tokenQuantity > 0 ? executableValueSol / tokenQuantity : 0;
          const entryCostSol = position.totalSolSpent > 0 ? position.totalSolSpent : 0;
          const averageEntryPriceSol = tokenQuantity > 0 && entryCostSol > 0 ? entryCostSol / tokenQuantity : position.averageEntryPrice;

          const pnlSol = executableValueSol - entryCostSol;
          const pnlPercent = entryCostSol > 0 ? (pnlSol / entryCostSol) * 100 : 0;

          const valuation: PositionValuation = {
            positionId: position.id,
            network: position.network,
            wallet: position.wallet,
            mint: position.mint,
            tokenAmount: position.tokenAmount,
            decimals,
            tokenQuantity,
            entryCostSol,
            averageEntryPriceSol,
            currentPriceSol,
            executableValueSol,
            pnlSol,
            pnlPercent,
            lastMarketEventAt: existing?.lastMarketEventAt,
            lastMarketPriceAt: existing?.lastMarketPriceAt,
            lastExecutableQuoteAt: reqFinishedAt,
            valuationUpdatedAt: reqFinishedAt,
            source: 'JUPITER',
            status: 'LIVE',
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

      // Fallback: Check if existing valuation is stale
      if (existing) {
        const lastDataTime = Math.max(existing.lastExecutableQuoteAt || 0, existing.lastMarketPriceAt || 0);
        const age = Date.now() - lastDataTime;
        if (age > this.config.staleThresholdMs) {
          existing.status = 'STALE';
          this.logStalePrice(position.mint, age);
        }
        return existing;
      }

      // No price available at all: return UNAVAILABLE (never fabricate price)
      const unavailableValuation: PositionValuation = {
        positionId: position.id,
        network: position.network,
        wallet: position.wallet,
        mint: position.mint,
        tokenAmount: position.tokenAmount,
        decimals: position.decimals ?? 6,
        tokenQuantity: position.tokenAmount / (10 ** (position.decimals ?? 6)),
        entryCostSol: position.totalSolSpent,
        averageEntryPriceSol: position.averageEntryPrice,
        valuationUpdatedAt: Date.now(),
        source: 'UNAVAILABLE',
        status: 'UNAVAILABLE',
        sequenceNumber: nextSeq,
      };
      this.valuations.set(key, unavailableValuation);
      return unavailableValuation;
    })();

    this.pendingQuotePromises.set(key, fetchPromise);
    return fetchPromise;
  }

  /**
   * Cleans up valuation state when position is closed.
   */
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
      `Token Amount: ${val.tokenAmount}\n` +
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
