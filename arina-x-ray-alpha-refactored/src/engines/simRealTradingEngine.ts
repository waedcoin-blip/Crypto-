/**
 * SimRealTradingEngine
 * ────────────────────
 * Independent real-money trading engine exclusively owned by SimRealPage.
 * PnLPage is a paper-trading scanner that emits +1% profit signals via an event bus.
 * This engine subscribes to those signals and executes real on-chain buys/sells.
 *
 * Separation of concerns:
 * - PnLPage: token discovery → filtering → paper-trading simulation → emit signals
 * - SimRealTradingEngine: signal reception → position tracking → real execution → settlement
 *
 * This eliminates the coupling that made triplicated monitor/exit logic hard to maintain.
 */

import { executeJupiterSwap, SOL_MINT } from '../services/jupiterService';

export interface SimRealPosition {
  mint: string;
  symbol: string;
  boughtAt: number; // timestamp
  boughtPrice: number; // SOL per token (estimated, for display)
  tokenAmount: number; // estimated human-readable amount, for DISPLAY ONLY — never used to build swap instructions
  amountRaw: string; // exact raw on-chain unit count from the buy quote — this is what gets sold, no decimals math needed
  solSpent: number;
  // Real metadata
  txid?: string;
  status: 'pending' | 'filled' | 'error';
  errorMsg?: string;
}

export interface SimRealTradingConfig {
  privateKey: string;
  apiKey: string;
  rpcUrl: string;
  defaultSlippagePct: number;
  initialBalance: number;
  stopLoss: number; // negative percent, e.g. -20 means exit at -20%
  takeProfit: number; // positive percent, e.g. 25 means exit at +25%
  /** Live token metrics keyed by mint, refreshed by the caller (e.g. { [mint]: { priceNative } }) */
  getTokenMetrics?: () => Record<string, any>;
  onBuySignal?: (signal: { mint: string; symbol: string; entryPrice: number }) => void;
  onPositionUpdate?: (position: SimRealPosition) => void;
  onBalanceUpdate?: (balance: number) => void;
  onTradeComplete?: (trade: { mint: string; symbol: string; pnlPct: number; solReceived: number; txid: string; timestamp: number }) => void;
  onError?: (error: Error) => void;
}

