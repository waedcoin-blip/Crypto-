// server/trading/PositionValuationEngine.ts
import { Position } from './PositionManager.js';
import { executionGateway } from '../execution/ExecutionGateway.js';
import { rawToUiNumber, lamportsToSolNumber } from '../utils/rawAmount.js';
import { logger } from '../utils/logger.js';

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

export function safeTokenQuantity(rawAmount: bigint | number | string, decimals: number): number {
  if (typeof decimals !== 'number' || isNaN(decimals) || decimals < 0) return 0;
  try {
    const rawBig = typeof rawAmount === 'bigint' ? rawAmount : BigInt(String(rawAmount));
    return rawToUiNumber(rawBig, decimals);
  } catch {
    return typeof rawAmount === 'number' ? rawAmount / (10 ** decimals) : 0;
  }
}

export class PositionValuationEngine {
  private static instance: PositionValuationEngine;
  private valuations: Map<string, PositionValuation> = new Map();
  private sequences: Map<string, number> = new Map();
  private pendingQuotes: Map<string, Promise<PositionValuation | null>> = new Map();

  // Quote freshness thresholds
  private readonly QUOTE_FRESHNESS_MS = 2500;
  private readonly STALE_THRESHOLD_MS = 10000;

  private constructor() {}

  public static getInstance(): PositionValuationEngine {
    if (!PositionValuationEngine.instance) {
      PositionValuationEngine.instance = new PositionValuationEngine();
    }
    return PositionValuationEngine.instance;
  }

  private getKey(network: string, wallet: string, mint: string): string {
    return `${network}:${wallet}:${mint.trim().toLowerCase()}`;
  }

  // ==========================================
  // VALUATION RETRIEVAL (Synchronous read)
  // ==========================================

  public getValuation(network: string, wallet: string, mint: string): PositionValuation | null {
    const key = this.getKey(network, wallet, mint);
    const val = this.valuations.get(key);
    if (!val) return null;

    const now = Date.now();
    const age = now - val.valuationUpdatedAt;
    if (age > this.STALE_THRESHOLD_MS) {
      val.status = 'STALE';
    }
    val.quoteAgeMs = val.lastExecutableQuoteAt ? now - val.lastExecutableQuoteAt : undefined;
    val.marketDataAgeMs = val.lastMarketPriceAt ? now - val.lastMarketPriceAt : undefined;
    return val;
  }

  public getLatestValuation(network: string, wallet: string, mint: string): PositionValuation | null {
    return this.getValuation(network, wallet, mint);
  }

  // ==========================================
  // MARKET PRICE RECORDING (From WSS / LaserStream)
  // ==========================================

  public recordMarketPrice(
    network: string,
    wallet: string,
    mint: string,
    priceSol: number,
    source: 'LASERSTREAM' | 'WSS' | 'HELIUS_WSS' = 'WSS'
  ): void {
    const key = this.getKey(network, wallet, mint);
    const existing = this.valuations.get(key);
    const now = Date.now();
    const seq = (this.sequences.get(key) || 0) + 1;
    this.sequences.set(key, seq);

    if (existing) {
      existing.currentPriceSol = priceSol;
      existing.lastMarketPriceAt = now;
      existing.lastMarketEventAt = now;
      existing.valuationUpdatedAt = now;
      existing.source = source;
      existing.sequenceNumber = seq;

      if (existing.tokenQuantity && existing.tokenQuantity > 0) {
        existing.marketValueSol = existing.tokenQuantity * priceSol;
        existing.marketPnlSol = existing.marketValueSol - existing.entryCostSol;
        existing.marketPnlPercent = existing.entryCostSol > 0
          ? (existing.marketPnlSol / existing.entryCostSol) * 100
          : 0;
      }
    }
  }

  // ==========================================
  // EXECUTABLE QUOTE VALUATION (Async fetch)
  // ==========================================

