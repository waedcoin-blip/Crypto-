// src/services/ExitManager.ts
import { ExitConfig, ManagedExitPosition, TokenStage, ExitReason } from './exit-manager.types';

export class ExitManager {
  private config: ExitConfig;
  private positions = new Map<string, ManagedExitPosition>();
  private exitingMints = new Set<string>();
  private exitTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private detectStage: (mint: string, pos: ManagedExitPosition) => TokenStage,
    private onExecuteSell: (mint: string, symbol: string, reason: ExitReason, pnlPct: number) => Promise<void>,
    initialConfig: Partial<ExitConfig> = {}
  ) {
    this.config = {
      minTakeProfit: 25,
      maxTakeProfit: 100,
      bondingCurveTakeProfit: 15,
      stopLossPct: 15,
      bondingCurveStopLossPct: 10,
      pumpSwapStopLossPct: 15,
      unknownStopLossPct: 20,
      moonbagStrategy: false,
      moonbagSellPct: 0.5,
      trailingStopEnabled: false,
      trailingStopDistance: 10,
      maxHoldTimeMs: 0,
      slippageBps: 100,
      stalePriceThresholdMs: 5000,
      ...initialConfig,
    };
  }

  /** React calls this whenever settings change. No per-position updates. */
  updateGlobalConfig(partial: Partial<ExitConfig>) {
    this.config = { ...this.config, ...partial };
  }

  /** Idempotent sync from your positionsRef. Call whenever position data updates. */
  syncPosition(pos: ManagedExitPosition) {
    const existing = this.positions.get(pos.mint);
    if (existing) {
      // Preserve runtime tracking fields so highest PnL isn't lost on re-sync
      const highestPnlPct = Math.max(existing.highestPnlPct, pos.highestPnlPct || 0);
      this.positions.set(pos.mint, { ...pos, highestPnlPct });
    } else {
      this.positions.set(pos.mint, { ...pos, highestPnlPct: pos.highestPnlPct || 0 });
    }
  }

  removePosition(mint: string) {
    this.positions.delete(mint);
    this.exitingMints.delete(mint);
    const t = this.exitTimeouts.get(mint);
    if (t) clearTimeout(t);
    this.exitTimeouts.delete(mint);
  }

  getPosition(mint: string): ManagedExitPosition | undefined {
    return this.positions.get(mint);
  }

  getActiveMints(): string[] {
    return Array.from(this.positions.keys());
  }

  /** Direct price feed push (e.g. from RPC websocket / marketDataManager) */
  onPriceUpdate(mint: string, priceSol: number, timestamp = Date.now()): void {
    const pos = this.positions.get(mint);
    if (!pos) return;
    pos.lastPriceSol = priceSol;
    pos.lastPriceTimestamp = timestamp;
    this.evaluatePosition(mint).catch((err) =>
      console.error(`[ExitManager] onPriceUpdate eval error for ${mint}:`, err)
    );
  }

  /** Evaluate all open positions in parallel. Safe — one failure doesn't kill the batch. */
  async evaluateAll(): Promise<void> {
    await Promise.all(
      Array.from(this.positions.keys()).map((mint) =>
        this.evaluatePosition(mint).catch((err) =>
          console.error(`[ExitManager] Batch eval error for ${mint}:`, err)
        )
      )
    );
  }

  async evaluatePosition(mint: string): Promise<void> {
    const pos = this.positions.get(mint);
    if (!pos || pos.state !== 'OPEN' || this.exitingMints.has(mint)) return;

    const now = Date.now();
    const staleMs = this.config.stalePriceThresholdMs;

    if (!pos.lastPriceTimestamp || now - pos.lastPriceTimestamp > staleMs) {
      // Stale price — skip silently or add a metric here
      return;
    }

    const pnlPct = this.calculateNetPnLPct(pos);

    // Update peak for trailing stop
    if (pnlPct > pos.highestPnlPct) {
      pos.highestPnlPct = pnlPct;
    }

    const stage = this.detectStage(mint, pos);
    const thresholds = this.getThresholds(pos, stage);
    const decision = this.evaluateTriggers(pos, pnlPct, thresholds, now);

    if (decision.shouldExit) {
      await this.executeExit(pos, decision.reason, pnlPct, thresholds, decision.isPartial);
    }
  }

  /** Manual override — e.g. panic button in UI */
  async forceExit(mint: string, reason: ExitReason = 'MANUAL'): Promise<void> {
    const pos = this.positions.get(mint);
    if (!pos) return;
    const pnlPct = this.calculateNetPnLPct(pos);
    await this.executeExit(pos, reason, pnlPct, { tpPct: 0, slPct: 0 }, false);
  }

  // ─────────────────────────────────────────────
  // Private
  // ─────────────────────────────────────────────

  private calculateNetPnLPct(pos: ManagedExitPosition): number {
    if (!pos.lastPriceSol || pos.realCostBasis <= 0 || pos.amount <= 0) return 0;

    const grossValue = pos.lastPriceSol * pos.amount;
    const slippageFactor = 1 - this.config.slippageBps / 10000;
    const netValue = grossValue * slippageFactor;
    const netPnl = netValue - pos.realCostBasis;

    return (netPnl / pos.realCostBasis) * 100;
  }

  private getThresholds(pos: ManagedExitPosition, stage: TokenStage) {
    const cfg = this.config;

    // ── Take Profit ──
    let tpPct: number;
    if (stage.isBonding || stage.platform === 'PUMP_FUN') {
      tpPct = cfg.bondingCurveTakeProfit ?? cfg.minTakeProfit;
    } else if (cfg.moonbagStrategy && pos.soldPartial) {
      tpPct = cfg.maxTakeProfit ?? cfg.minTakeProfit;
    } else {
      tpPct = cfg.minTakeProfit;
    }

    // ── Stop Loss ──
    let slPct: number;
    if (stage.isBonding || stage.platform === 'PUMP_FUN') {
      slPct = cfg.bondingCurveStopLossPct ?? cfg.stopLossPct;
    } else if (stage.platform === 'PUMPSWAP') {
      slPct = cfg.pumpSwapStopLossPct ?? cfg.stopLossPct;
    } else if (stage.platform === 'UNKNOWN') {
      slPct = cfg.unknownStopLossPct ?? cfg.stopLossPct;
    } else {
      slPct = cfg.stopLossPct;
    }

    // Recovery mode override (e.g. disable or tighten SL)
    if (pos.recoveryMode && cfg.recoveryModeSlOverride !== undefined) {
      slPct = cfg.recoveryModeSlOverride;
    }

    return { tpPct, slPct: -Math.abs(slPct) };
  }

  private evaluateTriggers(
    pos: ManagedExitPosition,
    pnlPct: number,
    thresholds: { tpPct: number; slPct: number },
    now: number
  ): { shouldExit: boolean; reason: ExitReason; isPartial: boolean; detail: string } {
    const cfg = this.config;

    // 1️⃣ Take Profit
    if (pnlPct >= thresholds.tpPct) {
      const isPartial = cfg.moonbagStrategy && !pos.soldPartial;
      return {
        shouldExit: true,
        reason: 'TAKE_PROFIT',
        isPartial,
        detail: `PnL ${pnlPct.toFixed(2)}% >= TP ${thresholds.tpPct}%`,
      };
    }

    // 2️⃣ Trailing Stop (only after position was in profit)
    if (cfg.trailingStopEnabled && pos.highestPnlPct > 0) {
      const drawdown = pos.highestPnlPct - pnlPct;
      if (drawdown >= cfg.trailingStopDistance) {
        return {
          shouldExit: true,
          reason: 'TRAILING_STOP',
          isPartial: false,
          detail: `Drawdown ${drawdown.toFixed(2)}% from peak ${pos.highestPnlPct.toFixed(2)}%`,
        };
      }
    }

    // 3️⃣ Hard Stop Loss
    if (pnlPct <= thresholds.slPct) {
      return {
        shouldExit: true,
        reason: 'STOP_LOSS',
        isPartial: false,
        detail: `PnL ${pnlPct.toFixed(2)}% <= SL ${thresholds.slPct}%`,
      };
    }

    // 4️⃣ Max Hold Time
    if (cfg.maxHoldTimeMs > 0 && now - pos.entryTime > cfg.maxHoldTimeMs) {
      return {
        shouldExit: true,
        reason: 'MAX_HOLD_TIME',
        isPartial: false,
        detail: `Held ${((now - pos.entryTime) / 1000).toFixed(0)}s > max ${(cfg.maxHoldTimeMs / 1000).toFixed(0)}s`,
      };
    }

    return { shouldExit: false, reason: 'STOP_LOSS', isPartial: false, detail: '' };
  }

  private async executeExit(
    pos: ManagedExitPosition,
    reason: ExitReason,
    pnlPct: number,
    thresholds: { tpPct: number; slPct: number },
    isPartial: boolean
  ): Promise<void> {
    if (this.exitingMints.has(pos.mint)) return;
    this.exitingMints.add(pos.mint);

    // Safety: auto-release lock after 30s so a hung sell doesn't brick the position forever
    const lockTimeout = setTimeout(() => {
      console.warn(`[ExitManager] Force-releasing exit lock for ${pos.mint} after timeout`);
      this.exitingMints.delete(pos.mint);
    }, 30000);
    this.exitTimeouts.set(pos.mint, lockTimeout);

    try {
      if (isPartial) {
        // 🌗 Moonbag: sell partial, stay in position for TP2
        console.log(
          `[ExitManager] 🎯 TP1 Moonbag ${pos.symbol}: ${pnlPct.toFixed(2)}% — selling ${(this.config.moonbagSellPct * 100).toFixed(0)}%`
        );
        await this.onExecuteSell(pos.mint, pos.symbol, reason, pnlPct);
        pos.soldPartial = true;
        pos.highestPnlPct = pnlPct; // Reset peak for next leg
      } else {
        // 🎯 Full exit
        const emoji = reason === 'TAKE_PROFIT' ? '🎯' : reason === 'TRAILING_STOP' ? '📉' : reason === 'MAX_HOLD_TIME' ? '⏰' : '🛑';
        console.log(`[ExitManager] ${emoji} ${reason} ${pos.symbol}: ${pnlPct.toFixed(2)}% | thresholds ${thresholds.tpPct}% / ${thresholds.slPct}%`);
        await this.onExecuteSell(pos.mint, pos.symbol, reason, pnlPct);
        pos.state = 'CLOSING'; // Downstream marks CLOSED after tx confirms
      }
    } catch (err) {
      console.error(`[ExitManager] Exit execution failed for ${pos.mint}:`, err);
    } finally {
      clearTimeout(lockTimeout);
      this.exitTimeouts.delete(pos.mint);
      // Only release lock if we're not waiting for chain confirmation
      if (pos.state !== 'CLOSING') {
        this.exitingMints.delete(pos.mint);
      }
    }
  }
}
