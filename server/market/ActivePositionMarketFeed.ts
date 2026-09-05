// server/market/ActivePositionMarketFeed.ts
import { marketEventBus } from './MarketEventBus.js';
import { MarketEvent } from './EventNormalizer.js';
import { positionManager, Position } from '../trading/PositionManager.js';
import { bondingCurveFastLane } from '../trading/BondingCurveFastLane.js';
import { unifiedExitEngine } from '../trading/UnifiedExitEngine.js';
import { executionGateway } from '../execution/ExecutionGateway.js';
import { positionValuationEngine } from '../trading/PositionValuationEngine.js';

export class ActivePositionMarketFeed {
  private static instance: ActivePositionMarketFeed;
  private isRunning: boolean = false;
  private activeSubscriptions: Set<string> = new Set(); // Mints of open positions
  private pollIntervalTimer?: NodeJS.Timeout;
  private lastPriceQueryTime: Map<string, number> = new Map();

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

    // 1. Subscribe to real-time market event bus
    marketEventBus.subscribe((event) => this.handleMarketEvent(event));

    // 2. Start high-frequency active position monitor (every 500ms)
    this.pollIntervalTimer = setInterval(() => this.pollActivePositions(), 500);

    console.log('[ActivePositionMarketFeed] Priority P1 Active Position Market Feed started.');
  }

  public stop(): void {
    this.isRunning = false;
    if (this.pollIntervalTimer) {
      clearInterval(this.pollIntervalTimer);
    }
  }

  /**
   * Evaluates incoming real-time on-chain WSS market events.
   * Priority P1: Matches events directly to active open positions bypassing discovery filters.
   */
  private async handleMarketEvent(event: MarketEvent): Promise<void> {
    const openPositions = positionManager.getOpenPositions();
    if (openPositions.length === 0) return;

    const activeMap = new Map<string, Position>();
    for (const pos of openPositions) {
      activeMap.set(pos.mint, pos);
      if (pos.mint) activeMap.set(pos.mint.toLowerCase(), pos);
    }

    const mint = event.mint;
    const now = Date.now();
    const eventTime = event.timestamp || now;
    const candidatePrice = event.price || 0;

    // Check direct mint or account keys
    const matchedPositions: Position[] = [];

    if (mint && activeMap.has(mint)) {
      matchedPositions.push(activeMap.get(mint)!);
    }

    if (event.accountKeys && event.accountKeys.length > 0) {
      for (const key of event.accountKeys) {
        if (activeMap.has(key)) {
          const pos = activeMap.get(key)!;
          if (!matchedPositions.includes(pos)) {
            matchedPositions.push(pos);
          }
        }
      }
    }

    if (matchedPositions.length === 0) {
      if (mint) {
        console.log(`[ACTIVE_POSITION_MARKET_EVENT_UNMATCHED] mint=${mint} price=${candidatePrice} timestamp=${eventTime}`);
      }
      return;
    }

    for (const pos of matchedPositions) {
      console.log(`[ACTIVE_POSITION_MARKET_EVENT] mint=${pos.mint} price=${candidatePrice} timestamp=${eventTime}`);
      await this.processPositionUpdate(pos, candidatePrice);
    }
  }

  /**
   * Periodic active position poll (500ms interval).
   * Ensures positions are periodically refreshed with executable valuation quotes in the background.
   */
  private async pollActivePositions(): Promise<void> {
    const openPositions = positionManager.getOpenPositions();
    if (openPositions.length === 0) return;

    const now = Date.now();

    for (const pos of openPositions) {
      if (pos.status !== 'OPEN') continue;
      const lastQuoteTime = pos.lastExecutableQuoteAt || 0;
      const lastQuery = this.lastPriceQueryTime.get(pos.mint) || 0;

      // Poll executable quote if older than 2000ms and last query was > 1000ms ago
      if (now - lastQuoteTime >= 2000 && now - lastQuery >= 1000) {
        this.lastPriceQueryTime.set(pos.mint, now);
        try {
          const val = await positionValuationEngine.refreshExecutableQuote(pos);
          if (val && val.currentPriceSol && val.executableValueSol) {
            const tpThreshold = Number.isFinite(pos.tpPct) ? Math.abs(pos.tpPct) : 25;
            const slThreshold = Number.isFinite(pos.slPct) ? -Math.abs(pos.slPct) : -15;
            if (val.pnlPercent !== undefined && (val.pnlPercent >= tpThreshold || val.pnlPercent <= slThreshold)) {
              await unifiedExitEngine.evaluateAndExecuteExit(pos, val.currentPriceSol, {
                executableQuoteSol: val.executableValueSol,
                quoteTimestamp: val.lastExecutableQuoteAt,
              });
            }
          }
        } catch (err: any) {
          console.warn(`[ACTIVE_FEED_POLL_ERROR] mint=${pos.mint}: ${err?.message || err}`);
        }
      }
    }
  }

  /**
   * Ingests candidate market price, updates live market valuation,
   * checks if candidate crosses exit thresholds, and hands off to UnifiedExitEngine.
   */
  public async processPositionUpdate(position: Position, candidatePrice?: number): Promise<void> {
    const mint = position.mint;
    const now = Date.now();
    if (!Number.isSafeInteger(position.tokenAmount) || position.tokenAmount <= 0) {
      console.error(`[EXIT_MONITOR_BLOCKED] reason=UNSAFE_RAW_AMOUNT mint=${mint} amount=${String(position.tokenAmount)}`);
      return;
    }

    // Determine effective candidate price: candidatePrice, bonding curve, or last known price
    let effectivePrice = candidatePrice;
    if (!effectivePrice || effectivePrice <= 0) {
      const bcState = bondingCurveFastLane.getState(mint);
      if (bcState && bcState.priceSolPerToken > 0 && bcState.bondingProgressPct < 100) {
        effectivePrice = bcState.priceSolPerToken;
      } else {
        effectivePrice = position.currentPriceSol;
      }
    }

    if (!effectivePrice || effectivePrice <= 0) return;

    // 1. Update candidate market price and valuation immediately
    const updatedPos = positionManager.updatePositionPrice(
      position.network,
      position.wallet,
      position.mint,
      effectivePrice,
      { isMarketEvent: true, timestamp: now }
    ) || position;

    positionValuationEngine.updateFromMarketEvent(updatedPos, effectivePrice, now, 'WSS');

    // 2. Check whether TP/SL or risk parameters might be crossed
    const candidatePnlPct = updatedPos.averageEntryPrice > 0
      ? ((effectivePrice - updatedPos.averageEntryPrice) / updatedPos.averageEntryPrice) * 100
      : 0;
    const tpThreshold = Number.isFinite(updatedPos.tpPct) ? Math.abs(updatedPos.tpPct) : 25;
    const slThreshold = Number.isFinite(updatedPos.slPct) ? -Math.abs(updatedPos.slPct) : -15;
    const isTriggerCandidate = candidatePnlPct >= tpThreshold || candidatePnlPct <= slThreshold;
    const isTimeExpired = Boolean(updatedPos.maxHoldTimeMs && (now - updatedPos.openedAt >= updatedPos.maxHoldTimeMs));

    // Trailing stop candidate check
    let isTrailingTrigger = false;
    if (updatedPos.highestPnlPct > 0) {
      const dropFromPeak = updatedPos.highestPnlPct - candidatePnlPct;
      const trailingDrop = Number.isFinite(updatedPos.trailingSlPct) ? Math.abs(updatedPos.trailingSlPct!) : 15;
      if (dropFromPeak >= trailingDrop) {
        isTrailingTrigger = true;
      }
    }

    // 3. If candidate crosses any exit threshold, hand off directly to UnifiedExitEngine.
    // UnifiedExitEngine will acquire the atomic lock, fetch ONE fresh executable Jupiter quote,
    // revalidate with executable proceeds, and execute atomically.
    if (isTriggerCandidate || isTimeExpired || isTrailingTrigger) {
      await unifiedExitEngine.evaluateAndExecuteExit(updatedPos, effectivePrice, {
        maxDataAgeMs: 2000,
      });
    }
  }
}

export const activePositionMarketFeed = ActivePositionMarketFeed.getInstance();
