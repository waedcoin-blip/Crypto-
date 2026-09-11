// server/workers/TradingMonitorWorker.ts
import { positionManager } from '../trading/PositionManager.js';
import { positionValuationEngine } from '../trading/PositionValuationEngine.js';
import { unifiedExitEngine } from '../trading/UnifiedExitEngine.js';
import { workerStateRepository } from '../repositories/WorkerStateRepository.js';
import { tradingSupervisor } from '../trading/TradingSupervisor.js';

/**
 * TradingMonitorWorker: Background worker that periodically:
 * 1. Refreshes executable quotes for all open positions
 * 2. Evaluates TP/SL/Trailing/MaxHold conditions
 * 3. Triggers exits when conditions are met
 * 4. Reports heartbeats for health monitoring
 *
 * This worker runs alongside ActivePositionMarketFeed to provide
 * a safety net for positions that don't receive live market events.
 */
export class TradingMonitorWorker {
  private static instance: TradingMonitorWorker;
  private isRunning: boolean = false;
  private monitorTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private readonly MONITOR_INTERVAL_MS = 5000; // Check positions every 5s
  private readonly HEARTBEAT_INTERVAL_MS = 15000; // Heartbeat every 15s

  private constructor() {}

  public static getInstance(): TradingMonitorWorker {
    if (!TradingMonitorWorker.instance) {
      TradingMonitorWorker.instance = new TradingMonitorWorker();
    }
    return TradingMonitorWorker.instance;
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    // Main monitoring loop
    this.monitorTimer = setInterval(() => this.runMonitorCycle(), this.MONITOR_INTERVAL_MS);
    if (this.monitorTimer.unref) this.monitorTimer.unref();

    // Heartbeat reporting
    this.heartbeatTimer = setInterval(() => this.reportHeartbeat(), this.HEARTBEAT_INTERVAL_MS);
    if (this.heartbeatTimer.unref) this.heartbeatTimer.unref();

    await this.reportHeartbeat();
    console.log('[TradingMonitorWorker] Started. Monitoring open positions.');
  }

  public stop(): void {
    this.isRunning = false;
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    workerStateRepository.heartbeat({ worker: 'trading', status: 'STOPPED' }).catch(() => {});
    console.log('[TradingMonitorWorker] Stopped.');
  }

  private async runMonitorCycle(): Promise<void> {
    if (!this.isRunning) return;

    try {
      const supervisorStatus = tradingSupervisor.getStatus();
      if (supervisorStatus.state !== 'TRADING') return;

      const openPositions = positionManager.getOpenPositions();
      if (openPositions.length === 0) return;

      // Refresh valuations for all open positions
      await positionValuationEngine.forceRefreshAllQuotes(openPositions);

      // Evaluate exit conditions for each position
      for (const position of openPositions) {
        try {
          const valuation = positionValuationEngine.getValuation(
            position.network,
            position.wallet,
            position.mint
          );
          if (!valuation || valuation.currentPriceSol <= 0) continue;

          const exitDecision = unifiedExitEngine.evaluatePositionExit(
            position,
            valuation.currentPriceSol
          );

          if (exitDecision.shouldExit) {
            console.log(`[TradingMonitorWorker] EXIT TRIGGERED: mint=${position.mint} reason=${exitDecision.reason}`);
            await unifiedExitEngine.evaluateAndExecuteExit(position, valuation.currentPriceSol);
          }
        } catch (err: any) {
          // Silently skip individual position errors
        }
      }
    } catch (err: any) {
      console.error('[TradingMonitorWorker] Monitor cycle error:', err?.message);
    }
  }

  private async reportHeartbeat(): Promise<void> {
    try {
      await workerStateRepository.heartbeat({
        worker: 'trading',
        status: this.isRunning ? 'RUNNING' : 'STOPPED',
        metadata: {
          openPositions: positionManager.getOpenPositions().length,
          timestamp: Date.now(),
        },
      });
    } catch {
      // Silently ignore heartbeat failures
    }
  }
}

export const tradingMonitorWorker = TradingMonitorWorker.getInstance();
