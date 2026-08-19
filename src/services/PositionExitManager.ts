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
  state: 'PENDING_BUY' | 'OPEN' | 'CLOSING' | 'CLOSED';
  buySignature?: string;
  buySlot?: number;
  createdAt: number;
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
        this.evaluateAllPositions();
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
      // Update existing position's TP/SL, amount, buyPrice, and solSpent if provided
      if (params.tpPct !== undefined) existing.tpPct = params.tpPct;
      if (params.slPct !== undefined) existing.slPct = params.slPct;
      if (params.amount > 0) existing.amount = params.amount;
      if (params.buyPrice > 0) {
        existing.buyPrice = params.buyPrice;
        if (!existing.currentPrice) existing.currentPrice = params.buyPrice;
        if (!existing.peakPrice) existing.peakPrice = params.buyPrice;
      }
      if (params.solSpent > 0) existing.solSpent = params.solSpent;
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
      state: 'PENDING_BUY',
      createdAt: Date.now(),
    };

    this.positions.set(params.mint, pos);
  }

  public updatePositionTpSl(mint: string, tpPct: number, slPct: number): void {
    const pos = this.positions.get(mint);
    if (pos) {
      pos.tpPct = tpPct;
      pos.slPct = slPct;
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

  public onPriceUpdate(mint: string, currentPrice: number, _timestamp: number): void {
    const pos = this.positions.get(mint);
    if (!pos || pos.state === 'CLOSED') return;

    pos.currentPrice = currentPrice;

    if (!pos.peakPrice || currentPrice > pos.peakPrice) {
      pos.peakPrice = currentPrice;
    }

    const pnlPct = this.calculatePnLPct(pos);
    if (!pos.highestPnLPct || pnlPct > pos.highestPnLPct) {
      pos.highestPnLPct = pnlPct;
    }

    if (this.isRunning && pos.state === 'OPEN') {
      this.evaluatePosition(pos);
    }
  }

  private calculatePnLPct(pos: ManagedExitPosition): number {
    if (!pos.buyPrice || pos.buyPrice <= 0) return 0;
    return ((pos.currentPrice - pos.buyPrice) / pos.buyPrice) * 100;
  }

  private async evaluateAllPositions(): Promise<void> {
    if (!this.isRunning) return;
    for (const pos of this.positions.values()) {
      if (pos.state === 'OPEN') {
        await this.evaluatePosition(pos);
      }
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

  public async triggerExit(pos: ManagedExitPosition, side: 'tp' | 'sl', pnlPct: number): Promise<void> {
    const mint = pos.mint;
    if (this.exitingMints.has(mint)) return;

    this.exitingMints.add(mint);
    pos.state = 'CLOSING';

    try {
      const slippageBps = side === 'tp' ? (pos.slippageBpsTp || 250) : (pos.slippageBpsSl || 1000);
      const label = side === 'tp' ? 'exit_tp' : 'exit_sl';

      // Query actual live token balance from executor if available
      if (typeof this.executor.getTokenBalance === 'function') {
        const liveAmount = await this.executor.getTokenBalance(mint).catch(() => 0);
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

      pos.state = 'CLOSED';
      this.exitingMints.delete(mint);
      this.positions.delete(mint);

      // Instantly refresh on-chain wallet balance after exit execution
      walletBalanceService.refreshNow();

      if (this.onExitCallback) {
        this.onExitCallback(mint, side, result.signature || 'exit-tx', pnlPct, (result.outputAmount / 1e9) - result.feeSol);
      }
    } catch (err: any) {
      console.error(`[ExitManager] ❌ Exit error for ${mint}:`, err);
      // Verify if token account was actually drained despite error (Bug 9 Fix)
      const hasTokens = await this.executor.hasTokenAccount(mint).catch(() => true);
      if (!hasTokens) {
        console.log(`[ExitManager] Token balance empty on-chain for ${mint}, marking as CLOSED.`);
        pos.state = 'CLOSED';
        this.exitingMints.delete(mint);
        this.positions.delete(mint);

        walletBalanceService.refreshNow();

        if (this.onExitCallback) {
          this.onExitCallback(mint, side, 'recovered-exit-tx', pnlPct);
        }
      } else {
        pos.state = 'OPEN';
        this.exitingMints.delete(mint);
      }
    }
  }
}
