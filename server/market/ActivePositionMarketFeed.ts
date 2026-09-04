// server/market/ActivePositionMarketFeed.ts
import { marketEventBus } from './MarketEventBus.js';
import { MarketEvent } from './EventNormalizer.js';
import { positionManager, Position } from '../trading/PositionManager.js';
import { bondingCurveFastLane } from '../trading/BondingCurveFastLane.js';
import { unifiedExitEngine } from '../trading/UnifiedExitEngine.js';
import { executionGateway } from '../execution/ExecutionGateway.js';

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
   * Ensures positions are continuously updated even if on-chain WSS events for the token are quiet.
   */
  private async pollActivePositions(): Promise<void> {
    const openPositions = positionManager.getOpenPositions();
    if (openPositions.length === 0) return;

    const now = Date.now();

    for (const pos of openPositions) {
      const lastQuery = this.lastPriceQueryTime.get(pos.mint) || 0;
      // If position has not been updated in >= 1000ms, query fast price
      if (now - pos.updatedAt >= 1000 && now - lastQuery >= 800) {
        this.lastPriceQueryTime.set(pos.mint, now);
        await this.processPositionUpdate(pos);
      }
    }
  }

  /**
   * Calculates executable market price for an active position and routes immediately to UnifiedExitEngine.
   */
  public async processPositionUpdate(position: Position, candidatePrice?: number): Promise<void> {
    const mint = position.mint;
    let priceSol = candidatePrice;

    // 1. Check Bonding Curve Fast Lane cache if candidatePrice is absent
    if (!priceSol || priceSol <= 0) {
      const state = bondingCurveFastLane.getState(mint);
      if (state && state.priceSolPerToken > 0) {
        priceSol = state.priceSolPerToken;
      }
    }

    // 2. Query fast executable sell quote if price is still missing or stale (> 2000ms)
    if (!priceSol || priceSol <= 0 || (Date.now() - position.updatedAt > 2000)) {
      try {
        const quote = await executionGateway.quoteSell({
          inputMint: mint,
          outputMint: 'So11111111111111111111111111111111111111112',
          amount: position.tokenAmount,
          slippageBps: position.slippageBpsSl || 1000,
          network: position.network,
        });

        if (quote && quote.outAmount) {
          const lamports = Number(quote.outAmount);
          const solProceeds = lamports / 1e9;
          const tokenQty = position.tokenAmount / (10 ** position.decimals);
          if (tokenQty > 0) {
            priceSol = solProceeds / tokenQty;
          }
        }
      } catch (err) {
        // Fast quote failed, fall back to current cached price
      }
    }

    const currentPriceSol = priceSol && priceSol > 0 ? priceSol : position.currentPriceSol;
    if (currentPriceSol <= 0) return;

    // Update position price in manager
    positionManager.updatePositionPrice(position.network, position.wallet, position.mint, currentPriceSol);

    // Evaluate exit condition in UnifiedExitEngine immediately
    await unifiedExitEngine.evaluateAndExecuteExit(position, currentPriceSol);
  }
}

export const activePositionMarketFeed = ActivePositionMarketFeed.getInstance();
