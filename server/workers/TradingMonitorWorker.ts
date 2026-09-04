// server/workers/TradingMonitorWorker.ts
import { positionManager } from '../trading/PositionManager.js';
import { positionRepository } from '../repositories/PositionRepository.js';

export class TradingMonitorWorker {
  private static instance: TradingMonitorWorker;
  private isRunning: boolean = false;
  private timer: NodeJS.Timeout | null = null;
  private monitorLoopRunning: boolean = false;

  public static getInstance(): TradingMonitorWorker {
    if (!TradingMonitorWorker.instance) {
      TradingMonitorWorker.instance = new TradingMonitorWorker();
    }
    return TradingMonitorWorker.instance;
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('[TradingMonitorWorker] Failsafe Reconciliation Worker started (2s interval).');

    this.timer = setInterval(() => {
      if (this.monitorLoopRunning) return;
      this.monitorLoopRunning = true;
      this.monitorLoop().finally(() => {
        this.monitorLoopRunning = false;
      });
    }, 2000);
  }

  public stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log('[TradingMonitorWorker] Stopped.');
  }

  private async monitorLoop(): Promise<void> {
    try {
      const positions = positionManager.getAllPositions();
      const now = Date.now();

      // This worker is reconciliation/failsafe only. It MUST NOT be a second TP/SL
      // execution pipeline. ActivePositionMarketFeed + UnifiedExitEngine are the sole
      // automatic exit path.
      for (const pos of positions) {
        if (pos.status !== 'EXIT_PENDING' && pos.status !== 'RECOVERY_REQUIRED') continue;

        const age = now - (pos.updatedAt || 0);
        if (age < 10000) continue;

        const repo = positionRepository.getPosition(pos.id);
        if (!repo) continue;

        console.warn(`[TradingMonitorWorker] Position ${pos.id} requires reconciliation; leaving execution locked until transaction/balance state is verified.`);
        // Deliberately do not reopen or resubmit the sell here. A future reconciliation
        // worker may inspect the transaction signature and on-chain token balance.
      }
    } catch (err) {
      console.warn('[TradingMonitorWorker] Error in reconciliation loop:', err);
    }
  }
}

export const tradingMonitorWorker = TradingMonitorWorker.getInstance();


