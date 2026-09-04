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

    // Check direct mint or account keys
    const matchedPositions: Position[] = [];

    if (event.mint && activeMap.has(event.mint)) {
      matchedPositions.push(activeMap.get(event.mint)!);
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

    if (matchedPositions.length === 0) return;

    for (const pos of matchedPositions) {
      await this.processPositionUpdate(pos, event.price);
    }
  }

  /**
   * Periodic active position poll (500ms interval).
   * Ensures positions are continuously updated with fresh executable quote data.
   */
  private async pollActivePositions(): Promise<void> {
    const openPositions = positionManager.getOpenPositions();
    if (openPositions.length === 0) return;

    const now = Date.now();

    for (const pos of openPositions) {
      if (pos.status !== 'OPEN') continue;
      const lastQuoteTime = pos.lastExecutableQuoteAt || 0;
      const lastQuery = this.lastPriceQueryTime.get(pos.mint) || 0;

      // Poll if executable quote is older than 1000ms
      if (now - lastQuoteTime >= 1000 && now - lastQuery >= 500) {
        this.lastPriceQueryTime.set(pos.mint, now);
        await this.processPositionUpdate(pos);
      }
    }
  }

  /**
   * Calculates executable market price for an active position and routes immediately to UnifiedExitEngine.
   * Priority:
   * 1. Executable Jupiter SELL quote
   * 2. Fresh WSS candidate price
   * 3. Bonding curve price (if active and not migrated)
   */
  public async processPositionUpdate(position: Position, candidatePrice?: number): Promise<void> {
    const mint = position.mint;
    const now = Date.now();
    const WSOL = 'So11111111111111111111111111111111111111112';

    // 1. Try Executable Quote from Jupiter if candidate price is missing or quote is older than 1000ms
    const quoteAge = now - (position.lastExecutableQuoteAt || 0);
    if (!candidatePrice || candidatePrice <= 0 || quoteAge > 1000) {
      try {
        const quote = await executionGateway.quoteSell({
          inputMint: mint,
          outputMint: WSOL,
          amount: position.tokenAmount,
          slippageBps: position.slippageBpsSl || 1000,
          network: position.network,
        });

        if (quote && quote.outAmount) {
          const outLamports = BigInt(quote.outAmount);
          const expectedOutSol = Number(outLamports) / 1e9;
          const tokenQty = position.tokenAmount / (10 ** position.decimals);
          const executablePriceSol = tokenQty > 0 ? expectedOutSol / tokenQty : 0;

          if (executablePriceSol > 0) {
            const updatedPos = positionManager.updatePositionPrice(
              position.network,
              position.wallet,
              position.mint,
              executablePriceSol,
              { isFreshQuote: true, timestamp: now }
            ) || position;

            // Authoritative valuation update
            await positionValuationEngine.refreshExecutableQuote(updatedPos);

            await unifiedExitEngine.evaluateAndExecuteExit(updatedPos, executablePriceSol, {
              executableQuoteSol: expectedOutSol,
              quoteTimestamp: now,
            });
            return;
          }
        }
      } catch (err: any) {
        console.warn(`[EXIT_MONITOR_RETRY] reason=EXECUTABLE_QUOTE_UNAVAILABLE mint=${mint}: ${err?.message || err}`);
        // Failed quote MUST NOT modify timestamps or overwrite prices with zero!
      }
    }

    // 2. Process candidate price if available
    if (candidatePrice && candidatePrice > 0) {
      const updatedPos = positionManager.updatePositionPrice(
        position.network,
        position.wallet,
        position.mint,
        candidatePrice,
        { isMarketEvent: true, timestamp: now }
      ) || position;

      positionValuationEngine.updateFromMarketEvent(updatedPos, candidatePrice, now, 'WSS');

      await unifiedExitEngine.evaluateAndExecuteExit(updatedPos, candidatePrice, {
        quoteTimestamp: now,
      });
      return;
    }

    // 3. Fallback to Bonding Curve Fast Lane if active and not complete (migrated)
    const bcState = bondingCurveFastLane.getState(mint);
    if (bcState && bcState.priceSolPerToken > 0 && bcState.bondingProgressPct < 100) {
      const updatedPos = positionManager.updatePositionPrice(
        position.network,
        position.wallet,
        position.mint,
        bcState.priceSolPerToken,
        { timestamp: now }
      ) || position;

      await unifiedExitEngine.evaluateAndExecuteExit(updatedPos, bcState.priceSolPerToken, {
        quoteTimestamp: now,
      });
      return;
    }

    // 4. Stale price fallback evaluation - pass last known timestamp so freshness check can block stale triggers
    if (position.currentPriceSol > 0) {
      await unifiedExitEngine.evaluateAndExecuteExit(position, position.currentPriceSol, {
        quoteTimestamp: position.lastExecutableQuoteAt || position.lastMarketPriceAt || 0,
      });
    }
  }
}

export const activePositionMarketFeed = ActivePositionMarketFeed.getInstance();