  public async fetchExecutableQuoteValuation(position: Position): Promise<PositionValuation | null> {
    const key = this.getKey(position.network, position.wallet, position.mint);

    // Dedup in-flight quote requests for the same position
    const inflight = this.pendingQuotes.get(key);
    if (inflight) return inflight;

    const quotePromise = this.doFetchQuote(position, key);
    this.pendingQuotes.set(key, quotePromise);

    try {
      return await quotePromise;
    } finally {
      this.pendingQuotes.delete(key);
    }
  }

  private async doFetchQuote(position: Position, key: string): Promise<PositionValuation | null> {
    const now = Date.now();
    const rawAmount = position.tokenAmountRaw
      ? BigInt(position.tokenAmountRaw)
      : BigInt(Math.floor(position.tokenAmount * (10 ** position.decimals)));

    if (rawAmount <= 0n) return null;

    try {
      const executor = executionGateway.getExecutor(position.network) as any;
      const quote = await executor.getExecutableSellQuote(position.mint, rawAmount, 250);

      const seq = (this.sequences.get(key) || 0) + 1;
      this.sequences.set(key, seq);

      const tokenQty = safeTokenQuantity(rawAmount, position.decimals);
      const executableValueSol = lamportsToSolNumber(quote.expectedOutLamports);
      const executablePnlSol = executableValueSol - position.totalSolSpent;
      const executablePnlPercent = position.totalSolSpent > 0
        ? (executablePnlSol / position.totalSolSpent) * 100
        : 0;

      const valuation: PositionValuation = {
        mint: position.mint,
        tokenAmountRaw: rawAmount,
        tokenDecimals: position.decimals,
        entryCostSol: position.totalSolSpent,
        currentPriceSol: position.currentPriceSol,
        executableValueSol,
        executablePnlSol,
        executablePnlPercent,
        marketValueSol: tokenQty * position.currentPriceSol,
        marketPnlSol: (tokenQty * position.currentPriceSol) - position.totalSolSpent,
        marketPnlPercent: position.totalSolSpent > 0
          ? (((tokenQty * position.currentPriceSol) - position.totalSolSpent) / position.totalSolSpent) * 100
          : 0,
        pnlSol: executablePnlSol,
        pnlPercent: executablePnlPercent,
        source: 'JUPITER',
        lastExecutableQuoteAt: now,
        lastMarketPriceAt: position.lastMarketPriceAt || now,
        valuationUpdatedAt: now,
        status: 'LIVE',
        positionId: position.id,
        network: position.network,
        wallet: position.wallet,
        tokenQuantity: tokenQty,
        averageEntryPriceSol: position.averageEntryPrice,
        quoteAgeMs: 0,
        sequenceNumber: seq,
      };

      this.valuations.set(key, valuation);
      return valuation;
    } catch (err) {
      logger.warn({ mint: position.mint, error: String(err) }, '[PositionValuationEngine] Failed to fetch quote');
      return null;
    }
  }

  // ==========================================
  // GET OR FETCH (Cached or Fresh)
  // ==========================================

  public async getOrFetchValuation(position: Position): Promise<PositionValuation | null> {
    const cached = this.getValuation(position.network, position.wallet, position.mint);
    if (cached && cached.status === 'LIVE' && cached.lastExecutableQuoteAt) {
      const age = Date.now() - cached.lastExecutableQuoteAt;
      if (age < this.QUOTE_FRESHNESS_MS) return cached;
    }

    return this.fetchExecutableQuoteValuation(position);
  }

  public async forceRefreshAllQuotes(positions: Position[]): Promise<void> {
    await Promise.allSettled(positions.map(p => this.fetchExecutableQuoteValuation(p)));
  }

  public removeValuation(network: string, wallet: string, mint: string): void {
    const key = this.getKey(network, wallet, mint);
    this.valuations.delete(key);
    this.sequences.delete(key);
  }

  public clear(): void {
    this.valuations.clear();
    this.sequences.clear();
    this.pendingQuotes.clear();
  }
}

export const positionValuationEngine = PositionValuationEngine.getInstance();
