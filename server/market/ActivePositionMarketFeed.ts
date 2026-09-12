// server/market/ActivePositionMarketFeed.ts
import { positionManager, Position } from '../trading/PositionManager.js';
import { positionValuationEngine } from '../trading/PositionValuationEngine.js';
import { unifiedExitEngine } from '../trading/UnifiedExitEngine.js';
import { tradingSupervisor } from '../trading/TradingSupervisor.js';
import { marketEventBus } from './MarketEventBus.js';
import { heliusLaserStreamWssManager } from './HeliusLaserStreamWssManager.js';
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

    // Find all open positions for this mint
    const openPositions = positionManager.getOpenPositions();
    const relevantPositions = openPositions.filter(p => p.mint === event.mint);

    if (relevantPositions.length === 0) return;

    // Ensure active position mint is subscribed to Helius WSS
    heliusLaserStreamWssManager.subscribeActivePositionMint(event.mint);

    // Use event price if available
    const marketPrice = event.priceSol;
    if (marketPrice && marketPrice > 0) {
      for (const position of relevantPositions) {
        positionValuationEngine.recordMarketPrice(
          position.network,
          position.wallet,
          position.mint,
          marketPrice,
          'WSS'
        );
        this.updatePositionAndEvaluate(position, marketPrice);
      }
    } else {
      // Event missing price: trigger market price resolution for active position mint
      this.fetchAndRecordPriceForPositionMint(event.mint, relevantPositions);
    }
  }

  /**
   * Helper to fetch market price for an active position mint from approved market data sources.
   */
  private async fetchAndRecordPriceForPositionMint(mint: string, positions: Position[]): Promise<void> {
    try {
      const { candidateEnricher } = await import('../trading/CandidateEnricher.js');
      const enriched = await candidateEnricher.enrichCandidate(mint, positions[0]?.network || 'mainnet');

      const priceSol = enriched?.priceSol?.value;
      if (priceSol && priceSol > 0 && Number.isFinite(priceSol)) {
        for (const position of positions) {
          positionValuationEngine.recordMarketPrice(
            position.network,
            position.wallet,
            position.mint,
            priceSol,
            'DEXSCREENER'
          );
          this.updatePositionAndEvaluate(position, priceSol);
        }
      }
    } catch {
      // Fail gracefully
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
   * Runs regardless of whether TradingSupervisor state is TRADING or PAUSED.
   */
  private async refreshAllValuations(): Promise<void> {
    if (!this.isRunning) return;

    const openPositions = positionManager.getOpenPositions();
    if (openPositions.length === 0) return;

    const { heliusLaserStreamWssManager } = await import('./HeliusLaserStreamWssManager.js');

    for (const position of openPositions) {
      try {
        // Register active position mint subscription
        heliusLaserStreamWssManager.subscribeActivePositionMint(position.mint);

        const valuation = positionValuationEngine.getValuation(position.network, position.wallet, position.mint);
        if (valuation && valuation.currentPriceSol && valuation.currentPriceSol > 0 && valuation.status !== 'UNAVAILABLE') {
          this.updatePositionAndEvaluate(position, valuation.currentPriceSol);
        } else {
          // Valuation missing or unavailable: trigger fresh market data lookup
          this.fetchAndRecordPriceForPositionMint(position.mint, [position]);
        }
      } catch {
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
