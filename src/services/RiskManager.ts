// src/services/RiskManager.ts
import { ITradeExecutor } from './ITradeExecutor';
import { executionEngine } from './ExecutionEngine';
import { orderManager } from './OrderManager';
import { walletBalanceService } from './WalletBalanceService';
import { useBalanceStore } from '../store/balanceStore';
import { positionRegistry } from './PositionRegistry';
import { tokenRegistry } from './TokenRegistry';
import { tradeHistoryRegistry } from './TradeHistoryRegistry';
import { useTradingEnvironmentStore } from '../store/tradingEnvironmentStore';

import { resolveTokenDecimals } from './PaperTradeExecutor';

export interface ManagedPosition {
  mint: string;
  amount: number; // Raw token amount
  tokenDecimals: number;
  buyPrice: number; // Entry price (SOL or native)
  solSpent: number; // Cost basis in SOL
  tpPct: number;
  slPct: number;
  trailingSlPct?: number;
  maxHoldTimeMs?: number;
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

export interface RiskConfig {
  tpPct: number;
  slPct: number;
  trailingSlPct?: number;
  maxHoldTimeMs?: number;
  maxOpenPositions?: number;
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

export type ExitErrorCallback = (
  mint: string,
  side: 'tp' | 'sl',
  errorMessage: string
) => void;

/**
 * RiskManager: Authoritative component for risk parameters, TP, SL, trailing SL,
 * max hold times, position limits, and emergency exits.
 * 
 * CORE RULE: RiskManager evaluates exits and triggers them through OrderManager/ExecutionEngine.
 * It NEVER executes independent direct transactions.
 */
export class RiskManager {
  private static instance: RiskManager;
  private positions: Map<string, ManagedPosition> = new Map();
  private exitingMints: Set<string> = new Set();
  private isEvaluatingLoop: boolean = false;
  private executor: ITradeExecutor;
  private config: RiskConfig;
  private onExitCallback?: ExitCallback;
  private onExitErrorCallback?: ExitErrorCallback;
  private lastExitErrorTimes: Map<string, number> = new Map();
  private isRunning: boolean = false;
  private evaluationInterval: any = null;

  constructor(
    executor: ITradeExecutor = executionEngine,
    config: RiskConfig = {
      tpPct: 25,
      slPct: 15,
      trailingSlPct: 10,
      maxHoldTimeMs: 0,
      maxOpenPositions: 10,
      slippageBpsTp: 250,
      slippageBpsSl: 1000,
    }
  ) {
    this.executor = executor;
    this.config = config;
  }

  public static getInstance(): RiskManager {
    if (!RiskManager.instance) {
      RiskManager.instance = new RiskManager();
    }
    return RiskManager.instance;
  }

  public setExecutor(executor: ITradeExecutor): void {
    this.executor = executor;
  }

  public setOnExitCallback(cb: ExitCallback): void {
    this.onExitCallback = cb;
  }

  public setOnExitErrorCallback(cb: ExitErrorCallback): void {
    this.onExitErrorCallback = cb;
  }

