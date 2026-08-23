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
  lastPriceTimestamp?: number;
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
  private processedExitsSet: Set<string> = new Set();
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
    this.loadProcessedExits();
  }

  private loadProcessedExits(): void {
    try {
      const saved = localStorage.getItem('juipter_auto_processed_exits');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          this.processedExitsSet = new Set(parsed);
        }
      }
    } catch (e) {
      this.processedExitsSet = new Set();
    }
  }

  private saveProcessedExit(exitKey: string): void {
    this.processedExitsSet.add(exitKey);
    try {
      const arr = Array.from(this.processedExitsSet).slice(-200); // retain last 200 exits
      localStorage.setItem('juipter_auto_processed_exits', JSON.stringify(arr));
    } catch (e) {}
  }

  public setExecutor(executor: ITradeExecutor): void {
    this.executor = executor;
  }

  public reset(): void {
    this.stop();
    this.positions.clear();
    this.exitingMints.clear();
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
      // ONLY update existing position's TP/SL if provided
      // Do NOT overwrite immutable authoritative entry parameters (amount, buyPrice, solSpent) from React UI state sync
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

  public onPriceUpdate(mint: string, currentPrice: number, timestamp: number): void {
    const pos = this.positions.get(mint);
    if (!pos || pos.state === 'CLOSED') return;

    if (pos.lastPriceTimestamp && timestamp < pos.lastPriceTimestamp) {
      return;
    }

    pos.lastPriceTimestamp = timestamp;
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
    const exitKey = pos.buySignature ? `${mint}_${pos.buySignature}` : mint;

    if (this.exitingMints.has(mint) || this.processedExitsSet.has(exitKey)) {
      console.warn(`[ExitManager] ⚠️ Mint ${mint} (key: ${exitKey}) is already exiting or permanently closed. Skipping.`);
      return;
    }

    this.exitingMints.add(mint);
    pos.state = 'CLOSING';

    try {
      const slippageBps = side === 'tp' ? (pos.slippageBpsTp || 250) : (pos.slippageBpsSl || 1000);
      const label = side === 'tp' ? 'exit_tp' : 'exit_sl';

      // Query actual live token balance from executor if available
      if (typeof this.executor.getTokenBalance === 'function') {
        const liveAmount = await this.executor.getTokenBalance(mint);
        if (liveAmount <= 0) {
          throw new Error(`No spendable on-chain balance remains for ${mint}`);
        }
        pos.amount = liveAmount;
      }

      // Step 1: Obtain fresh executable Jupiter quote to verify net output SOL
      try {
        const quote = await this.executor.getQuote({
          inputMint: mint,
          outputMint: 'So11111111111111111111111111111111111111112',
          amount: pos.amount,
          slippageBps,
        });

        if (quote && quote.outAmount) {
          const expectedOutLamports = Number(quote.outAmount);
          const estimatedFeeSol = 0.0001; // Fee / priority allocation
          const executableNetOutSol = (expectedOutLamports / 1e9) - estimatedFeeSol;
          
          if (side === 'tp' && pos.solSpent > 0 && executableNetOutSol <= pos.solSpent) {
            console.warn(`[ExitManager] 🛑 TP Aborted for ${mint}: Executable quote net output (${executableNetOutSol.toFixed(4)} SOL) is less than cost basis (${pos.solSpent.toFixed(4)} SOL) due to liquidity or slippage. Re-evaluating on next cycle.`);
            pos.state = 'OPEN';
            this.exitingMints.delete(mint);
            return;
          }
        }
      } catch (quoteErr) {
        console.warn(`[ExitManager] Unable to pre-verify executable quote for ${mint}, proceeding with execution guard:`, quoteErr);
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
      this.saveProcessedExit(exitKey);

      // Instantly refresh on-chain wallet balance after exit execution
      walletBalanceService.refreshNow();

      if (this.onExitCallback) {
        const actualReceivedSol = (result.outputAmount / 1e9) - result.feeSol;
        this.onExitCallback(mint, side, result.signature || 'exit-tx', pnlPct, actualReceivedSol);
      }
    } catch (err: any) {
      console.error(`[ExitManager] ❌ Exit error for ${mint}:`, err);
      let hasTokens: boolean;
      try {
        hasTokens = await this.executor.hasTokenAccount(mint);
      } catch (balanceErr) {
        // Unknown state is NOT success. Keep the position recoverable and
        // require another verification rather than reopening/closing blindly.
        console.error(`[ExitManager] Could not verify post-failure token balance for ${mint}:`, balanceErr);
        pos.state = 'OPEN';
        this.exitingMints.delete(mint);
        return;
      }
      if (!hasTokens) {
        console.log(`[ExitManager] Token balance empty on-chain for ${mint}, marking as CLOSED.`);
        pos.state = 'CLOSED';
        this.exitingMints.delete(mint);
        this.positions.delete(mint);
        this.saveProcessedExit(exitKey);

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
