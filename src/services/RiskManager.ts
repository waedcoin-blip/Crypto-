// src/services/RiskManager.ts
import { ITradeExecutor } from './ITradeExecutor';
import { executionEngine } from './ExecutionEngine';
import { orderManager } from './OrderManager';
import { walletBalanceService } from './WalletBalanceService';
import { positionRegistry } from './PositionRegistry';
import { tokenRegistry } from './TokenRegistry';
import { tradeHistoryRegistry } from './TradeHistoryRegistry';
import { useTradingEnvironmentStore } from '../store/tradingEnvironmentStore';
import { getSolPriceUsd } from '../utils/pnlCalculator';
import { resolveTokenDecimals } from './PaperTradeExecutor';

export interface ManagedPosition {
  mint: string;
  amount: number; // Raw token integer base units
  tokenDecimals: number;
  buyPrice: number; // Entry price in SOL per human token unit
  solSpent: number; // Cumulative cost basis in SOL
  tpPct: number;
  slPct: number;
  trailingSlPct?: number;
  maxHoldTimeMs?: number;
  slippageBpsTp?: number;
  slippageBpsSl?: number;
  currentPrice: number; // Current market price in SOL
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

  /**
   * Adds or accumulates an active trading position.
   * Handles weighted average cost basis for duplicate mints.
   * Accepts strictly raw integer token amounts and verified entry prices.
   */
  public addPosition(params: {
    mint: string;
    amount: number; // Raw integer units
    buyPrice?: number; // Price in SOL per human token unit
    solSpent: number; // Total SOL spent on this purchase
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
    const rawAmount = Math.floor(Math.max(0, params.amount || 0));
    const solSpent = Math.max(0, params.solSpent || 0);

    let decimals = params.tokenDecimals;
    if (decimals === undefined || typeof decimals !== 'number') {
      try {
        decimals = resolveTokenDecimals(params.mint);
      } catch {
        decimals = tokenRegistry.getToken(params.mint)?.decimals ?? 6;
      }
    }

    const tokenQty = rawAmount / (10 ** decimals);

    // Check if position already exists for this mint
    const existing = this.positions.get(params.mint);
    if (existing && existing.state !== 'CLOSED') {
      // Update risk parameters if specified
      if (params.tpPct !== undefined) existing.tpPct = params.tpPct;
      if (params.slPct !== undefined) existing.slPct = Math.abs(params.slPct);
      if (params.trailingSlPct !== undefined) existing.trailingSlPct = params.trailingSlPct;
      if (params.maxHoldTimeMs !== undefined) existing.maxHoldTimeMs = params.maxHoldTimeMs;
      if (params.slippageBpsTp !== undefined) existing.slippageBpsTp = params.slippageBpsTp;
      if (params.slippageBpsSl !== undefined) existing.slippageBpsSl = params.slippageBpsSl;

      // Weighted average cost basis accumulation
      if (rawAmount > 0 && solSpent > 0) {
        const prevTotalCost = existing.solSpent;
        const prevTotalRaw = existing.amount;
        const newTotalCost = prevTotalCost + solSpent;
        const newTotalRaw = prevTotalRaw + rawAmount;
        const newTotalQty = newTotalRaw / (10 ** existing.tokenDecimals);

        existing.amount = newTotalRaw;
        existing.solSpent = newTotalCost;
        if (newTotalQty > 0) {
          existing.buyPrice = newTotalCost / newTotalQty;
        }
      }

      if (existing.state === 'RECOVERY_REQUIRED') {
        existing.state = 'OPEN';
      }

      // Also sync accumulation to PositionRegistry
      const network = useTradingEnvironmentStore.getState().network || 'paper';
      const posRecord = positionRegistry.openPosition({
        mintAddress: params.mint,
        network,
        amountRaw: rawAmount,
        decimals: existing.tokenDecimals,
        entryPriceSOL: existing.buyPrice,
        solSpent,
        tpPct: existing.tpPct,
        slPct: existing.slPct,
        trailingSlPct: existing.trailingSlPct,
        maxHoldTimeMs: existing.maxHoldTimeMs,
        slippageBpsTp: existing.slippageBpsTp,
        slippageBpsSl: existing.slippageBpsSl,
        orderId: params.buyOrderId,
        buySignature: params.buySignature,
      });

      // Record BUY trade in TradeHistoryRegistry
      tradeHistoryRegistry.recordTrade({
        id: 'BUY_' + params.mint + '_' + Date.now(),
        orderId: params.buyOrderId,
        positionId: posRecord.id,
        mintAddress: params.mint,
        side: 'BUY',
        network,
        amountRaw: rawAmount,
        amountTokens: tokenQty,
        solAmount: solSpent,
        priceSOL: existing.buyPrice,
        signature: params.buySignature || '',
        timestamp: Date.now(),
        status: params.buySignature ? 'CONFIRMED' : 'PENDING',
      });

      console.log(`[RiskManager] Accumulated position for ${params.mint}: Total Raw=${existing.amount}, CostBasis=${existing.solSpent.toFixed(4)} SOL, AvgEntry=${existing.buyPrice.toFixed(8)} SOL`);
      return;
    }

    // Calculate verified entry price (Price per human token unit in SOL)
    let calculatedBuyPrice = params.buyPrice || 0;
    if (calculatedBuyPrice <= 0 && solSpent > 0 && tokenQty > 0) {
      calculatedBuyPrice = solSpent / tokenQty;
    }

    if (calculatedBuyPrice <= 0 || !Number.isFinite(calculatedBuyPrice)) {
      throw new Error(`INVALID_POSITION_ENTRY: Cannot open position for ${params.mint} without valid buyPrice or positive solSpent and amount.`);
    }

    const pos: ManagedPosition = {
      mint: params.mint,
      amount: rawAmount,
      tokenDecimals: decimals,
      buyPrice: calculatedBuyPrice,
      solSpent,
      tpPct: params.tpPct ?? this.config.tpPct,
      slPct: Math.abs(params.slPct ?? this.config.slPct),
      trailingSlPct: params.trailingSlPct ?? this.config.trailingSlPct,
      maxHoldTimeMs: params.maxHoldTimeMs ?? this.config.maxHoldTimeMs,
      slippageBpsTp: params.slippageBpsTp ?? this.config.slippageBpsTp ?? 250,
      slippageBpsSl: params.slippageBpsSl ?? this.config.slippageBpsSl ?? 1000,
      currentPrice: calculatedBuyPrice,
      peakPrice: calculatedBuyPrice,
      highestPnLPct: 0,
      state: params.buySignature ? 'OPEN' : 'PENDING_BUY',
      buySignature: params.buySignature,
      createdAt: Date.now(),
    };

    this.positions.set(params.mint, pos);
    
    // Sync to PositionRegistry and TokenRegistry
    const network = useTradingEnvironmentStore.getState().network || 'paper';
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

    // Record initial BUY trade in TradeHistoryRegistry (PENDING until confirmed or CONFIRMED if signature provided)
    tradeHistoryRegistry.recordTrade({
      id: 'BUY_' + params.mint + '_' + Date.now(),
      orderId: params.buyOrderId,
      positionId: posRecord.id,
      mintAddress: params.mint,
      side: 'BUY',
      network,
      amountRaw: pos.amount,
      amountTokens: tokenQty,
      solAmount: pos.solSpent,
      priceSOL: pos.buyPrice,
      signature: params.buySignature || '',
      timestamp: Date.now(),
      status: params.buySignature ? 'CONFIRMED' : 'PENDING',
    });

    if (this.isRunning && pos.state === 'OPEN') {
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

  public confirmBuy(
    mint: string,
    signature: string,
    slot?: number,
    actualAmountRaw?: number,
    actualSolSpent?: number
  ): void {
    const pos = this.positions.get(mint);
    if (!pos) return;

    pos.state = 'OPEN';
    pos.buySignature = signature;
    if (slot !== undefined) pos.buySlot = slot;

    // Update with real execution outcomes if available
    if (actualAmountRaw && actualAmountRaw > 0) {
      pos.amount = Math.floor(actualAmountRaw);
    }
    if (actualSolSpent && actualSolSpent > 0) {
      pos.solSpent = actualSolSpent;
    }
    const tokenQty = pos.amount / (10 ** pos.tokenDecimals);
    if (tokenQty > 0 && pos.solSpent > 0) {
      pos.buyPrice = pos.solSpent / tokenQty;
    }

    // Update pending trade in tradeHistoryRegistry
    tradeHistoryRegistry.updateTrade(signature, {
      status: 'CONFIRMED',
      signature,
      amountRaw: pos.amount,
      amountTokens: tokenQty,
      solAmount: pos.solSpent,
      priceSOL: pos.buyPrice,
    });
  }

  public removePosition(mint: string): void {
    this.positions.delete(mint);
    this.exitingMints.delete(mint);
  }

  public getPosition(mint: string): ManagedPosition | undefined {
    const p = this.positions.get(mint);
    return p ? { ...p } : undefined;
  }

  public getAllPositions(): ManagedPosition[] {
    return Array.from(this.positions.values()).map(p => ({ ...p }));
  }

  /**
   * Price update handler with currency verification and dynamic conversion.
   */
  public onPriceUpdate(
    mint: string,
    rawPrice: number,
    timestamp: number = Date.now(),
    quoteCurrency: 'SOL' | 'USD' = 'SOL'
  ): void {
    const pos = this.positions.get(mint);
    if (!pos || pos.state === 'CLOSED' || !rawPrice || !Number.isFinite(rawPrice) || rawPrice <= 0) return;

    let priceInSol = rawPrice;
    if (quoteCurrency === 'USD') {
      const solUsd = getSolPriceUsd() || 150;
      priceInSol = rawPrice / solUsd;
    }

    if (priceInSol <= 0 || !Number.isFinite(priceInSol)) return;

    pos.currentPrice = priceInSol;
    pos.lastPriceUpdate = timestamp;

    if (!pos.peakPrice || priceInSol > pos.peakPrice) {
      pos.peakPrice = priceInSol;
    }

    const pnlPct = this.calculatePnLPct(pos);
    if (pos.highestPnLPct === undefined || pnlPct > pos.highestPnLPct) {
      pos.highestPnLPct = pnlPct;
    }

    // Sync price to TokenRegistry & PositionRegistry
    tokenRegistry.updatePrice(mint, priceInSol);
    positionRegistry.updatePrice(mint, priceInSol);

    if (this.isRunning && (pos.state === 'OPEN' || pos.state === 'RECOVERY_REQUIRED')) {
      void this.evaluatePosition(pos);
    }
  }

  /**
   * Pure PnL percentage calculation without side-effects or mutating buyPrice.
   */
  public calculatePnLPct(pos: ManagedPosition): number {
    const effectiveBuyPrice = pos.buyPrice > 0
      ? pos.buyPrice
      : (pos.amount > 0 && pos.solSpent > 0
          ? pos.solSpent / (pos.amount / (10 ** pos.tokenDecimals))
          : 0);

    if (effectiveBuyPrice <= 0 || !pos.currentPrice || pos.currentPrice <= 0) return 0;

    return ((pos.currentPrice - effectiveBuyPrice) / effectiveBuyPrice) * 100;
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

    // 2. Trailing stop check (Active immediately whenever trailingSlPct is configured)
    const peakPnL = pos.highestPnLPct ?? 0;
    if (pos.trailingSlPct && pos.trailingSlPct > 0) {
      const trailingDrop = peakPnL - pnlPct;
      if (trailingDrop >= pos.trailingSlPct) {
        console.log(`[RiskManager] 📉 TRAILING STOP Triggered for ${mint}: Peak +${peakPnL.toFixed(1)}%, Current: ${pnlPct.toFixed(1)}%, Drop: ${trailingDrop.toFixed(1)}% (Threshold: ${pos.trailingSlPct}%)`);
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

  /**
   * Request manual or explicit exit. Rejects untracked positions without inventing fake cost basis.
   */
  public async requestExit(
    mint: string,
    reason: string = 'MANUAL_FORCE_EXIT',
    _fallbackAmount?: number,
    _fallbackSolSpent?: number
  ): Promise<void> {
    const pos = this.positions.get(mint);
    if (!pos) {
      console.warn(`[RiskManager] Rejected exit request for untracked position: ${mint}`);
      throw new Error(`UNTRACKED_POSITION_EXIT: Cannot exit position for ${mint}. No active position found in RiskManager.`);
    }

    if (pos.state === 'CLOSING' || pos.state === 'CLOSED') {
      return;
    }

    const pnlPct = this.calculatePnLPct(pos);
    const side: 'tp' | 'sl' = pnlPct >= 0 ? 'tp' : 'sl';
    console.log(`[RiskManager] 🚨 Explicit exit requested for ${mint} (${reason}) at estimated PnL: ${pnlPct.toFixed(2)}%`);
    await this.triggerExit(pos, side, pnlPct);
  }

  public async triggerExit(pos: ManagedPosition, side: 'tp' | 'sl', estimatedPnlPct: number): Promise<void> {
    const mint = pos.mint;
    if (this.exitingMints.has(mint) || pos.state === 'CLOSING' || pos.state === 'CLOSED') return;

    this.exitingMints.add(mint);
    pos.state = 'CLOSING';

    try {
      const slippageBps = side === 'tp' ? (pos.slippageBpsTp || 250) : (pos.slippageBpsSl || 1000);
      const label = side === 'tp' ? 'exit_tp' : 'exit_sl';

      // Always sync to true raw balance in integer base units
      if (typeof this.executor.getTokenBalance === 'function') {
        try {
          const liveTokens = await this.executor.getTokenBalance(mint);
          if (liveTokens > 0) {
            const rawLive = Math.floor(liveTokens * (10 ** pos.tokenDecimals));
            if (rawLive > 0) {
              pos.amount = rawLive;
            }
          }
        } catch {}
      }

      console.log(`[RiskManager] ⚡ Executing ${side.toUpperCase()} exit swap for ${mint} (Amount Raw: ${pos.amount})`);

      // Route execution through OrderManager & ExecutionEngine
      const result = await orderManager.executeOrder(
        mint,
        'So11111111111111111111111111111111111111112',
        pos.amount,
        slippageBps,
        label
      );

      // Compute actual net SOL received and actual realized PnL
      const netSolReceived = Math.max(0, (result.outputAmount / 1e9) - (result.feeSol || 0));
      const actualPnlSol = netSolReceived - (pos.solSpent || 0);
      const actualPnlPct = pos.solSpent > 0
        ? (actualPnlSol / pos.solSpent) * 100
        : (netSolReceived > 0 ? 100 : 0);

      // Record in PositionRegistry, TokenRegistry, and TradeHistoryRegistry
      positionRegistry.closePosition(mint, result.signature, actualPnlSol, actualPnlPct);
      tokenRegistry.setExecutionState(mint, 'CLOSED');

      tradeHistoryRegistry.recordTrade({
        id: `trade_${Date.now()}_${mint.slice(0, 6)}`,
        mintAddress: mint,
        side: 'SELL',
        network: useTradingEnvironmentStore.getState().network || 'paper',
        amountRaw: pos.amount,
        amountTokens: pos.amount / (10 ** pos.tokenDecimals),
        solAmount: netSolReceived,
        priceSOL: pos.currentPrice,
        pnlSol: actualPnlSol,
        pnlPct: actualPnlPct,
        signature: result.signature || 'exit-tx',
        timestamp: Date.now(),
        status: 'CONFIRMED',
      });

      await walletBalanceService.verifyTokenBalanceCleared(mint);

      // Successfully finished all operations - now close and remove position
      pos.state = 'CLOSED';
      this.positions.delete(mint);
      this.exitingMints.delete(mint);

      if (this.onExitCallback) {
        this.onExitCallback(mint, side, result.signature || 'exit-tx', actualPnlPct, netSolReceived);
      }
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      console.error(`[RiskManager] ❌ Exit error for ${mint}:`, err);
      
      // Rollback position state to OPEN so next evaluation tick or retry can execute safely
      this.exitingMints.delete(mint);
      pos.state = 'OPEN';

      const now = Date.now();
      const lastLogged = this.lastExitErrorTimes.get(mint) || 0;
      if (now - lastLogged >= 15000) {
        this.lastExitErrorTimes.set(mint, now);
        if (this.onExitErrorCallback) {
          this.onExitErrorCallback(mint, side, errMsg);
        }
      }
    }
  }

  /**
   * Returns a copy of active positions to protect internal Map from external mutation.
   */
  public getPositions(): Map<string, ManagedPosition> {
    return new Map(this.positions);
  }
}

export const riskManager = RiskManager.getInstance();
