// src/services/PositionExitManager.ts
import { Connection } from '@solana/web3.js';
import { createJupiterApiClient } from '@jup-ag/api';
import { Position, PositionState } from '../types/position';
import { ITradeExecutor } from './ITradeExecutor';

const QUOTE_CACHE_TTL_MS = 2000;      // Sell quote valid for 2s
const PENDING_TIMEOUT_MS = 60000;     // 60s timeout for stuck txs
const QUOTE_PREFETCH_INTERVAL_MS = 500; // Refresh cached quote every 500ms

export interface ExitConfig {
  tpPct: number;
  slPct: number;
  trailingSlOffset: number; // e.g. 15% below peak
  trailingSlMinRally: number; // e.g. 20% minimum peak before trailing activates
  slippageBpsTp: number;     // 2%
  slippageBpsSl: number;     // 10%
  maxPriceAgeMs: number;     // 5000ms max age for price data
}

export class PositionExitManager {
  private positions = new Map<string, Position>();
  private executor: ITradeExecutor;
  private jupiterApi: ReturnType<typeof createJupiterApiClient>;
  private connection: Connection;
  private config: ExitConfig;
  
  // Background quote prefetcher
  private quoteInterval: ReturnType<typeof setInterval> | null = null;
  
  // In-flight locks
  private exitingMints = new Set<string>();
  
  constructor(
    executor: ITradeExecutor,
    jupiterEndpoint: string,
    rpcEndpoint: string,
    config: Partial<ExitConfig> = {}
  ) {
    this.executor = executor;
    this.jupiterApi = createJupiterApiClient({ basePath: jupiterEndpoint });
    this.connection = new Connection(rpcEndpoint || 'https://api.mainnet-beta.solana.com', 'confirmed');
    this.config = {
      tpPct: 25,
      slPct: 15,
      trailingSlOffset: 15,
      trailingSlMinRally: 20,
      slippageBpsTp: 200,
      slippageBpsSl: 1000,
      maxPriceAgeMs: 5000,
      ...config,
    };
  }

  start() {
    if (this.quoteInterval) clearInterval(this.quoteInterval);
    this.quoteInterval = setInterval(() => this.prefetchSellQuotes(), QUOTE_PREFETCH_INTERVAL_MS);
  }

