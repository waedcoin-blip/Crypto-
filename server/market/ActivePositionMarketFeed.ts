// server/market/ActivePositionMarketFeed.ts
import { positionManager, Position } from '../trading/PositionManager.js';
import { positionValuationEngine } from '../trading/PositionValuationEngine.js';
import { unifiedExitEngine } from '../trading/UnifiedExitEngine.js';
import { tradingSupervisor } from '../trading/TradingSupervisor.js';
import { marketEventBus } from './MarketEventBus.js';
import { UnifiedMarketEvent } from '../types/index.js';

/**
 * Active Position Market Feed:
 * Owns market-event ingestion for OPEN positions.
 * Drives price updates, PnL recalculation, and exit evaluations.
 *
 * This is the SINGLE authoritative component responsible for
 * monitoring open positions and triggering TP/SL/Trailing exits.
 */
export class ActivePositionMarketFeed {
  private static instance: ActivePositionMarketFeed;
  private isRunning: boolean = false;
  private unsubscribeBus: (() => void) | null = null;
  private valuationTimer: NodeJS.Timeout | null = null;
  private readonly VALUATION_REFRESH_MS = 3000; // Refresh valuations every 3s

  private constructor() {}

  public static getInstance(): ActivePositionMarketFeed {
    if (!ActivePositionMarketFeed.instance) {
      ActivePositionMarketFeed.instance = new ActivePositionMarketFeed();
    }
    return ActivePositionMarketFeed.instance;
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // 1. Subscribe to market events for price updates
    this.unsubscribeBus = marketEventBus.subscribe((event: UnifiedMarketEvent) => {
      this.handleMarketEvent(event);
    });

    // 2. Start periodic valuation refresh for positions without live events
    this.valuationTimer = setInterval(() => this.refreshAllValuations(), this.VALUATION_REFRESH_MS);
    if (this.valuationTimer.unref) this.valuationTimer.unref();

    console.log('[ActivePositionMarketFeed] Started. Monitoring open positions for exit signals.');
  }

  public stop(): void {
    this.isRunning = false;
    if (this.unsubscribeBus) {
      this.unsubscribeBus();
      this.unsubscribeBus = null;
    }
    if (this.valuationTimer) {
      clearInterval(this.valuationTimer);
      this.valuationTimer = null;
    }
    console.log('[ActivePositionMarketFeed] Stopped.');
  }

  /**
   * Handle incoming market event: update position prices if relevant.
   */
  private handleMarketEvent(event: UnifiedMarketEvent): void {
    if (!this.isRunning || !event.mint) return;

    const supervisorStatus = tradingSupervisor.getStatus();
    if (supervisorStatus.state !== 'TRADING') return;

    // Find all open positions for this mint
    const openPositions = positionManager.getOpenPositions();
    const relevantPositions = openPositions.filter(p => p.mint === event.mint);

    if (relevantPositions.length === 0) return;

    // Use event price if available
    const marketPrice = event.priceSol;
    if (marketPrice && marketPrice > 0) {
      for (const position of relevantPositions) {
        this.updatePositionAndEvaluate(position, marketPrice);
      }
    }
  }

  /**
   * Update position price and evaluate exit conditions.
   */
  private updatePositionAndEvaluate(position: Position, marketPriceSol: number): void {
    try {
      // Update position with new price
      positionManager.updatePositionPrice(
        position.network,
        position.wallet,
        position.mint,
        marketPriceSol,
        { isMarketEvent: true, timestamp: Date.now() }
      );

      // Evaluate exit conditions (TP/SL/Trailing/MaxHold)
      const exitDecision = unifiedExitEngine.evaluatePositionExit(position, marketPriceSol);
      if (exitDecision.shouldExit) {
        console.log(`[ActivePositionMarketFeed] EXIT TRIGGERED: mint=${position.mint} reason=${exitDecision.reason} pnl=${exitDecision.currentPnlPct.toFixed(2)}%`);
        unifiedExitEngine.evaluateAndExecuteExit(position, marketPriceSol).catch(err => {
          console.error(`[ActivePositionMarketFeed] Exit execution error for ${position.mint}:`, err);
        });
      }
    } catch (err: any) {
      console.error(`[ActivePositionMarketFeed] Error processing position ${position.mint}:`, err);
    }
  }

  /**
   * Periodic refresh: Fetch latest valuations for all open positions.
   * This ensures positions get price updates even without live market events.
   */
  private refreshAllValuations(): void {
    if (!this.isRunning) return;

    const supervisorStatus = tradingSupervisor.getStatus();
    if (supervisorStatus.state !== 'TRADING') return;

    const openPositions = positionManager.getOpenPositions();
    if (openPositions.length === 0) return;

    for (const position of openPositions) {
      try {
        const valuation = positionValuationEngine.getValuation(position.network, position.wallet, position.mint);
        if (valuation && valuation.currentPriceSol > 0) {
          this.updatePositionAndEvaluate(position, valuation.currentPriceSol);
        }
      } catch (err: any) {
        // Silently skip individual position errors
      }
    }
  }

  public getTelemetry() {
    return {
      isRunning: this.isRunning,
      valuationRefreshMs: this.VALUATION_REFRESH_MS,
    };
  }
}

export const activePositionMarketFeed = ActivePositionMarketFeed.getInstance();
