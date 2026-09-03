// src/services/UltraFastExitEngine.ts
import { positionRegistry, PositionRecord } from './PositionRegistry';
import { positionPnLEngine, PositionPnLMetrics } from './PositionPnLEngine';
import { exitTriggerEngine, ExitTriggerEngine, ExitReason, ExitTriggerRuleConfig, ExitTriggerSignal } from './ExitTriggerEngine';
import { exitPriorityQueue, ExitPriorityQueue } from './ExitPriorityQueue';
import { exitExecutionGateway, ExitExecutionGateway, ExitLatencyMetrics } from './ExitExecutionGateway';
import { unifiedTradePipeline } from '../engines/unifiedTradePipeline';
import { systemLogger } from './systemLogger';

export interface MarketPriceEvent {
  mint: string;
  priceSol: number;
  timestamp?: number;
}

export interface ManualExitRequestParams {
  positionId?: string;
  mint?: string;
  reason?: ExitReason;
  sellRatio?: number;
  priority?: number;
}

export class UltraFastExitEngine {
  private static instance: UltraFastExitEngine;
  private customConfigs: Map<string, ExitTriggerRuleConfig> = new Map();
  private executedPartialLevels: Map<string, Set<string>> = new Map(); // positionId -> Set<levelId>
  private positionHoldRatios: Map<string, number> = new Map(); // positionId -> remaining ratio (1.0 down to 0)

  private constructor() {
    this.subscribeToUnifiedPipeline();
  }

  public static getInstance(): UltraFastExitEngine {
    if (!UltraFastExitEngine.instance) {
      UltraFastExitEngine.instance = new UltraFastExitEngine();
    }
    return UltraFastExitEngine.instance;
  }

  private subscribeToUnifiedPipeline(): void {
    unifiedTradePipeline.subscribe((event) => {
      if (event.mint && event.price && event.price > 0) {
        this.onMarketPriceEvent({
          mint: event.mint,
          priceSol: event.price,
          timestamp: event.timestamp,
        });
      }
    });
  }

  /**
   * Primary high-speed entry point for market price events from WSS/LaserStream or Pulse Feed.
   * Evaluates exit conditions immediately (<20ms local execution).
   */
  public onMarketPriceEvent(event: MarketPriceEvent): void {
    const { mint, priceSol, timestamp = Date.now() } = event;
    if (!mint || priceSol <= 0 || !Number.isFinite(priceSol)) return;

    const pos = positionRegistry.getOpenPositionByMint(mint);
    if (!pos || pos.state === 'CLOSED' || pos.state === 'EXIT_CONFIRMED') return;

    // Fast-path lock check
    if (exitPriorityQueue.isPositionQueuedOrProcessing(pos.id)) return;

    // 1. Update Position Registry Price & Peak
    positionRegistry.updatePrice(mint, priceSol);

    // 2. Compute Authoritative Position Metrics
    const metrics: PositionPnLMetrics = positionPnLEngine.calculateMetrics({
      mint,
      amountRaw: pos.amountRaw,
      solSpent: pos.solSpent,
      currentPriceSol: priceSol,
      entryPriceSol: pos.entryPriceSOL,
      decimals: pos.decimals,
      peakPriceSol: pos.peakPriceSOL,
      highestPnLPct: pos.highestPnLPct,
      slippageBps: pos.slippageBpsTp || 250,
      lastUpdateTimestamp: timestamp,
    });

    // 3. Resolve Rule Configuration
    const ruleConfig: ExitTriggerRuleConfig = this.customConfigs.get(pos.id) || {
      takeProfitPct: pos.tpPct ?? 25,
      stopLossPct: pos.slPct ?? 15,
      enableTrailingStop: Boolean(pos.trailingSlPct),
      enablePartialTakeProfit: true,
      maxHoldTimeSeconds: pos.maxHoldTimeMs ? Math.floor(pos.maxHoldTimeMs / 1000) : undefined,
    };

    const partialLevels = this.executedPartialLevels.get(pos.id);
    const holdRatio = this.positionHoldRatios.get(pos.id) ?? 1.0;

    // 4. Evaluate Exit Trigger Rules (<20ms)
    const signal: ExitTriggerSignal | null = exitTriggerEngine.evaluateExitConditions({
      metrics,
      config: ruleConfig,
      createdAtTimestamp: pos.createdAt,
      executedPartialLevels: partialLevels,
      currentHoldRatio: holdRatio,
    });

    if (signal) {
      signal.positionId = pos.id;
      this.handleExitSignal(pos, signal);
    }
  }

