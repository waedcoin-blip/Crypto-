// server/trading/PositionValuationEngine.ts
import { Position, positionManager } from './PositionManager.js';
import { executionGateway } from '../execution/ExecutionGateway.js';
import { rawToUiNumber, lamportsToSolNumber } from '../utils/rawAmount.js';
import { logger } from '../utils/logger.js';

const WSOL_MINT = 'So11111111111111111111111111111111111111112';

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
  source: 'JUPITER' | 'LASERSTREAM' | 'WSS' | 'HELIUS_WSS' | 'DEXSCREENER' | 'UNAVAILABLE';
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
  private readonly QUOTE_FRESHNESS_MS = 5000;
  private readonly STALE_THRESHOLD_MS = 25000;

  private constructor() {}

  public static getInstance(): PositionValuationEngine {
    if (!PositionValuationEngine.instance) {
      PositionValuationEngine.instance = new PositionValuationEngine();
    }
    return PositionValuationEngine.instance;
  }

  private getKey(network: string, wallet: string, mint: string): string {
    return `${network}:${wallet}:${mint.trim()}`;
  }

  // ==========================================
  // VALUATION RETRIEVAL (Synchronous read)
  // ==========================================

  public getValuation(network: string, wallet: string, mint: string): PositionValuation | null {
    const key = this.getKey(network, wallet, mint);
    let val = this.valuations.get(key);

    // If not found in cache, attempt to build an initial valuation from open position
    if (!val) {
      const pos = positionManager.getPosition(network, wallet, mint) ||
                  positionManager.getOpenPositions().find((p: any) => p.mint === mint);

      if (pos && pos.status !== 'CLOSED') {
        const rawAmount = pos.tokenAmountRaw
          ? BigInt(pos.tokenAmountRaw)
          : BigInt(Math.floor(pos.tokenAmount * (10 ** (pos.decimals || 6))));
        const tokenQuantity = safeTokenQuantity(rawAmount, pos.decimals || 6);
        const priceSol = pos.currentPriceSol && pos.currentPriceSol > 0 ? pos.currentPriceSol : pos.averageEntryPrice;
        const entryCostSol = pos.totalSolSpent || 0;
        const marketValueSol = tokenQuantity * priceSol;
        const pnlSol = marketValueSol - entryCostSol;
        const pnlPercent = entryCostSol > 0 ? (pnlSol / entryCostSol) * 100 : 0;
        const now = Date.now();

        val = {
          mint,
          tokenAmountRaw: rawAmount,
          tokenDecimals: pos.decimals || 6,
          entryCostSol,
          currentPriceSol: priceSol,
          executableValueSol: marketValueSol,
          executablePnlSol: pnlSol,
          executablePnlPercent: pnlPercent,
          marketValueSol,
          marketPnlSol: pnlSol,
          marketPnlPercent: pnlPercent,
          pnlSol,
          pnlPercent,
          source: 'WSS',
          lastMarketEventAt: pos.lastMarketPriceAt || now,
          lastMarketPriceAt: pos.lastMarketPriceAt || now,
          valuationUpdatedAt: now,
          status: 'LIVE',
          positionId: pos.id,
          network: pos.network || network,
          wallet: pos.wallet || wallet,
          tokenQuantity,
          averageEntryPriceSol: pos.averageEntryPrice,
        };
        this.valuations.set(key, val);
      }
    }

    if (!val) return null;

    const now = Date.now();
    const marketAge = val.lastMarketPriceAt ? now - val.lastMarketPriceAt : Infinity;
    if (marketAge <= 15000) {
      val.status = 'LIVE';
    } else if (marketAge <= 45000) {
      val.status = 'STALE';
    } else {
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
  // MARKET PRICE RECORDING (From WSS / LaserStream / Market Data)
  // ==========================================

  public recordMarketPrice(
    network: string,
    wallet: string,
    mint: string,
    priceSol: number,
    source: 'JUPITER' | 'LASERSTREAM' | 'WSS' | 'HELIUS_WSS' | 'DEXSCREENER' = 'WSS'
  ): void {
    if (typeof priceSol !== 'number' || isNaN(priceSol) || priceSol <= 0 || !Number.isFinite(priceSol)) {
      return;
    }

    const key = this.getKey(network, wallet, mint);
    let existing = this.valuations.get(key);
    const now = Date.now();
    const seq = (this.sequences.get(key) || 0) + 1;
    this.sequences.set(key, seq);

    if (!existing) {
      // Lazy-instantiate valuation record from positionManager if position exists
      const pos = positionManager.getPosition(network, wallet, mint) || 
                  positionManager.getOpenPositions().find((p: any) => p.mint === mint);

      if (pos) {
        const rawAmount = pos.tokenAmountRaw
          ? BigInt(pos.tokenAmountRaw)
          : BigInt(Math.floor(pos.tokenAmount * (10 ** pos.decimals)));
        const tokenQuantity = safeTokenQuantity(rawAmount, pos.decimals);
        const entryCostSol = pos.totalSolSpent || 0;
        const marketValueSol = tokenQuantity * priceSol;
        const marketPnlSol = marketValueSol - entryCostSol;
        const marketPnlPercent = entryCostSol > 0 ? (marketPnlSol / entryCostSol) * 100 : 0;

        existing = {
          mint,
          tokenAmountRaw: rawAmount,
          tokenDecimals: pos.decimals,
          entryCostSol,
          currentPriceSol: priceSol,
          executableValueSol: marketValueSol,
          executablePnlSol: marketPnlSol,
          executablePnlPercent: marketPnlPercent,
          marketValueSol,
          marketPnlSol,
          marketPnlPercent,
          pnlSol: marketPnlSol,
          pnlPercent: marketPnlPercent,
          source,
          lastMarketEventAt: now,
          lastMarketPriceAt: now,
          valuationUpdatedAt: now,
          status: 'LIVE',
          positionId: pos.id,
          network: pos.network || network,
          wallet: pos.wallet || wallet,
          tokenQuantity,
          averageEntryPriceSol: pos.averageEntryPrice || (pos as any).buyPrice || 0,
          sequenceNumber: seq,
        };
        const posKey = this.getKey(pos.network || network, pos.wallet || wallet, pos.mint);
        this.valuations.set(posKey, existing);
        if (posKey !== key) {
          this.valuations.set(key, existing);
        }
        return;
      }
    } else {
      existing.currentPriceSol = priceSol;
      existing.lastMarketPriceAt = now;
      existing.lastMarketEventAt = now;
      existing.valuationUpdatedAt = now;
      existing.source = source;
      existing.status = 'LIVE';
      existing.sequenceNumber = seq;

      if (existing.tokenQuantity && existing.tokenQuantity > 0) {
        existing.marketValueSol = existing.tokenQuantity * priceSol;
        existing.marketPnlSol = existing.marketValueSol - existing.entryCostSol;
        existing.marketPnlPercent = existing.entryCostSol > 0
          ? (existing.marketPnlSol / existing.entryCostSol) * 100
          : 0;
        existing.pnlSol = existing.marketPnlSol;
        existing.pnlPercent = existing.marketPnlPercent;
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
      let quoteOutLamports = 0;
      let source: 'JUPITER' | 'DEXSCREENER' | 'LASERSTREAM' | 'WSS' = 'JUPITER';

      // 1. Fetch quote through executionGateway
      try {
        const quoteRes = await executionGateway.getQuote({
          inputMint: position.mint,
          outputMint: WSOL_MINT,
          amount: String(rawAmount),
          slippageBps: 250,
          network: position.network,
          walletAddress: position.wallet,
        });

        if (quoteRes.success && quoteRes.outAmountLamports && quoteRes.outAmountLamports > 0) {
          quoteOutLamports = quoteRes.outAmountLamports;
          source = 'JUPITER';
        }
      } catch (qErr) {
        logger.warn({ mint: position.mint, err: String(qErr) }, '[PositionValuationEngine] ExecutionGateway quote failed, attempting market discovery');
      }

      // 2. Secondary fallback: CandidateEnricher / DexScreener
      if (quoteOutLamports <= 0) {
        try {
          const { candidateEnricher } = await import('../trading/CandidateEnricher.js');
          const candidate = await candidateEnricher.enrichCandidate(position.mint, position.network);
          if (candidate.priceSol?.value && candidate.priceSol.value > 0) {
            const tokenQty = safeTokenQuantity(rawAmount, position.decimals);
            quoteOutLamports = Math.floor(tokenQty * candidate.priceSol.value * 1e9);
            source = 'DEXSCREENER';
          }
        } catch (enrichErr) {
          logger.warn({ enrichErr }, '[PositionValuationEngine] Candidate enricher fallback failed');
        }
      }

      if (quoteOutLamports <= 0) {
        // Retain previous or entry price if available
        const prevPrice = position.currentPriceSol > 0 ? position.currentPriceSol : position.averageEntryPrice;
        if (prevPrice > 0) {
          const tokenQty = safeTokenQuantity(rawAmount, position.decimals);
          quoteOutLamports = Math.floor(tokenQty * prevPrice * 1e9);
          source = 'DEXSCREENER';
        } else {
          return null;
        }
      }

      const seq = (this.sequences.get(key) || 0) + 1;
      this.sequences.set(key, seq);

      const tokenQty = safeTokenQuantity(rawAmount, position.decimals);
      const executableValueSol = quoteOutLamports / 1e9;
      const currentPriceSol = tokenQty > 0 ? executableValueSol / tokenQty : position.currentPriceSol;
      const executablePnlSol = executableValueSol - position.totalSolSpent;
      const executablePnlPercent = position.totalSolSpent > 0
        ? (executablePnlSol / position.totalSolSpent) * 100
        : 0;

      // Update positionManager with current price so all subsystems stay synchronized
      positionManager.updatePositionPrice(position.network, position.wallet, position.mint, currentPriceSol, {
        isFreshQuote: source === 'JUPITER',
        timestamp: now,
      });

      const valuation: PositionValuation = {
        mint: position.mint,
        tokenAmountRaw: rawAmount,
        tokenDecimals: position.decimals,
        entryCostSol: position.totalSolSpent,
        currentPriceSol,
        executableValueSol,
        executablePnlSol,
        executablePnlPercent,
        marketValueSol: tokenQty * currentPriceSol,
        marketPnlSol: executablePnlSol,
        marketPnlPercent: executablePnlPercent,
        pnlSol: executablePnlSol,
        pnlPercent: executablePnlPercent,
        source,
        lastExecutableQuoteAt: source === 'JUPITER' ? now : undefined,
        lastMarketPriceAt: now,
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

