// src/services/PositionExitManager.ts

import { ITradeExecutor } from './ITradeExecutor';
import { walletBalanceService } from './WalletBalanceService';

export interface ManagedExitPosition {
  mint: string;
  amount: number; // Token units (lamports or raw tokens)
  buyPrice: number; // Entry price (SOL or native)
  solSpent: number; // Cost basis in SOL
  tpPct: number;
  slPct: number;
  slippageBpsTp?: number;
  slippageBpsSl?: number;
  currentPrice: number;
  peakPrice?: number;
  highestPnLPct?: number;
  state: 'PENDING_BUY' | 'OPEN' | 'CLOSING' | 'CLOSED' | 'RECOVERY_REQUIRED';
  buySignature?: string;
  buySlot?: number;
  createdAt: number;
  lastPriceUpdate?: number;
  pendingSince?: number;
}

export interface DefaultExitConfig {
  tpPct: number;
  slPct: number;
  slippageBpsTp?: number;
  slippageBpsSl?: number;
}

export type ExitCallback = (
  mint: string,
  side: 'tp' | 'sl',
  signature: string,
  pnlPct: number,
  outputAmountSol?: number
) => void;

export class PositionExitManager {
  private positions: Map<string, ManagedExitPosition> = new Map();
  private exitingMints: Set<string> = new Set();
  private isEvaluatingLoop: boolean = false;
  private executor: ITradeExecutor;
  private jupiterRpcUrl: string;
  private dedicatedRpcUrl: string;
  private defaultConfig: DefaultExitConfig;
  private onExitCallback?: ExitCallback;
  private isRunning: boolean = false;
  private evaluationInterval: any = null;

  constructor(
    executor: ITradeExecutor,
    jupiterRpcUrl: string = 'https://api.jup.ag/swap/v1',
    dedicatedRpcUrl: string = '',
    defaultConfig: DefaultExitConfig = { tpPct: 25, slPct: 15, slippageBpsTp: 250, slippageBpsSl: 1000 }
  ) {
    this.executor = executor;
    this.jupiterRpcUrl = jupiterRpcUrl;
    this.dedicatedRpcUrl = dedicatedRpcUrl;
    this.defaultConfig = defaultConfig;
  }

  public setOnExitCallback(cb: ExitCallback): void {
    this.onExitCallback = cb;
  }

  public start(): void {
    this.isRunning = true;
    if (!this.evaluationInterval) {
      // 200ms high-frequency evaluation loop (5x per second)
      this.evaluationInterval = setInterval(() => {
        void this.evaluateAllPositions();
      }, 200);
    }
  }

  public stop(): void {
    this.isRunning = false;
    if (this.evaluationInterval) {
      clearInterval(this.evaluationInterval);
      this.evaluationInterval = null;
    }
  }

  public addPosition(params: {
    mint: string;
    amount: number;
    buyPrice: number;
    solSpent: number;
    tpPct?: number;
    slPct?: number;
    slippageBpsTp?: number;
    slippageBpsSl?: number;
  }): void {
    const existing = this.positions.get(params.mint);
    if (existing && existing.state !== 'CLOSED') {
      // ONLY update existing position's TP/SL if provided
      if (params.tpPct !== undefined) existing.tpPct = params.tpPct;
      if (params.slPct !== undefined) existing.slPct = params.slPct;
      return;
    }

    const pos: ManagedExitPosition = {
      mint: params.mint,
      amount: params.amount,
      buyPrice: params.buyPrice,
      solSpent: params.solSpent || 0.1,
      tpPct: params.tpPct ?? this.defaultConfig.tpPct,
      slPct: params.slPct ?? this.defaultConfig.slPct,
      slippageBpsTp: params.slippageBpsTp ?? this.defaultConfig.slippageBpsTp ?? 250,
      slippageBpsSl: params.slippageBpsSl ?? this.defaultConfig.slippageBpsSl ?? 1000,
      currentPrice: params.buyPrice,
      peakPrice: params.buyPrice,
      highestPnLPct: 0,
      state: 'OPEN',
      createdAt: Date.now(),
    };

    this.positions.set(params.mint, pos);
    if (this.isRunning) {
      void this.evaluatePosition(pos);
    }
  }

  public updatePositionTpSl(mint: string, tpPct: number, slPct: number): void {
    const pos = this.positions.get(mint);
    if (pos) {
      pos.tpPct = tpPct;
      pos.slPct = slPct;
      if (this.isRunning && pos.state === 'OPEN') {
        void this.evaluatePosition(pos);
      }
    }
  }

  public confirmBuy(mint: string, signature: string, slot: number): void {
    const pos = this.positions.get(mint);
    if (!pos) return;
    pos.state = 'OPEN';
    pos.buySignature = signature;
    pos.buySlot = slot;
  }

