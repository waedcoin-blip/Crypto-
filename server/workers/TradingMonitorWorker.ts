// server/workers/TradingMonitorWorker.ts
import { positionRepository } from '../repositories/PositionRepository.js';
import { jupiterTradingService } from '../services/JupiterTradingService.js';
import { orderRepository } from '../repositories/OrderRepository.js';

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
    console.log('[TradingMonitorWorker] Trading Monitor Worker initialized.');

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
      const openPositions = positionRepository.getOpenPositions();
      if (openPositions.length === 0) return;

      const WSOL = 'So11111111111111111111111111111111111111112';

      for (const pos of openPositions) {
        if (['EXIT_SUBMITTED', 'EXIT_CONFIRMING', 'CLOSED'].includes(pos.state)) continue;

        try {
          // Query executable quote from Jupiter API
          const quote = await jupiterTradingService.getQuote({
            inputMint: pos.mintAddress,
            outputMint: WSOL,
            amount: pos.amountRaw,
            slippageBps: pos.slippageBpsTp || 250,
          });

          if (!quote || !quote.outAmount) continue;

          const outLamports = Number(quote.outAmount);
          const solProceeds = outLamports / 1e9;
          const tokenQty = pos.amountRaw / (10 ** pos.decimals);
          const currentPriceSOL = tokenQty > 0 ? solProceeds / tokenQty : 0;

          if (currentPriceSOL <= 0) continue;

          // Update position price state
          const entryPrice = pos.entryPriceSOL;
          const pnlPct = entryPrice > 0 ? ((currentPriceSOL - entryPrice) / entryPrice) * 100 : 0;
          const pnlSol = solProceeds - pos.solSpent;

          positionRepository.updatePosition(pos.id, {
            currentPriceSOL,
            currentPnLSol: pnlSol,
            currentPnLPct: pnlPct,
            peakPriceSOL: Math.max(pos.peakPriceSOL || currentPriceSOL, currentPriceSOL),
            highestPnLPct: Math.max(pos.highestPnLPct || pnlPct, pnlPct),
          });

          // Check TP/SL triggers
          const isTpTriggered = pnlPct >= pos.tpPct;
          const isSlTriggered = pnlPct <= -Math.abs(pos.slPct);

          if (isTpTriggered || isSlTriggered) {
            const label = isTpTriggered ? 'exit_tp' : 'exit_sl';
            console.log(`[TradingMonitorWorker] Triggered ${label.toUpperCase()} for position ${pos.id} (${pos.mintAddress}) at PnL ${pnlPct.toFixed(2)}%`);

            positionRepository.updatePosition(pos.id, { state: 'EXIT_REQUESTED' });

            const walletPubkey = process.env.WALLET_PUBLIC_KEY;
            if (walletPubkey && process.env.WALLET_PRIVATE_KEY) {
              const orderId = `ord_exit_${pos.mintAddress.slice(0, 8)}_${Date.now()}`;
              await orderRepository.createOrder({
                order_id: orderId,
                position_id: pos.id,
                mint: pos.mintAddress,
                side: 'sell',
                amount_raw: pos.amountRaw,
                label,
                network: pos.network,
                state: 'TRANSACTION_BUILDING',
                created_at: Date.now(),
                updated_at: Date.now(),
              });

              positionRepository.updatePosition(pos.id, { state: 'EXIT_SUBMITTED' });
            }
          }
        } catch (err: any) {
          // Ignore quote error on individual position tick
        }
      }
    } catch (err) {
      console.warn('[TradingMonitorWorker] Error in monitor loop:', err);
    }
  }
}

export const tradingMonitorWorker = TradingMonitorWorker.getInstance();
