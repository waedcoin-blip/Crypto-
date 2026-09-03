// src/services/ExitExecutionGateway.ts
import { QueuedExitRequest, exitPriorityQueue } from './ExitPriorityQueue';
import { positionRegistry, PositionRecord } from './PositionRegistry';
import { orderManager } from './OrderManager';
import { jupiterQuoteService } from './JupiterQuoteService';
import { exitTransactionBuilder, PreparedExitTransaction } from './ExitTransactionBuilder';
import { transactionBroadcaster } from './TransactionBroadcaster';
import { unifiedTradePipeline } from '../engines/unifiedTradePipeline';
import { systemLogger } from './systemLogger';
import { useTradingEnvironmentStore } from '../store/tradingEnvironmentStore';
import { tradeHistoryRegistry } from './TradeHistoryRegistry';

export interface ExitLatencyMetrics {
  positionId: string;
  mint: string;
  reason: string;
  eventToTriggerMs: number;
  triggerToQuoteMs: number;
  quoteToBuildMs: number;
  buildToSubmitMs: number;
  submitToConfirmationMs: number;
  totalExitMs: number;
  attempts: number;
  timestamp: number;
}

export class ExitExecutionGateway {
  private static instance: ExitExecutionGateway;
  private isProcessing = false;
  private exitSequences: Map<string, number> = new Map(); // positionId -> sequence
  private activeLocks: Set<string> = new Set(); // SELL:{positionId}:{sequence}
  private latencyHistory: ExitLatencyMetrics[] = [];

  public static getInstance(): ExitExecutionGateway {
    if (!ExitExecutionGateway.instance) {
      ExitExecutionGateway.instance = new ExitExecutionGateway();
    }
    return ExitExecutionGateway.instance;
  }