  public removePosition(mint: string): void {
    this.positions.delete(mint);
    this.exitingMints.delete(mint);
  }

  public getPosition(mint: string): ManagedExitPosition | undefined {
    return this.positions.get(mint);
  }

  public getAllPositions(): ManagedExitPosition[] {
    return Array.from(this.positions.values());
  }

  private pendingPriceFetches: Set<string> = new Set();

  public onPriceUpdate(mint: string, rawPrice: number, timestamp: number = Date.now()): void {
    const pos = this.positions.get(mint);
    if (!pos || pos.state === 'CLOSED' || !rawPrice || rawPrice <= 0) return;

    let currentPrice = rawPrice;
    // Sanity check: If rawPrice was mistakenly provided in USD (approx ~100x - 300x higher than native SOL buy price)
    if (pos.buyPrice > 0 && currentPrice > pos.buyPrice * 30 && currentPrice < pos.buyPrice * 400) {
      currentPrice = currentPrice / 150;
    }

    pos.currentPrice = currentPrice;
    pos.lastPriceUpdate = timestamp;

    if (!pos.peakPrice || currentPrice > pos.peakPrice) {
      pos.peakPrice = currentPrice;
    }

    const pnlPct = this.calculatePnLPct(pos);
    if (!pos.highestPnLPct || pnlPct > pos.highestPnLPct) {
      pos.highestPnLPct = pnlPct;
    }

    if (this.isRunning && pos.state === 'OPEN') {
      void this.evaluatePosition(pos);
    }
  }

  private calculatePnLPct(pos: ManagedExitPosition): number {
    if (!pos.buyPrice || pos.buyPrice <= 0) return 0;
    let current = pos.currentPrice;
    // Extra guard against USD/SOL price scale confusion
    if (current > pos.buyPrice * 30 && current < pos.buyPrice * 400) {
      current = current / 150;
    }
    return ((current - pos.buyPrice) / pos.buyPrice) * 100;
  }