  stop() {
    if (this.quoteInterval) {
      clearInterval(this.quoteInterval);
      this.quoteInterval = null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CORE: Called on EVERY price update from Master Monitor (fast path)
  // ═══════════════════════════════════════════════════════════════════════

  onPriceUpdate(mint: string, priceNative: number, _timestamp: number): void {
    const pos = this.positions.get(mint);
    if (!pos) return;

    if (Date.now() - _timestamp > this.config.maxPriceAgeMs) {
      // Stale price, discard
      return;
    }

    // Skip if position is not in monitorable state
    if (!this.isMonitorable(pos.state)) return;

    // Update price and peak PnL
    pos.currentPrice = priceNative;
    const currentPnLPct = this.calculatePnLPct(pos);
    
    if (currentPnLPct > pos.peakPnLPct) {
      pos.peakPnLPct = currentPnLPct;
    }

    // Check for stuck pending states
    if (this.isPending(pos) && this.isPendingExpired(pos)) {
      console.warn(`[ExitManager] ${mint} pending timeout, resetting to OPEN`);
      pos.state = 'OPEN';
      pos.pendingSince = undefined;
      this.exitingMints.delete(mint);
    }

    // Evaluate exit conditions (INSTANT - no quote wait)
    const exitSide = this.evaluateExit(pos, currentPnLPct);
    if (exitSide && !this.exitingMints.has(mint)) {
      this.triggerExit(pos, exitSide, currentPnLPct);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // EXIT EVALUATION (pure math, no async, <1ms)
  // ═══════════════════════════════════════════════════════════════════════

  private evaluateExit(pos: Position, currentPnLPct: number): 'tp' | 'sl' | 'trailing_sl' | null {
    const tpPct = pos.tpPct ?? this.config.tpPct;
    const slPct = pos.slPct ?? this.config.slPct;
    
    // Take Profit
    if (currentPnLPct >= tpPct) return 'tp';

    // Trailing Stop Loss
    if (pos.peakPnLPct > this.config.trailingSlMinRally) {
      const trailingThreshold = pos.peakPnLPct - this.config.trailingSlOffset;
      if (currentPnLPct <= trailingThreshold) return 'trailing_sl';
    }

    // Hard Stop Loss
    if (currentPnLPct <= -Math.abs(slPct)) return 'sl';

    return null;
  }

  private calculatePnLPct(pos: Position): number {
    if (!pos.currentPrice || pos.buyPrice <= 0) return 0;
    // Use simple price ratio for fast evaluation
    return ((pos.currentPrice - pos.buyPrice) / pos.buyPrice) * 100;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // TRIGGER EXIT (async, but enters SELLING state IMMEDIATELY)
  // ═══════════════════════════════════════════════════════════════════════

  private async triggerExit(pos: Position, side: 'tp' | 'sl' | 'trailing_sl', triggerPnLPct: number) {
    const mint = pos.mint;
    
    // ATOMIC LOCK: Prevent any other exit attempt
    if (this.exitingMints.has(mint)) return;
    this.exitingMints.add(mint);
    pos.state = 'EXIT_TRIGGERED';
    pos.exitTriggeredAt = Date.now();
    pos.exitSide = side;

    console.log(`[ExitManager] 🚨 ${side.toUpperCase()} TRIGGERED for ${mint} at ${triggerPnLPct.toFixed(2)}%`);

    try {
      // Use cached quote if fresh, otherwise fetch new one
      const quote = await this.getFreshSellQuote(pos);
      if (!quote) {
        throw new Error('Could not get sell quote');
      }

      // Final executable PnL check (safety guard)
      const executablePnLPct = this.calculateExecutablePnLPct(pos, quote);
      console.log(`[ExitManager] Display PnL: ${triggerPnLPct.toFixed(2)}% | Executable: ${executablePnLPct.toFixed(2)}%`);

      // Even if executable PnL is lower, still execute if still profitable (for TP)
      // or if SL condition worsened (for SL)
      const slPct = pos.slPct ?? this.config.slPct;
      let shouldExecute = false;
      
      if (side === 'tp') {
         shouldExecute = executablePnLPct > 0;
      } else if (side === 'trailing_sl') {
         const trailingThreshold = pos.peakPnLPct - this.config.trailingSlOffset;
         shouldExecute = executablePnLPct <= trailingThreshold;
      } else {
         shouldExecute = executablePnLPct <= -Math.abs(slPct);
      }

      if (!shouldExecute) {
        console.log(`[ExitManager] Exit condition no longer valid, releasing lock`);
        pos.state = 'OPEN';
        this.exitingMints.delete(mint);
        return;
      }

      // EXECUTE SELL
      pos.state = 'SELL_PENDING';
      pos.pendingSince = Date.now();

      const result = await this.executor.swap(
        pos.mint,
        'So11111111111111111111111111111111111111112',
        Math.floor(pos.amount),
        side === 'tp' ? this.config.slippageBpsTp : this.config.slippageBpsSl,
        side === 'tp' ? 'exit_tp' : 'exit_sl'
      );

      pos.sellSignature = result.signature;
      pos.sellSlot = result.slot;
      pos.state = 'SELL_CONFIRMED';
      
      console.log(`[ExitManager] ✅ SOLD ${mint} | Sig: ${result.signature} | Output: ${result.outputAmount}`);
      this.onExitCallback?.(mint, side, result.signature, triggerPnLPct);

      // Final state
      pos.state = 'CLOSED';
      this.exitingMints.delete(mint);

    } catch (err: any) {
      console.error(`[ExitManager] ❌ Exit failed for ${mint}:`, err?.message || err);
      
      // Reset to OPEN for retry (unless max retries exceeded)
      pos.state = 'OPEN';
      pos.pendingSince = undefined;
      this.exitingMints.delete(mint);
      
      // Exponential backoff for retry
      await this.scheduleRetry(mint);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // QUOTE MANAGEMENT (pre-fetch + cache)
  // ═══════════════════════════════════════════════════════════════════════

  private onExitCallback?: (mint: string, side: string, signature: string, pnlPct: number) => void;

  public setOnExitCallback(cb: (mint: string, side: string, signature: string, pnlPct: number) => void) {
    this.onExitCallback = cb;
  }

  private async prefetchSellQuotes(): Promise<void> {
    for (const pos of this.positions.values()) {
      if (!this.isMonitorable(pos.state)) continue;
      
      // Skip if we have a fresh cached quote (< 1500ms old)
      if (pos.cachedSellQuote && Date.now() - pos.cachedSellQuote.fetchedAt < 1500) {
        continue;
      }

      try {
        const currentPnLPct = this.calculatePnLPct(pos);
        // Use SL slippage if position is dropping/negative, TP slippage if in profit
        const slippageBps = currentPnLPct <= 0 ? this.config.slippageBpsSl : this.config.slippageBpsTp;

        const quote = await this.jupiterApi.quoteGet({
          inputMint: pos.mint,
          outputMint: 'So11111111111111111111111111111111111111112',
          amount: Math.floor(pos.amount),
          slippageBps,
          restrictIntermediateTokens: true,
        });

        const outAmount = quote.outAmount ? Number(quote.outAmount) : 0;

        pos.cachedSellQuote = {
          quoteResponse: quote,
          fetchedAt: Date.now(),
          expectedOutputSol: outAmount / 1e9,
        };
      } catch {
        // Quote prefetch failure is non-fatal
        pos.cachedSellQuote = undefined;
      }
    }
  }

  private async getFreshSellQuote(pos: Position): Promise<any | null> {
    // Use cached quote if fresh (< 1500ms old)
    if (pos.cachedSellQuote && Date.now() - pos.cachedSellQuote.fetchedAt < 1500) {
      return pos.cachedSellQuote.quoteResponse;
    }

    // Otherwise fetch immediately
    try {
      return await this.jupiterApi.quoteGet({
        inputMint: pos.mint,
        outputMint: 'So11111111111111111111111111111111111111112',
        amount: Math.floor(pos.amount),
        slippageBps: pos.exitSide === 'tp' ? this.config.slippageBpsTp : this.config.slippageBpsSl,
        restrictIntermediateTokens: true,
      });
    } catch {
      return null;
    }
  }

  private calculateExecutablePnLPct(pos: Position, quote: any): number {
    const rawOut = quote.otherAmountThreshold ? Number(quote.otherAmountThreshold) : Number(quote.outAmount || 0);
    const guaranteedOutput = rawOut / 1e9;
    const netAfterFees = guaranteedOutput * 0.99; // 1% buffer
    return ((netAfterFees - pos.solSpent) / pos.solSpent) * 100;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // POSITION LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════════

  addPosition(pos: Partial<Position> & { mint: string; amount: number; buyPrice: number; solSpent: number }): Position {
    const fullPos: Position = {
      symbol: pos.symbol || pos.mint.slice(0, 6),
      currentPrice: pos.buyPrice,
      riskScore: pos.riskScore ?? 0,
      isRugSafe: pos.isRugSafe ?? true,
      devWalletPercentage: pos.devWalletPercentage ?? 0,
      top10Percentage: pos.top10Percentage ?? 0,
      tpPct: pos.tpPct ?? this.config.tpPct,
      slPct: pos.slPct ?? this.config.slPct,
      ...pos,
      state: 'BUY_PENDING',
      peakPnLPct: 0,
      pendingSince: Date.now(),
    };
    this.positions.set(pos.mint, fullPos);
    return fullPos;
  }

  confirmBuy(mint: string, signature: string, slot: number): void {
    const pos = this.positions.get(mint);
    if (!pos) return;
    pos.state = 'OPEN';
    pos.buySignature = signature;
    pos.buySlot = slot;
    pos.pendingSince = undefined;
  }

  removePosition(mint: string): void {
    this.positions.delete(mint);
    this.exitingMints.delete(mint);
  }

  getPosition(mint: string): Position | undefined {
    return this.positions.get(mint);
  }

  getAllPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  getOpenPositions(): Position[] {
    return this.getAllPositions().filter(p => this.isMonitorable(p.state));
  }

  // ═══════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════

  private isMonitorable(state: PositionState): boolean {
    return state === 'OPEN' || state === 'EXIT_TRIGGERED';
  }

  private isPending(pos: Position): boolean {
    return pos.state === 'BUY_PENDING' || pos.state === 'SELL_PENDING';
  }

  private isPendingExpired(pos: Position): boolean {
    if (!pos.pendingSince) return false;
    return Date.now() - pos.pendingSince > PENDING_TIMEOUT_MS;
  }

  private async scheduleRetry(mint: string, delayMs = 5000): Promise<void> {
    setTimeout(() => {
      const pos = this.positions.get(mint);
      if (pos && pos.state === 'OPEN') {
        // Retry will happen on next price update
        console.log(`[ExitManager] Retry scheduled for ${mint}`);
      }
    }, delayMs);
  }
}