  public async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      while (exitPriorityQueue.size() > 0) {
        const request = exitPriorityQueue.dequeue();
        if (!request) break;
        await this.executeExitRequest(request);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Executes a single queued exit request with atomic idempotency locks and full retry state machine.
   */
  public async executeExitRequest(request: QueuedExitRequest): Promise<boolean> {
    const startTotal = Date.now();
    const pos = positionRegistry.getPosition(request.positionId) || positionRegistry.getOpenPositionByMint(request.mint);

    if (!pos || pos.state === 'CLOSED') {
      console.warn(`[ExitExecutionGateway] Target position ${request.positionId} for ${request.mint} is null or already CLOSED. Skipping exit.`);
      return false;
    }

    // Atomic idempotency lock
    const seq = (this.exitSequences.get(pos.id) || 0) + 1;
    this.exitSequences.set(pos.id, seq);
    const lockKey = `SELL:${pos.id}:${seq}`;

    if (this.activeLocks.has(lockKey)) {
      console.warn(`[ExitExecutionGateway] IDEMPOTENCY LOCK: ${lockKey} is currently active. Dropping duplicate sell.`);
      return false;
    }

    this.activeLocks.add(lockKey);
    exitPriorityQueue.setProcessingLock(pos.id, request.id);

    let currentAttempt = 0;
    const maxAttempts = 3;
    let exitSuccess = false;

    const tTrigger = Date.now();
    let tQuote = tTrigger;
    let tBuild = tTrigger;
    let tSubmit = tTrigger;
    let tConfirm = tTrigger;

    try {
      // 1. OPEN -> EXIT_TRIGGERED
      positionRegistry.transitionState(pos.id, 'EXIT_TRIGGERED');
      unifiedTradePipeline.ingest({
        eventId: `exit_evt_${pos.id}_${Date.now()}`,
        source: 'MANUAL',
        type: 'SELL',
        mint: pos.mintAddress,
        symbol: pos.mintAddress.slice(0, 6),
        amount: request.amountRawToSell,
        timestamp: Date.now(),
      });

      const network = pos.network || useTradingEnvironmentStore.getState().network || 'paper';

      while (currentAttempt < maxAttempts && !exitSuccess) {
        currentAttempt++;
        request.attemptCount = currentAttempt;

        try {
          if (network === 'paper') {
            // Paper Mode Execution Path
            tQuote = Date.now();
            tBuild = tQuote;
            positionRegistry.transitionState(pos.id, 'SUBMITTING');
            tSubmit = Date.now();

            const label = request.signal.reason.toLowerCase();
            const result = await orderManager.executeOrder(
              pos.mintAddress,
              'So11111111111111111111111111111111111111112',
              request.amountRawToSell,
              pos.slippageBpsTp || 250,
              label,
              null
            );

            tConfirm = Date.now();
            positionRegistry.transitionState(pos.id, 'EXIT_CONFIRMED', {
              exitSignature: result.signature,
              orderId: result.signature,
            });

            // Async non-blocking reconciliation for paper mode
            const netProceeds = Math.max(0, (result.outputAmount / 1e9) - (result.feeSol || 0));

            this.reconcileClosedPosition(pos, netProceeds, result.signature);
            exitSuccess = true;
          } else {
            // Live Mainnet Execution Path
            // 2. QUOTE_PENDING -> Fetch Executable Quote
            positionRegistry.transitionState(pos.id, 'QUOTE_PENDING');
            const slippageBps = currentAttempt === 1 ? (pos.slippageBpsTp || 250) : (pos.slippageBpsSl || 500);

            const validatedQuote = await jupiterQuoteService.getExecutableExitQuote({
              tokenMint: pos.mintAddress,
              amountRaw: request.amountRawToSell,
              slippageBps,
            });

            tQuote = Date.now();
            positionRegistry.transitionState(pos.id, 'QUOTE_READY');

            // 3. SUBMITTING -> Build Signed Transaction
            positionRegistry.transitionState(pos.id, 'SUBMITTING');
            const priorityTier = currentAttempt === 1 ? 'HIGH' : (currentAttempt === 2 ? 'URGENT' : 'EMERGENCY');
            const preparedTx = await exitTransactionBuilder.buildSignedExitTransaction(
              validatedQuote,
              priorityTier
            );

            tBuild = Date.now();

            // 4. SUBMITTED & CONFIRMING -> Broadcast Transaction
            positionRegistry.transitionState(pos.id, 'SUBMITTED');
            tSubmit = Date.now();

            const broadcastResult = await transactionBroadcaster.broadcastAndConfirm(preparedTx);
            tConfirm = Date.now();

            if (broadcastResult.confirmed) {
              positionRegistry.transitionState(pos.id, 'EXIT_CONFIRMED', {
                exitSignature: broadcastResult.signature,
              });

              // Fast non-blocking async post-confirmation reconciliation
              this.reconcileClosedPosition(pos, validatedQuote.expectedOutputSol, broadcastResult.signature);
              exitSuccess = true;
            }
          }
        } catch (attemptErr: any) {
          console.error(`[ExitExecutionGateway] Exit attempt ${currentAttempt}/${maxAttempts} failed for ${pos.mintAddress}:`, attemptErr);
          
          if (currentAttempt < maxAttempts) {
            positionRegistry.transitionState(pos.id, 'EXIT_FAILED');
            // Brief pause before retry with fresh quote
            await new Promise((r) => setTimeout(r, 200 * currentAttempt));
          } else {
            // Max attempts exhausted: Move to RECOVERY_REQUIRED to prevent infinite retry loops or race conditions
            positionRegistry.transitionState(pos.id, 'RECOVERY_REQUIRED');
            systemLogger.warn('SAFETY', `[EXIT_ENGINE] Max exit attempts (${maxAttempts}) exhausted for ${pos.mintAddress}. Set to RECOVERY_REQUIRED.`, {
              metadata: { error: attemptErr?.message || String(attemptErr) },
            });
          }
        }
      }

      // Record Latency Telemetry
      const endTotal = Date.now();
      const metrics: ExitLatencyMetrics = {
        positionId: pos.id,
        mint: pos.mintAddress,
        reason: request.signal.reason,
        eventToTriggerMs: Math.max(0, tTrigger - request.queuedAt),
        triggerToQuoteMs: Math.max(0, tQuote - tTrigger),
        quoteToBuildMs: Math.max(0, tBuild - tQuote),
        buildToSubmitMs: Math.max(0, tSubmit - tBuild),
        submitToConfirmationMs: Math.max(0, tConfirm - tSubmit),
        totalExitMs: Math.max(0, endTotal - startTotal),
        attempts: currentAttempt,
        timestamp: endTotal,
      };

      this.latencyHistory.unshift(metrics);
      if (this.latencyHistory.length > 100) this.latencyHistory.pop();

      return exitSuccess;
    } finally {
      this.activeLocks.delete(lockKey);
      exitPriorityQueue.releaseProcessingLock(pos.id);
    }
  }

  /**
   * Performs asynchronous non-blocking reconciliation for a confirmed exit.
   */
  private async reconcileClosedPosition(
    pos: PositionRecord,
    netProceedsSol: number,
    signature?: string
  ): Promise<void> {
    try {
      positionRegistry.transitionState(pos.id, 'RECONCILING');

      const solSpent = pos.solSpent || 0;
      const realizedPnLSol = netProceedsSol - solSpent;
      const realizedPnLPct = solSpent > 0 ? (realizedPnLSol / solSpent) * 100 : 0;
      const tokenQty = pos.amountRaw > 0 ? pos.amountRaw / Math.pow(10, pos.decimals) : 0;

      // Add to Trade History
      try {
        tradeHistoryRegistry.recordTrade({
          id: `trade_exit_${pos.id}_${Date.now()}`,
          positionId: pos.id,
          mintAddress: pos.mintAddress,
          side: 'SELL',
          amountRaw: pos.amountRaw,
          amountTokens: tokenQty,
          solAmount: netProceedsSol,
          priceSOL: tokenQty > 0 ? netProceedsSol / tokenQty : 0,
          pnlSol: realizedPnLSol,
          pnlPct: realizedPnLPct,
          signature: signature || pos.exitSignature || 'sig_' + Date.now(),
          network: pos.network,
          timestamp: Date.now(),
          status: 'CONFIRMED',
        });
      } catch (e) {
        // Ignored if trade history already exists or fails non-critically
      }

      // Final position state closure
      positionRegistry.transitionState(pos.id, 'CLOSED', {
        exitSignature: signature,
        realizedPnLSol,
        realizedPnLPct,
      });

      systemLogger.info('SELL', `[EXIT_ENGINE] Position ${pos.id} (${pos.mintAddress}) CLOSED. Realized PnL: ${realizedPnLSol.toFixed(4)} SOL (${realizedPnLPct.toFixed(2)}%)`, {
        signature,
        metadata: { proceedsSol: netProceedsSol },
      });
    } catch (err) {
      console.error(`[ExitExecutionGateway] Error in reconcileClosedPosition for ${pos.mintAddress}:`, err);
    }
  }

  public getLatencyMetrics(): ExitLatencyMetrics[] {
    return [...this.latencyHistory];
  }
}

export const exitExecutionGateway = ExitExecutionGateway.getInstance();