  public updateConfig(partial: Partial<RiskConfig>): void {
    this.config = { ...this.config, ...partial };
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

  public canOpenNewPosition(): boolean {
    if (!this.config.maxOpenPositions || this.config.maxOpenPositions <= 0) return true;
    const openCount = Array.from(this.positions.values()).filter(
      p => p.state === 'OPEN' || p.state === 'PENDING_BUY'
    ).length;
    return openCount < this.config.maxOpenPositions;
  }

  public addPosition(params: {
    mint: string;
    amount: number;
    buyPrice: number;
    solSpent: number;
    tpPct?: number;
    slPct?: number;
    trailingSlPct?: number;
    maxHoldTimeMs?: number;
    slippageBpsTp?: number;
    slippageBpsSl?: number;
    tokenDecimals?: number;
    buySignature?: string;
    buyOrderId?: string;
  }): void {
    const existing = this.positions.get(params.mint);
    if (existing && existing.state !== 'CLOSED') {
      if (params.tpPct !== undefined) existing.tpPct = params.tpPct;
      if (params.slPct !== undefined) existing.slPct = Math.abs(params.slPct);
      if (params.trailingSlPct !== undefined) existing.trailingSlPct = params.trailingSlPct;
      if (params.amount > 0) existing.amount = params.amount;
      if (params.buyPrice > 0) existing.buyPrice = params.buyPrice;
      if (params.solSpent > 0) existing.solSpent = params.solSpent;
      if (existing.state === 'RECOVERY_REQUIRED') existing.state = 'OPEN';
      return;
    }

    let calculatedBuyPrice = params.buyPrice || 0;
    const decimals = params.tokenDecimals !== undefined ? params.tokenDecimals : 6;
    if (calculatedBuyPrice <= 0 && params.solSpent > 0 && params.amount > 0) {
      const humanAmount = params.amount > 1e6 ? params.amount / (10 ** decimals) : params.amount;
      calculatedBuyPrice = humanAmount > 0 ? params.solSpent / humanAmount : 0;
    }

    const fallbackPrice = calculatedBuyPrice > 0 ? calculatedBuyPrice : 0.0000003;

    const pos: ManagedPosition = {
      mint: params.mint,
      amount: params.amount > 0 ? params.amount : 0,
      tokenDecimals: decimals,
      buyPrice: fallbackPrice,
      solSpent: params.solSpent || 0,
      tpPct: params.tpPct ?? this.config.tpPct,
      slPct: Math.abs(params.slPct ?? this.config.slPct),
      trailingSlPct: params.trailingSlPct ?? this.config.trailingSlPct,
      maxHoldTimeMs: params.maxHoldTimeMs ?? this.config.maxHoldTimeMs,
      slippageBpsTp: params.slippageBpsTp ?? this.config.slippageBpsTp ?? 250,
      slippageBpsSl: params.slippageBpsSl ?? this.config.slippageBpsSl ?? 1000,
      currentPrice: fallbackPrice,
      peakPrice: fallbackPrice,
      highestPnLPct: 0,
      state: 'OPEN',
      createdAt: Date.now(),
    };

    this.positions.set(params.mint, pos);
    
    // Sync to PositionRegistry and TokenRegistry
    const network = useTradingEnvironmentStore.getState().network || 'devnet';
    const posRecord = positionRegistry.openPosition({
      mintAddress: params.mint,
      network,
      amountRaw: pos.amount,
      decimals,
      entryPriceSOL: pos.buyPrice,
      solSpent: pos.solSpent,
      tpPct: pos.tpPct,
      slPct: pos.slPct,
      trailingSlPct: pos.trailingSlPct,
      maxHoldTimeMs: pos.maxHoldTimeMs,
      slippageBpsTp: pos.slippageBpsTp,
      slippageBpsSl: pos.slippageBpsSl,
      orderId: params.buyOrderId,
      buySignature: params.buySignature,
    });
    tokenRegistry.setExecutionState(params.mint, 'POSITION_OPEN', posRecord.id);

    // Record BUY trade in TradeHistoryRegistry
    tradeHistoryRegistry.recordTrade({
      id: 'BUY_' + params.mint + '_' + Date.now(),
      orderId: params.buyOrderId,
      positionId: posRecord.id,
      mintAddress: params.mint,
      side: 'BUY',
      network,
      amountRaw: pos.amount,
      amountTokens: pos.amount > 1e6 ? pos.amount / (10 ** decimals) : pos.amount,
      solAmount: pos.solSpent,
      priceSOL: pos.buyPrice,
      signature: params.buySignature || 'BUY_SIG_' + Math.random().toString(36).substring(7),
      timestamp: Date.now(),
      status: 'CONFIRMED',
    });

    if (this.isRunning) {
      void this.evaluatePosition(pos);
    }
  }

  public updatePositionTpSl(mint: string, tpPct: number, slPct: number, trailingSlPct?: number): void {
    const pos = this.positions.get(mint);
    if (pos) {
      pos.tpPct = tpPct;
      pos.slPct = Math.abs(slPct);
      if (trailingSlPct !== undefined) pos.trailingSlPct = trailingSlPct;
      if (pos.state === 'RECOVERY_REQUIRED') {
        pos.state = 'OPEN';
      }
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

  public getPosition(mint: string): ManagedPosition | undefined {
    return this.positions.get(mint);
  }

  public getAllPositions(): ManagedPosition[] {
    return Array.from(this.positions.values());
  }

  public onPriceUpdate(mint: string, rawPrice: number, timestamp: number = Date.now()): void {
    const pos = this.positions.get(mint);
    if (!pos || pos.state === 'CLOSED' || !rawPrice || rawPrice <= 0) return;

    const currentPrice = rawPrice;
    pos.currentPrice = currentPrice;
    pos.lastPriceUpdate = timestamp;

    if (!pos.peakPrice || currentPrice > pos.peakPrice) {
      pos.peakPrice = currentPrice;
    }

    const pnlPct = this.calculatePnLPct(pos);
    if (!pos.highestPnLPct || pnlPct > pos.highestPnLPct) {
      pos.highestPnLPct = pnlPct;
    }

    // Sync price to TokenRegistry & PositionRegistry
    tokenRegistry.updatePrice(mint, currentPrice);
    positionRegistry.updatePrice(mint, currentPrice);

    if (this.isRunning && (pos.state === 'OPEN' || pos.state === 'RECOVERY_REQUIRED')) {
      void this.evaluatePosition(pos);
    }
  }

  public calculatePnLPct(pos: ManagedPosition): number {
    if (!pos.buyPrice || pos.buyPrice <= 0) {
      if (pos.amount > 0 && pos.solSpent > 0) {
        const rawUnits = pos.amount / (10 ** pos.tokenDecimals);
        if (rawUnits > 0) pos.buyPrice = pos.solSpent / rawUnits;
      }
    }
    if (!pos.buyPrice || pos.buyPrice <= 0) return 0;
    const current = pos.currentPrice;
    if (!current || current <= 0) return 0;

    return ((current - pos.buyPrice) / pos.buyPrice) * 100;
  }

  private async evaluateAllPositions(): Promise<void> {
    if (!this.isRunning || this.isEvaluatingLoop) return;
    this.isEvaluatingLoop = true;
    try {
      for (const pos of this.positions.values()) {
        if (pos.state === 'OPEN' || pos.state === 'RECOVERY_REQUIRED') {
          await this.evaluatePosition(pos);
        }
      }
    } finally {
      this.isEvaluatingLoop = false;
    }
  }

  private async evaluatePosition(pos: ManagedPosition): Promise<void> {
    const mint = pos.mint;
    if (this.exitingMints.has(mint) || pos.state === 'CLOSING' || pos.state === 'CLOSED') {
      return;
    }

    const now = Date.now();

    // 1. Max hold time check
    if (pos.maxHoldTimeMs && pos.maxHoldTimeMs > 0 && pos.createdAt > 0) {
      if (now - pos.createdAt >= pos.maxHoldTimeMs) {
        console.log(`[RiskManager] ⏱ MAX HOLD TIME reached for ${mint}. Triggering exit.`);
        await this.triggerExit(pos, 'sl', this.calculatePnLPct(pos));
        return;
      }
    }

    const pnlPct = this.calculatePnLPct(pos);
    const tpPct = pos.tpPct ?? this.config.tpPct;
    const slPct = Math.abs(pos.slPct ?? this.config.slPct);

    // 2. Trailing stop check
    const peakPnL = pos.highestPnLPct || 0;
    if (pos.trailingSlPct && pos.trailingSlPct > 0 && peakPnL >= 15) {
      const trailingDrop = peakPnL - pnlPct;
      if (trailingDrop >= pos.trailingSlPct) {
        console.log(`[RiskManager] 📉 TRAILING STOP Triggered for ${mint}: Peak +${peakPnL.toFixed(1)}%, Current: ${pnlPct.toFixed(1)}%`);
        await this.triggerExit(pos, 'sl', pnlPct);
        return;
      }
    }

    // 3. Static TP / SL checks
    if (pnlPct >= tpPct) {
      console.log(`[RiskManager] 🎯 TAKE PROFIT Triggered for ${mint}: PnL = +${pnlPct.toFixed(2)}% (Target: +${tpPct}%)`);
      await this.triggerExit(pos, 'tp', pnlPct);
    } else if (pnlPct <= -slPct) {
      console.log(`[RiskManager] 🛑 STOP LOSS Triggered for ${mint}: PnL = ${pnlPct.toFixed(2)}% (Target: -${slPct}%)`);
      await this.triggerExit(pos, 'sl', pnlPct);
    }
  }

  public async requestExit(
    mint: string,
    reason: string = 'MANUAL_FORCE_EXIT',
    fallbackAmount?: number,
    fallbackSolSpent?: number
  ): Promise<void> {
    let pos = this.positions.get(mint);
    if (!pos) {
      let liveAmount = fallbackAmount || 0;
      if (liveAmount <= 0 && typeof this.executor.getTokenBalance === 'function') {
        try {
          liveAmount = await this.executor.getTokenBalance(mint);
        } catch {}
      }
      let dec = 6;
      try {
        dec = resolveTokenDecimals(mint);
      } catch {
        dec = tokenRegistry.getToken(mint)?.decimals || 6;
      }
      this.addPosition({
        mint,
        amount: liveAmount > 0 ? liveAmount : 1_000_000,
        buyPrice: 0,
        solSpent: fallbackSolSpent || 0,
        tokenDecimals: dec,
      });
      pos = this.positions.get(mint);
    }
    if (!pos || pos.state === 'CLOSING' || pos.state === 'CLOSED') {
      return;
    }

    const pnlPct = this.calculatePnLPct(pos);
    const side: 'tp' | 'sl' = pnlPct >= 0 ? 'tp' : 'sl';
    console.log(`[RiskManager] 🚨 Explicit exit requested for ${mint} (${reason}) at PnL: ${pnlPct.toFixed(2)}%`);
    await this.triggerExit(pos, side, pnlPct);
  }

  public async triggerExit(pos: ManagedPosition, side: 'tp' | 'sl', pnlPct: number): Promise<void> {
    const mint = pos.mint;
    if (this.exitingMints.has(mint) || pos.state === 'CLOSING' || pos.state === 'CLOSED') return;

    this.exitingMints.add(mint);
    pos.state = 'CLOSING';

    try {
      const slippageBps = side === 'tp' ? (pos.slippageBpsTp || 250) : (pos.slippageBpsSl || 1000);
      const label = side === 'tp' ? 'exit_tp' : 'exit_sl';

      if (typeof this.executor.getTokenBalance === 'function') {
        try {
          const liveAmount = await this.executor.getTokenBalance(mint);
          if (liveAmount > 0) {
            pos.amount = liveAmount;
          }
        } catch {}
      }

      console.log(`[RiskManager] ⚡ Executing ${side.toUpperCase()} exit swap for ${mint} at PnL: ${pnlPct.toFixed(2)}% (Amount: ${pos.amount})`);

      // Route execution through OrderManager & ExecutionEngine
      const result = await orderManager.executeOrder(
        mint,
        'So11111111111111111111111111111111111111112',
        pos.amount,
        slippageBps,
        label
      );

      pos.state = 'CLOSED';
      this.exitingMints.delete(mint);
      this.positions.delete(mint);

      // Record in PositionRegistry, TokenRegistry, and TradeHistoryRegistry
      const netSolReceived = Math.max(0, (result.outputAmount / 1e9) - (result.feeSol || 0));
      const pnlSol = netSolReceived - (pos.solSpent || 0);

      positionRegistry.closePosition(mint, result.signature, pnlSol, pnlPct);
      tokenRegistry.setExecutionState(mint, 'CLOSED');

      tradeHistoryRegistry.recordTrade({
        id: `trade_${Date.now()}_${mint.slice(0, 6)}`,
        mintAddress: mint,
        side: 'SELL',
        network: useTradingEnvironmentStore.getState().network || 'devnet',
        amountRaw: pos.amount,
        amountTokens: pos.amount / (10 ** pos.tokenDecimals),
        solAmount: netSolReceived,
        priceSOL: pos.currentPrice,
        pnlSol,
        pnlPct,
        signature: result.signature || 'exit-tx',
        timestamp: Date.now(),
        status: 'CONFIRMED',
      });

      await walletBalanceService.verifyTokenBalanceCleared(mint);

      if (this.onExitCallback) {
        this.onExitCallback(mint, side, result.signature || 'exit-tx', pnlPct, netSolReceived);
      }
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      console.error(`[RiskManager] ❌ Exit error for ${mint}:`, err);
      this.exitingMints.delete(mint);
      pos.state = 'OPEN'; // Reset state so next evaluation cycle can retry

      const now = Date.now();
      const lastLogged = this.lastExitErrorTimes.get(mint) || 0;
      if (now - lastLogged >= 15000) {
        this.lastExitErrorTimes.set(mint, now);
        if (this.onExitErrorCallback) {
          this.onExitErrorCallback(mint, side, errMsg);
        }
      }

      if (typeof this.executor.getTokenBalance === 'function') {
        try {
          const liveBalance = await this.executor.getTokenBalance(mint);
          if (liveBalance <= 1000) {
            pos.state = 'CLOSED';
            this.positions.delete(mint);
            useBalanceStore.getState().setTokenBalance(mint, 0);
            await walletBalanceService.refreshWithRetry(undefined, 3, 400);
            if (this.onExitCallback) {
              this.onExitCallback(mint, side, 'recovered-exit-tx', pnlPct);
            }
          }
        } catch {}
      }
    }
  }

  public getPositions(): Map<string, ManagedPosition> {
    return this.positions;
  }
}

export const riskManager = RiskManager.getInstance();