export class SimRealTradingEngine {
  private config: SimRealTradingConfig;
  private balance: number;
  private positions: Map<string, SimRealPosition> = new Map();
  private pendingSignals: Map<string, boolean> = new Map();
  private exitMonitorInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: SimRealTradingConfig) {
    this.config = config;
    this.balance = config.initialBalance;
  }

  /**
   * Start the trading engine: spawn exit-monitoring loop
   */
  start() {
    if (this.exitMonitorInterval) return; // already running
    this.exitMonitorInterval = setInterval(() => this.monitorExits(), 4000);
    console.log('[SimRealEngine] Started with balance:', this.balance.toFixed(4), 'SOL');
  }

  /**
   * Stop the trading engine
   */
  stop() {
    if (this.exitMonitorInterval) {
      clearInterval(this.exitMonitorInterval);
      this.exitMonitorInterval = null;
    }
    console.log('[SimRealEngine] Stopped');
  }

  /**
   * Process a buy signal from PnLPage (+1% paper-trade profit detected)
   * Queue the signal; actual execution happens asynchronously
   */
  async enqueueBuySignal(mint: string, symbol: string, entryPrice: number, buyAmountSol: number = 0.1) {
    if (this.pendingSignals.has(mint)) {
      console.log(`[SimRealEngine] Buy signal for ${symbol} already pending, skipping duplicate`);
      return;
    }

    if (this.balance < buyAmountSol) {
      console.warn(`[SimRealEngine] Insufficient balance for ${symbol}: ${this.balance.toFixed(4)} < ${buyAmountSol.toFixed(4)}`);
      this.config.onError?.(new Error(`Insufficient SimReal balance for ${symbol}`));
      return;
    }

    this.pendingSignals.set(mint, true);
    console.log(`[SimRealEngine] Queued buy signal: ${symbol} @ ${entryPrice} SOL, amount: ${buyAmountSol} SOL`);

    // Fire callback for UI
    this.config.onBuySignal?.({ mint, symbol, entryPrice });

    // Execute asynchronously so it doesn't block the monitor loop
    // setImmediate doesn't exist in browsers — use setTimeout(fn, 0) to defer
    // execution to the next tick without blocking the caller.
    setTimeout(() => this.executeBuy(mint, symbol, entryPrice, buyAmountSol), 0);
  }

  /**
   * Execute a real on-chain buy via Jupiter
   */
  private async executeBuy(mint: string, symbol: string, entryPrice: number, buyAmountSol: number) {
    try {
      if (!this.config.privateKey) {
        throw new Error('Private key not configured');
      }

      const swapConfig = {
        privateKey: this.config.privateKey,
        apiKey: this.config.apiKey,
        rpcUrl: this.config.rpcUrl,
        defaultSlippagePct: this.config.defaultSlippagePct
      };

      const amountLamports = Math.floor(buyAmountSol * 1_000_000_000);
      console.log(`[SimRealEngine] Executing buy: ${symbol} | ${buyAmountSol} SOL → ${amountLamports} lamports`);

      const result = await executeJupiterSwap(swapConfig, SOL_MINT, mint, amountLamports);

      // IMPORTANT: result.outputAmount / result.quoteOutAmountRaw are RAW on-chain
      // units (Jupiter's outAmount string), NOT human-decimal-adjusted tokens.
      // We store the raw amount as-is (that's what a sell needs, no decimals lookup
      // required) and only derive a rough human-readable estimate for display.
      const amountRaw = result.quoteOutAmountRaw || String(result.outputAmount || 0);
      const estimatedTokenAmount = entryPrice > 0 ? (buyAmountSol / entryPrice) : 0;

      // Deduct from balance and track position
      this.balance -= buyAmountSol;

      const position: SimRealPosition = {
        mint,
        symbol,
        boughtAt: Date.now(),
        boughtPrice: entryPrice,
        tokenAmount: estimatedTokenAmount,
        amountRaw,
        solSpent: buyAmountSol,
        txid: result.txid,
        status: 'filled'
      };

      this.positions.set(mint, position);

      console.log(`✅ [SimRealEngine] Buy filled: ${symbol} | ~${estimatedTokenAmount.toFixed(2)} tokens @ ${entryPrice} SOL | tx: ${result.txid.slice(0, 12)}`);
      this.config.onPositionUpdate?.(position);
      this.config.onBalanceUpdate?.(this.balance);
    } catch (err: any) {
      console.error(`❌ [SimRealEngine] Buy failed for ${symbol}:`, err.message);
      this.config.onError?.(err);
    } finally {
      this.pendingSignals.delete(mint);
    }
  }

  /**
   * Execute a real on-chain sell via Jupiter
   */
  private async executeSell(mint: string, reason: string = 'manual') {
    const position = this.positions.get(mint);
    if (!position) {
      console.warn(`[SimRealEngine] No position to sell for ${mint}`);
      return;
    }

    try {
      if (!this.config.privateKey) {
        throw new Error('Private key not configured');
      }

      const swapConfig = {
        privateKey: this.config.privateKey,
        apiKey: this.config.apiKey,
        rpcUrl: this.config.rpcUrl,
        defaultSlippagePct: this.config.defaultSlippagePct
      };

      const amountToSellRaw = Math.floor(Number(position.amountRaw));
      if (!amountToSellRaw || amountToSellRaw <= 0) {
        throw new Error(`Invalid raw amount stored for ${position.symbol} — cannot build sell instruction`);
      }
      console.log(`[SimRealEngine] Executing sell: ${position.symbol} | raw units: ${amountToSellRaw} | reason: ${reason}`);

      const result = await executeJupiterSwap(swapConfig, mint, SOL_MINT, amountToSellRaw);

      // result.outputAmount here is raw lamports (SOL has 9 decimals) — convert to SOL.
      const sellReceivedSol = (result.outputAmount || 0) / 1_000_000_000;
      const pnl = sellReceivedSol - position.solSpent;
      const pnlPct = (pnl / position.solSpent) * 100;

      // Update balance
      this.balance += sellReceivedSol;

      console.log(`✅ [SimRealEngine] Sell filled: ${position.symbol} | ${sellReceivedSol.toFixed(4)} SOL | P&L: ${pnlPct.toFixed(2)}% | tx: ${result.txid.slice(0, 12)}`);

      this.config.onTradeComplete?.({
        mint,
        symbol: position.symbol,
        pnlPct,
        solReceived: sellReceivedSol,
        txid: result.txid,
        timestamp: Date.now()
      });
      this.config.onBalanceUpdate?.(this.balance);

      // Remove from tracking
      this.positions.delete(mint);
    } catch (err: any) {
      console.error(`❌ [SimRealEngine] Sell failed for ${position.symbol}:`, err.message);
      this.config.onError?.(err);
    }
  }

  /**
   * Periodically check all positions for exit conditions (stop-loss / take-profit).
   * Uses live prices supplied by the caller via config.getTokenMetrics — SimRealPage
   * already polls prices for display, so we reuse that instead of a second poller.
   */
  private async monitorExits() {
    if (this.positions.size === 0) return;
    const metrics = this.config.getTokenMetrics?.() || {};

    for (const [mint, position] of this.positions.entries()) {
      if (this.pendingSignals.has(mint)) continue; // a buy/sell for this mint is already in flight

      const metric = metrics[mint];
      const currentPrice: number | undefined = metric?.priceNative ?? metric?.price;
      if (!currentPrice || currentPrice <= 0) continue;

      const currentValueSol = currentPrice * position.tokenAmount;
      const pnlPct = ((currentValueSol - position.solSpent) / position.solSpent) * 100;

      if (pnlPct <= this.config.stopLoss) {
        console.log(`[SimRealEngine] ${position.symbol} hit stop-loss (${pnlPct.toFixed(2)}%) — exiting`);
        this.pendingSignals.set(mint, true);
        this.executeSell(mint, `stop-loss@${pnlPct.toFixed(1)}%`).finally(() => this.pendingSignals.delete(mint));
        continue;
      }

      if (pnlPct >= this.config.takeProfit) {
        console.log(`[SimRealEngine] ${position.symbol} hit take-profit (${pnlPct.toFixed(2)}%) — exiting`);
        this.pendingSignals.set(mint, true);
        this.executeSell(mint, `take-profit@${pnlPct.toFixed(1)}%`).finally(() => this.pendingSignals.delete(mint));
      }
    }
  }

  /**
   * Manual sell trigger (e.g., from UI button)
   */
  async manualSell(mint: string) {
    if (this.pendingSignals.has(mint)) {
      console.warn(`[SimRealEngine] Sell already in flight for ${mint}, skipping duplicate`);
      return;
    }
    this.pendingSignals.set(mint, true);
    try {
      await this.executeSell(mint, 'manual');
    } finally {
      this.pendingSignals.delete(mint);
    }
  }

  /**
   * Get current balance
   */
  getBalance(): number {
    return this.balance;
  }

  /**
   * Get all positions
   */
  getPositions(): SimRealPosition[] {
    return Array.from(this.positions.values());
  }

  /**
   * Check if a position exists
   */
  hasPosition(mint: string): boolean {
    return this.positions.has(mint);
  }
}

export const createSimRealTradingEngine = (config: SimRealTradingConfig) => {
  return new SimRealTradingEngine(config);
};