  /**
   * Handles a generated exit signal by queueing and triggering execution.
   */
  private handleExitSignal(pos: PositionRecord, signal: ExitTriggerSignal): void {
    const rawToSell = Math.floor(pos.amountRaw * signal.requestedSellRatio);
    if (rawToSell <= 0) return;

    if (signal.reason === 'PARTIAL_TAKE_PROFIT' && signal.partialLevelId) {
      let levelsSet = this.executedPartialLevels.get(pos.id);
      if (!levelsSet) {
        levelsSet = new Set();
        this.executedPartialLevels.set(pos.id, levelsSet);
      }
      levelsSet.add(signal.partialLevelId);

      const currentRatio = this.positionHoldRatios.get(pos.id) ?? 1.0;
      this.positionHoldRatios.set(pos.id, Math.max(0, currentRatio - signal.requestedSellRatio));
    }

    const queuedReq = exitPriorityQueue.enqueue(signal, pos.id, rawToSell);
    if (queuedReq) {
      systemLogger.info('SELL', `[ULTRA_FAST_EXIT] Enqueued ${signal.reason} for ${pos.mintAddress} (${pos.id}). Ratio: ${(signal.requestedSellRatio * 100).toFixed(0)}%`, {
        metadata: { signal },
      });

      // Trigger asynchronous execution gateway
      exitExecutionGateway.processQueue().catch((err) => {
        console.error('[UltraFastExitEngine] Error processing exit queue:', err);
      });
    }
  }

  /**
   * Authoritative manual exit trigger entry point.
   */
  public async requestExit(params: ManualExitRequestParams): Promise<boolean> {
    const { positionId, mint, reason = 'MANUAL_EXIT', sellRatio = 1.0, priority = 6 } = params;

    let pos: PositionRecord | undefined;
    if (positionId) {
      pos = positionRegistry.getPosition(positionId);
    } else if (mint) {
      pos = positionRegistry.getOpenPositionByMint(mint);
    }

    if (!pos || pos.state === 'CLOSED') {
      console.warn('[UltraFastExitEngine] requestExit called but no open position found.');
      return false;
    }

    const metrics: PositionPnLMetrics = positionPnLEngine.calculateMetrics({
      mint: pos.mintAddress,
      amountRaw: pos.amountRaw,
      solSpent: pos.solSpent,
      currentPriceSol: pos.currentPriceSOL || pos.entryPriceSOL,
      entryPriceSol: pos.entryPriceSOL,
      decimals: pos.decimals,
      peakPriceSol: pos.peakPriceSOL,
      highestPnLPct: pos.highestPnLPct,
    });

    const signal: ExitTriggerSignal = {
      mint: pos.mintAddress,
      positionId: pos.id,
      reason,
      priority,
      requestedSellRatio: Math.min(1.0, Math.max(0.01, sellRatio)),
      metrics,
      timestamp: Date.now(),
      details: `Manual exit requested via UltraFastExitEngine (${reason}).`,
    };

    this.handleExitSignal(pos, signal);
    return true;
  }

  public configurePositionRules(positionId: string, config: ExitTriggerRuleConfig): void {
    this.customConfigs.set(positionId, config);
  }

  public getLatencyMetrics(): ExitLatencyMetrics[] {
    return exitExecutionGateway.getLatencyMetrics();
  }

  public clearMemory(positionId: string): void {
    this.customConfigs.delete(positionId);
    this.executedPartialLevels.delete(positionId);
    this.positionHoldRatios.delete(positionId);
    exitPriorityQueue.removeByPositionId(positionId);
  }
}

export const ultraFastExitEngine = UltraFastExitEngine.getInstance();
