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
  executablePnlSol?: number;
  executablePnlPercent?: number;
  marketValueSol?: number;
  marketPnlSol?: number;
  marketPnlPercent?: number;
  pnlSol?: number;
  pnlPercent?: number;
  source: 'JUPITER' | 'LASERSTREAM' | 'WSS' | 'HELIUS_WSS' | 'UNAVAILABLE';
  lastMarketEventAt?: number;
  lastMarketPriceAt?: number;
  lastExecutableQuoteAt?: number;
  valuationUpdatedAt: number;
  status: 'LIVE' | 'STALE' | 'UNAVAILABLE';
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

  public getValuation(network: string, wallet: string, mint: string): PositionValuation | undefined {
    const val = this.valuations.get(this.getKey(network, wallet, mint));
    if (!val) return undefined;

    const now = Date.now();
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

    if (existing && existing.lastMarketEventAt && eventTimestamp < existing.lastMarketEventAt) {
      console.log(`[PNL VALUATION REJECTED] Out-of-order market event for ${position.mint}: ${eventTimestamp} < ${existing.lastMarketEventAt}`);
      return existing;
    }

    const now = Date.now();
    const decimals = position.decimals;
    const tokenQuantity = safeTokenQuantity(position.tokenAmount, decimals);
    const entryCostSol = position.totalSolSpent > 0 ? position.totalSolSpent : 0;
    const averageEntryPriceSol = tokenQuantity > 0 && entryCostSol > 0 ? entryCostSol / tokenQuantity : position.averageEntryPrice;

    const currentPriceSol = priceSol;
    const marketValueSol = tokenQuantity * currentPriceSol;
    const marketPnlSol = marketValueSol - entryCostSol;
    const marketPnlPercent = entryCostSol > 0 ? (marketPnlSol / entryCostSol) * 100 : 0;

    // FIX: Don't set executableValueSol = marketValueSol
    // executable values should only come from actual Jupiter quotes
    const executableValueSol = existing?.executableValueSol;
    const executablePnlSol = executableValueSol !== undefined ? executableValueSol - entryCostSol : undefined;
    const executablePnlPercent = executableValueSol !== undefined && entryCostSol > 0 ? (executablePnlSol! / entryCostSol) * 100 : undefined;

    const pnlSol = executablePnlSol !== undefined ? executablePnlSol : marketPnlSol;
    const pnlPercent = executablePnlPercent !== undefined ? executablePnlPercent : marketPnlPercent;

    const currentSeq = (this.sequences.get(key) || 0) + 1;
    this.sequences.set(key, currentSeq);

    const valuation: PositionValuation = {
      mint: position.mint,
      tokenAmountRaw: String(position.tokenAmount),
      tokenDecimals: decimals,
      entryCostSol,
      currentPriceSol,
      marketValueSol,
      marketPnlSol,
      marketPnlPercent,
      executableValueSol,
      executablePnlSol,
      executablePnlPercent,
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

  public async refreshExecutableQuote(position: Position): Promise<PositionValuation | null> {
    if (!position || position.tokenAmount <= 0) {
      return null;
    }

    const key = this.getKey(position.network, position.wallet, position.mint);
    const now = Date.now();
    const existing = this.valuations.get(key);

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

    if (existing && existing.lastExecutableQuoteAt && (now - existing.lastExecutableQuoteAt < this.config.quoteRefreshMs)) {
      return existing;
    }

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

          const executablePnlSol = executableValueSol - entryCostSol;
          const executablePnlPercent = entryCostSol > 0 ? (executablePnlSol / entryCostSol) * 100 : 0;

          const marketValueSol = existing?.marketValueSol ?? (tokenQuantity * (existing?.currentPriceSol || currentPriceSol));
          const marketPnlSol = existing?.marketPnlSol ?? (marketValueSol - entryCostSol);
          const marketPnlPercent = entryCostSol > 0 ? (marketPnlSol / entryCostSol) * 100 : 0;

          const valuation: PositionValuation = {
            mint: position.mint,
            tokenAmountRaw: String(position.tokenAmount),
            tokenDecimals: decimals,
            entryCostSol,
            currentPriceSol: existing?.currentPriceSol || currentPriceSol,
            marketValueSol,
            marketPnlSol,
            marketPnlPercent,
            executableValueSol,
            executablePnlSol,
            executablePnlPercent,
            pnlSol: executablePnlSol,
            pnlPercent: executablePnlPercent,
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

      if (existing) {
        const lastDataTime = Math.max(existing.lastExecutableQuoteAt || 0, existing.lastMarketPriceAt || 0);
        const age = Date.now() - lastDataTime;
        if (age > this.config.staleThresholdMs) {
          existing.status = 'STALE';
          this.logStalePrice(position.mint, age);
        }
        return existing;
      }

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
    const mSign = (val.marketPnlSol || 0) >= 0 ? '+' : '';
    const eSign = (val.executablePnlSol || 0) >= 0 ? '+' : '';
    console.log(
      `PNL VALUATION\n` +
      `Mint: ${val.mint}\n` +
      `Source: ${val.source}\n` +
      `Token Amount: ${val.tokenAmountRaw}\n` +
      `Market Price: ${val.currentPriceSol ? val.currentPriceSol.toFixed(8) + ' SOL' : 'N/A'}\n` +
      `Market PnL: ${val.marketPnlSol !== undefined ? mSign + val.marketPnlSol.toFixed(4) + ' SOL (' + mSign + (val.marketPnlPercent?.toFixed(2) || '0.00') + '%)' : 'N/A'}\n` +
      `Executable Proceeds: ${val.executableValueSol !== undefined ? val.executableValueSol.toFixed(4) + ' SOL' : 'UNAVAILABLE'}\n` +
      `Executable PnL: ${val.executablePnlSol !== undefined ? eSign + val.executablePnlSol.toFixed(4) + ' SOL (' + eSign + (val.executablePnlPercent?.toFixed(2) || '0.00') + '%)' : 'N/A'}\n` +
      `Entry Cost: ${val.entryCostSol.toFixed(4)} SOL\n` +
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
