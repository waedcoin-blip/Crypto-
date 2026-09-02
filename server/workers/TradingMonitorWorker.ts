// server/workers/TradingMonitorWorker.ts
import { positionManager } from '../trading/PositionManager.js';
import { riskManager } from '../trading/RiskManager.js';
import { tradingEngine } from '../trading/TradingEngine.js';
import { executionGateway } from '../execution/ExecutionGateway.js';
import { pnlEngine } from '../trading/PnLEngine.js';
import { positionRepository } from '../repositories/PositionRepository.js';

export class TradingMonitorWorker {
  private static instance: TradingMonitorWorker;
  private isRunning: boolean = false;
  private timer: NodeJS.Timeout | null = null;

  public static getInstance(): TradingMonitorWorker {
    if (!TradingMonitorWorker.instance) {
      TradingMonitorWorker.instance = new TradingMonitorWorker();
    }
    return TradingMonitorWorker.instance;
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('[TradingMonitorWorker] Trading Monitor Worker initialized with RiskManager & TradingEngine.');

    this.timer = setInterval(async () => {
      await this.monitorLoop();
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
      const openPositions = positionManager.getOpenPositions();
      if (openPositions.length === 0) return;

      const WSOL = 'So11111111111111111111111111111111111111112';

      for (const pos of openPositions) {
        if (pos.status !== 'OPEN') continue;

        try {
          // 1. Fetch current market quote to determine live price
          let currentPriceSol = pos.currentPriceSol;
          try {
            const quote = await executionGateway.quoteSell({
              inputMint: pos.mint,
              outputMint: WSOL,
              amount: pos.tokenAmount,
              slippageBps: pos.slippageBpsTp,
              network: pos.network,
            });

            if (quote && quote.outAmount) {
              const solProceeds = Number(quote.outAmount) / 1e9;
              const tokenQty = pos.tokenAmount / (10 ** pos.decimals);
              if (tokenQty > 0) {
                currentPriceSol = solProceeds / tokenQty;
              }
            }
          } catch {
            // Use existing price if quote fails temporarily
          }

          // 2. Update PnL metrics & repository
          const pnl = pnlEngine.calculatePnL(pos, currentPriceSol);
          pos.currentPriceSol = currentPriceSol;
          pos.unrealizedPnl = pnl.unrealizedPnlSol;
          pos.unrealizedPnlPct = pnl.unrealizedPnlPercent;
          pos.peakPriceSol = Math.max(pos.peakPriceSol, currentPriceSol);
          pos.highestPnlPct = Math.max(pos.highestPnlPct, pnl.unrealizedPnlPercent);

          positionRepository.updatePosition(pos.id, {
            currentPriceSOL: currentPriceSol,
            currentPnLSol: pnl.unrealizedPnlSol,
            currentPnLPct: pnl.unrealizedPnlPercent,
            peakPriceSOL: pos.peakPriceSol,
            highestPnLPct: pos.highestPnlPct,
          });

          // 3. RiskManager Evaluation
          const exitDecision = await riskManager.evaluatePositionExit(pos, currentPriceSol);
          if (exitDecision.shouldExit) {
            console.log(`[TradingMonitorWorker] Triggering ${exitDecision.reason} for position ${pos.id} (${pos.mint}): ${exitDecision.message}`);

            const sellRes = await tradingEngine.sell({
              network: pos.network,
              wallet: pos.wallet,
              mint: pos.mint,
              amountRaw: pos.tokenAmount,
              reason: exitDecision.reason,
            });

            if (sellRes.success) {
              console.log(`[TradingMonitorWorker] Position ${pos.id} successfully exited (${exitDecision.reason}) with sig: ${sellRes.signature}`);
            } else {
              console.warn(`[TradingMonitorWorker] Exit failed for position ${pos.id}: ${sellRes.error}`);
            }
          }
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

