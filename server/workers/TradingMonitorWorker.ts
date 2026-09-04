// server/workers/TradingMonitorWorker.ts
import { positionManager } from '../trading/PositionManager.js';
import { executionGateway } from '../execution/ExecutionGateway.js';
import { pnlEngine } from '../trading/PnLEngine.js';
import { positionRepository } from '../repositories/PositionRepository.js';
import { unifiedExitEngine } from '../trading/UnifiedExitEngine.js';
import { positionValuationEngine } from '../trading/PositionValuationEngine.js';

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
      const allPositions = positionManager.getOpenPositions();
      if (allPositions.length === 0) return;

      const WSOL = 'So11111111111111111111111111111111111111112';
      const now = Date.now();

      for (const pos of allPositions) {
        // 1. Reconcile positions stuck in EXIT_PENDING for > 10 seconds
        if (pos.status === 'EXIT_PENDING') {
          if (now - pos.updatedAt > 10000) {
            console.warn(`[TradingMonitorWorker] Reconciling stuck EXIT_PENDING position ${pos.id} for mint ${pos.mint}. Re-evaluating exit...`);
            unifiedExitEngine.releaseExitLock(pos.network, pos.wallet, pos.mint);
            pos.status = 'OPEN';
            positionManager.updatePositionStatus(pos.network, pos.wallet, pos.mint, 'OPEN');
          }
          continue;
        }

        if (pos.status !== 'OPEN') continue;

        try {
          // 2. Secondary price check if executable quote is stale (> 3 seconds)
          let currentPriceSol = pos.currentPriceSol;
          let isFreshQuote = false;
          let expectedOutSol: number | undefined = undefined;

          if (now - (pos.lastExecutableQuoteAt || 0) > 3000) {
            try {
              const quote = await executionGateway.quoteSell({
                inputMint: pos.mint,
                outputMint: WSOL,
                amount: pos.tokenAmount,
                slippageBps: pos.slippageBpsSl || 1000,
                network: pos.network,
              });

              if (quote && quote.outAmount) {
                const solProceeds = Number(quote.outAmount) / 1e9;
                expectedOutSol = solProceeds;
                const tokenQty = pos.tokenAmount / (10 ** pos.decimals);
                if (tokenQty > 0) {
                  currentPriceSol = solProceeds / tokenQty;
                  isFreshQuote = true;
                }
              }
            } catch (err: any) {
              console.warn(`[EXIT_MONITOR_RETRY] reason=EXECUTABLE_QUOTE_UNAVAILABLE mint=${pos.mint}: ${err?.message || err}`);
            }
          }

          if (isFreshQuote) {
            positionManager.updatePositionPrice(pos.network, pos.wallet, pos.mint, currentPriceSol, {
              isFreshQuote: true,
              timestamp: now,
            });
            await positionValuationEngine.refreshExecutableQuote(pos);
          }

          // 3. UnifiedExitEngine Failsafe Evaluation
          await unifiedExitEngine.evaluateAndExecuteExit(pos, currentPriceSol, {
            executableQuoteSol: expectedOutSol,
            quoteTimestamp: isFreshQuote ? now : pos.lastExecutableQuoteAt || pos.lastMarketPriceAt || 0,
          });
        } catch (err: any) {
          console.warn(`[TradingMonitorWorker] Error monitoring position ${pos.id}:`, err?.message || err);
        }
      }
    } catch (err) {
      console.warn('[TradingMonitorWorker] Error in monitor loop:', err);
    }
  }
}

export const tradingMonitorWorker = TradingMonitorWorker.getInstance();


