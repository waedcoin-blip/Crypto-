// server/workers/TradingMonitorWorker.ts
import { positionRepository } from '../repositories/PositionRepository.js';
import { jupiterTradingService } from '../services/JupiterTradingService.js';
import { orderRepository } from '../repositories/OrderRepository.js';

export class TradingMonitorWorker {
  private static instance: TradingMonitorWorker;
  private isRunning: boolean = false;
  private timer: NodeJS.Timeout | null = null;
  private activeLocks: Set<string> = new Set();

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
        if (['EXIT_REQUESTED', 'EXIT_SUBMITTED', 'EXIT_CONFIRMING', 'CLOSED', 'RECOVERY_REQUIRED'].includes(pos.state)) {
          continue;
        }

        if (this.activeLocks.has(pos.id)) {
          continue;
        }

        try {
          // Keep raw blockchain amount intact
          const amountRawStr = typeof pos.amountRaw === 'string' ? pos.amountRaw : String(Math.floor(Number(pos.amountRaw)));
          const amountRawBigInt = BigInt(amountRawStr);

          if (amountRawBigInt <= 0n) continue;

          // Query executable quote from Jupiter API
          const quote = await jupiterTradingService.getQuote({
            inputMint: pos.mintAddress,
            outputMint: WSOL,
            amount: amountRawBigInt.toString(),
            slippageBps: pos.slippageBpsTp || 250,
          });

          if (!quote || !quote.outAmount) continue;

          const outLamports = BigInt(quote.outAmount);
          const solProceeds = Number(outLamports) / 1e9;
          const tokenQty = Number(amountRawBigInt) / (10 ** pos.decimals);
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

            // 1. Atomic Exit Lock
            this.activeLocks.add(pos.id);
            positionRepository.updatePosition(pos.id, { state: 'EXIT_REQUESTED' });

            const orderId = `ord_exit_${pos.mintAddress.slice(0, 8)}_${Date.now()}`;
            await orderRepository.createOrder({
              order_id: orderId,
              position_id: pos.id,
              mint: pos.mintAddress,
              side: 'sell',
              amount_raw: amountRawBigInt.toString(),
              label,
              network: pos.network,
              state: 'TRANSACTION_BUILDING',
              created_at: Date.now(),
              updated_at: Date.now(),
            });

            const privateKey = process.env.WALLET_PRIVATE_KEY;
            const rpcUrl = process.env.SOLANA_RPC_URL;

            if (privateKey) {
              try {
                // 2. Pre-sell fresh quote
                const freshQuote = await jupiterTradingService.getQuote({
                  inputMint: pos.mintAddress,
                  outputMint: WSOL,
                  amount: amountRawBigInt.toString(),
                  slippageBps: isTpTriggered ? (pos.slippageBpsTp || 250) : (pos.slippageBpsSl || 500),
                });

                positionRepository.updatePosition(pos.id, { state: 'EXIT_SUBMITTED' });
                await orderRepository.updateState(orderId, 'SUBMITTED');

                // 3. Build, sign, submit and confirm on Mainnet
                const result = await jupiterTradingService.executeSwap({
                  quoteResponse: freshQuote,
                  walletPrivateKey: privateKey,
                  rpcUrl,
                });

                const outLamportsActual = result.outAmountLamports ? BigInt(result.outAmountLamports) : outLamports;
                const actualSolProceeds = Number(outLamportsActual) / 1e9;
                const realizedPnLSol = actualSolProceeds - pos.solSpent;
                const realizedPnLPct = entryPrice > 0 ? ((actualSolProceeds / tokenQty - entryPrice) / entryPrice) * 100 : pnlPct;

                // 4. Confirm and close position
                await orderRepository.updateState(orderId, 'CONFIRMED', {
                  signature: result.signature,
                  netProceedsSol: actualSolProceeds,
                });

                positionRepository.closePosition(pos.id, {
                  exitSignature: result.signature,
                  realizedPnLSol,
                  realizedPnLPct,
                });

                console.log(`[TradingMonitorWorker] Position ${pos.id} CLOSED successfully with sig ${result.signature}. Realized PnL: ${realizedPnLSol.toFixed(4)} SOL (${realizedPnLPct.toFixed(2)}%)`);
              } catch (execErr: any) {
                console.error(`[TradingMonitorWorker] Exit execution failed for position ${pos.id}:`, execErr);
                await orderRepository.updateState(orderId, 'RECOVERY_REQUIRED', {
                  error: execErr?.message || String(execErr),
                });
                positionRepository.updatePosition(pos.id, { state: 'RECOVERY_REQUIRED' });
              }
            } else {
              // Simulated execution path (when running in test / UI simulation without wallet credentials)
              console.log(`[TradingMonitorWorker] Simulated exit execution for position ${pos.id} (no WALLET_PRIVATE_KEY)`);
              const simSig = `sim_exit_${Date.now()}`;
              await orderRepository.updateState(orderId, 'CONFIRMED', {
                signature: simSig,
                netProceedsSol: solProceeds,
              });
              positionRepository.closePosition(pos.id, {
                exitSignature: simSig,
                realizedPnLSol: pnlSol,
                realizedPnLPct: pnlPct,
              });
            }

            this.activeLocks.delete(pos.id);
          }
        } catch (err: any) {
          this.activeLocks.delete(pos.id);
        }
      }
    } catch (err) {
      console.warn('[TradingMonitorWorker] Error in monitor loop:', err);
    }
  }
}

export const tradingMonitorWorker = TradingMonitorWorker.getInstance();