  private async fetchFallbackPriceForPosition(mint: string): Promise<void> {
    if (this.pendingPriceFetches.has(mint)) return;
    this.pendingPriceFetches.add(mint);
    try {
      // 1. Try Jupiter Price V2 with native SOL quote token
      const jupRes = await fetch(`https://api.jup.ag/price/v2?ids=${mint}&vsToken=So11111111111111111111111111111111111111112`).catch(() => null);
      if (jupRes && jupRes.ok) {
        const jupJson = await jupRes.json();
        const priceStr = jupJson.data?.[mint]?.price;
        if (priceStr) {
          const p = parseFloat(priceStr);
          if (p > 0) {
            this.onPriceUpdate(mint, p, Date.now());
            return;
          }
        }
      }

      // 2. Try DexScreener
      const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`).catch(() => null);
      if (dexRes && dexRes.ok) {
        const dexData = await dexRes.json();
        const pair = dexData.pairs?.[0];
        if (pair) {
          const isSolQuote = pair.quoteToken?.symbol === 'SOL' || pair.quoteToken?.address === 'So11111111111111111111111111111111111111112';
          if (isSolQuote && pair.priceNative) {
            const p = parseFloat(pair.priceNative);
            if (p > 0) {
              this.onPriceUpdate(mint, p, Date.now());
              return;
            }
          } else if (pair.priceUsd) {
            const p = parseFloat(pair.priceUsd) / 150;
            if (p > 0) {
              this.onPriceUpdate(mint, p, Date.now());
              return;
            }
          }
        }
      }
    } catch {
      // Ignore background fallback fetch error
    } finally {
      this.pendingPriceFetches.delete(mint);
    }
  }

  private async evaluateAllPositions(): Promise<void> {
    if (!this.isRunning || this.isEvaluatingLoop) return;
    this.isEvaluatingLoop = true;
    const now = Date.now();
    try {
      for (const pos of this.positions.values()) {
        if (pos.state === 'OPEN') {
          // If position price is stale (>2500ms since last update), trigger autonomous fallback fetch
          if (!pos.lastPriceUpdate || (now - pos.lastPriceUpdate > 2500)) {
            void this.fetchFallbackPriceForPosition(pos.mint);
          }
          await this.evaluatePosition(pos);
        }
      }
    } finally {
      this.isEvaluatingLoop = false;
    }
  }

  private async evaluatePosition(pos: ManagedExitPosition): Promise<void> {
    const mint = pos.mint;
    if (this.exitingMints.has(mint) || pos.state !== 'OPEN') {
      return;
    }

    const pnlPct = this.calculatePnLPct(pos);
    const tpPct = pos.tpPct ?? this.defaultConfig.tpPct;
    const slPct = pos.slPct ?? this.defaultConfig.slPct;

    if (pnlPct >= tpPct) {
      await this.triggerExit(pos, 'tp', pnlPct);
    } else if (pnlPct <= -Math.abs(slPct)) {
      await this.triggerExit(pos, 'sl', pnlPct);
    }
  }

  public async requestExit(mint: string, reason: string = 'MANUAL_FORCE_EXIT'): Promise<void> {
    let pos = this.positions.get(mint);
    if (!pos) {
      // Create a temporary managed position if it doesn't exist yet in the manager
      let liveAmount = 0;
      if (typeof this.executor.getTokenBalance === 'function') {
        try {
          liveAmount = await this.executor.getTokenBalance(mint);
        } catch {}
      }
      if (liveAmount <= 0) {
        console.warn(`[ExitManager] No balance or position found for manual exit request on ${mint}`);
        return;
      }
      this.addPosition({
        mint,
        amount: liveAmount,
        buyPrice: 0,
        solSpent: 0,
      });
      pos = this.positions.get(mint);
    }
    if (!pos || pos.state === 'CLOSING' || pos.state === 'CLOSED') {
      return;
    }

    const pnlPct = this.calculatePnLPct(pos);
    const side: 'tp' | 'sl' = pnlPct >= 0 ? 'tp' : 'sl';
    console.log(`[ExitManager] 🚨 Explicit exit requested for ${mint} (${reason})`);
    await this.triggerExit(pos, side, pnlPct);
  }

  public async triggerExit(pos: ManagedExitPosition, side: 'tp' | 'sl', pnlPct: number): Promise<void> {
    const mint = pos.mint;
    if (this.exitingMints.has(mint) || pos.state !== 'OPEN') return;

    this.exitingMints.add(mint);
    pos.state = 'CLOSING';

    try {
      const slippageBps = side === 'tp' ? (pos.slippageBpsTp || 250) : (pos.slippageBpsSl || 1000);
      const label = side === 'tp' ? 'exit_tp' : 'exit_sl';

      // Query live token balance before exit
      if (typeof this.executor.getTokenBalance === 'function') {
        const liveAmount = await this.executor.getTokenBalance(mint).catch(() => pos.amount);
        if (liveAmount > 0) {
          pos.amount = liveAmount;
        }
      }

      console.log(`[ExitManager] ⚡ Executing ${side.toUpperCase()} exit for ${mint} at PnL: ${pnlPct.toFixed(2)}% (Amount: ${pos.amount})`);

      const result = await this.executor.swap(
        mint,
        'So11111111111111111111111111111111111111112',
        pos.amount,
        slippageBps,
        label
      );

      // Verify on-chain balance after swap confirmation
      let liveBalance: number | null = null;
      try {
        liveBalance = await this.executor.getTokenBalance(mint);
      } catch (balErr) {
        console.warn(`[ExitManager] Post-exit balance query failed for ${mint}:`, balErr);
        pos.state = 'RECOVERY_REQUIRED';
        this.exitingMints.delete(mint);
        return;
      }

      const DUST_THRESHOLD = 1000;
      if (liveBalance <= DUST_THRESHOLD) {
        pos.state = 'CLOSED';
        this.exitingMints.delete(mint);
        this.positions.delete(mint);

        walletBalanceService.refreshNow();

        const netSolReceived = Math.max(0, (result.outputAmount / 1e9) - (result.feeSol || 0));
        if (this.onExitCallback) {
          this.onExitCallback(mint, side, result.signature || 'exit-tx', pnlPct, netSolReceived);
        }
      } else {
        pos.amount = liveBalance;
        pos.state = 'OPEN';
        this.exitingMints.delete(mint);
      }
    } catch (err: any) {
      console.error(`[ExitManager] ❌ Exit error for ${mint}:`, err);
      
      let liveBalance: number | null = null;
      try {
        liveBalance = await this.executor.getTokenBalance(mint);
      } catch (balErr) {
        console.warn(`[ExitManager] Post-error balance query failed for ${mint}:`, balErr);
        pos.state = 'RECOVERY_REQUIRED';
        this.exitingMints.delete(mint);
        return;
      }

      if (liveBalance <= 1000) {
        console.log(`[ExitManager] Token balance empty on-chain for ${mint}, marking as CLOSED.`);
        pos.state = 'CLOSED';
        this.exitingMints.delete(mint);
        this.positions.delete(mint);

        walletBalanceService.refreshNow();

        if (this.onExitCallback) {
          this.onExitCallback(mint, side, 'recovered-exit-tx', pnlPct);
        }
      } else {
        pos.amount = liveBalance;
        pos.state = 'OPEN';
        this.exitingMints.delete(mint);
      }
    }
  }
}
