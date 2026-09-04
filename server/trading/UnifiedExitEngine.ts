// server/trading/UnifiedExitEngine.ts
import { marketEventBus } from '../market/MarketEventBus.js';
import { MarketEvent } from '../market/EventNormalizer.js';
import { Position, positionManager } from './PositionManager.js';
import { pnlEngine } from './PnLEngine.js';
import { criteriaRepository } from '../repositories/CriteriaRepository.js';
import { fastExitExecutor } from '../execution/FastExitExecutor.js';
import { positionRepository } from '../repositories/PositionRepository.js';
import { activePositionMarketFeed } from '../market/ActivePositionMarketFeed.js';

export interface ExitConfig {
  takeProfitPercent: number;
  stopLossPercent: number;
  trailingEnabled: boolean;
  trailingStopPercent?: number;
  trailingActivationPercent?: number;
}

export interface ExitDecision {
  shouldExit: boolean;
  reason?: 'EMERGENCY_EXIT' | 'STOP_LOSS' | 'TAKE_PROFIT' | 'TRAILING_STOP' | 'MANUAL_EXIT' | string;
  executablePnlPct?: number;
  expectedOutSol?: number;
  message?: string;
}

export interface AuditTrailEntry {
  timestamp: number;
  positionId: string;
  mint: string;
  event: 'EXIT_EVALUATED' | 'EXIT_TRIGGERED' | 'EXIT_AUTHORIZED' | 'SELL_SUBMITTED' | 'SELL_CONFIRMED' | 'SELL_FAILED' | 'SELL_RETRY' | 'POSITION_CLOSED';
  reason?: string;
  message?: string;
  metadata?: Record<string, any>;
}

export class UnifiedExitEngine {
  private static instance: UnifiedExitEngine;
  private isRunning: boolean = false;
  private unsubscribeBus: (() => void) | null = null;
  private auditTrail: AuditTrailEntry[] = [];
  
  // High-throughput execution locks by wallet:mint to prevent duplicate sell signals
  private exitLocks: Set<string> = new Set(); // format: "network:wallet:mint"

  private constructor() {}

  public static getInstance(): UnifiedExitEngine {
    if (!UnifiedExitEngine.instance) {
      UnifiedExitEngine.instance = new UnifiedExitEngine();
    }
    return UnifiedExitEngine.instance;
  }

  /**
   * Starts the UnifiedExitEngine, ActivePositionMarketFeed, and subscribes to MarketEventBus.
   */
  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // 1. Start Priority P1 Active Position Market Feed
    activePositionMarketFeed.start();

    // 2. Subscribe to MarketEventBus
    this.unsubscribeBus = marketEventBus.subscribe((event: MarketEvent) => {
      this.onMarketEvent(event).catch(err => {
        console.error('[UnifiedExitEngine] Error handling market event:', err);
      });
    });

    console.log('[UnifiedExitEngine] Sole authoritative server-side Exit Engine active and subscribed to MarketEventBus.');
    this.recordGlobalLog('SYSTEM', 'Exit Engine started successfully.');
  }

  public stop(): void {
    this.isRunning = false;
    if (this.unsubscribeBus) {
      this.unsubscribeBus();
      this.unsubscribeBus = null;
    }
    activePositionMarketFeed.stop();
    console.log('[UnifiedExitEngine] Stopped.');
  }

  /**
   * Main real-time handler for streaming market updates from MarketEventBus.
   */
  private async onMarketEvent(event: MarketEvent): Promise<void> {
    if (!this.isRunning) return;

    const openPositions = positionManager.getOpenPositions();
    if (openPositions.length === 0) return;

    // Check event mint or account keys against open positions
    const activeMap = new Map<string, Position>();
    for (const pos of openPositions) {
      activeMap.set(pos.mint.toLowerCase(), pos);
    }

    let targetPositions: Position[] = [];

    if (event.mint && activeMap.has(event.mint.toLowerCase())) {
      targetPositions.push(activeMap.get(event.mint.toLowerCase())!);
    }

    if (event.accountKeys && event.accountKeys.length > 0) {
      for (const key of event.accountKeys) {
        const keyLower = key.toLowerCase();
        if (activeMap.has(keyLower)) {
          const pos = activeMap.get(keyLower)!;
          if (!targetPositions.includes(pos)) {
            targetPositions.push(pos);
          }
        }
      }
    }

    if (targetPositions.length === 0) return;

    for (const position of targetPositions) {
      if (position.status !== 'OPEN') continue;

      let priceSol = event.price || position.currentPriceSol;
      if (!priceSol || priceSol <= 0) continue;

      // Update position price and evaluate exit immediately
      positionManager.updatePositionPrice(position.network, position.wallet, position.mint, priceSol);
      await this.evaluateAndExecuteExit(position, priceSol);
    }
  }

  /**
   * Atomic lock acquisition to protect against duplicate sell pipelines
   */
  public acquireExitLock(network: string, wallet: string, mint: string): boolean {
    const lockKey = `${network}:${wallet}:${mint.toLowerCase()}`;
    if (this.exitLocks.has(lockKey)) {
      return false;
    }
    this.exitLocks.add(lockKey);
    return true;
  }

  public releaseExitLock(network: string, wallet: string, mint: string): void {
    const lockKey = `${network}:${wallet}:${mint.toLowerCase()}`;
    this.exitLocks.delete(lockKey);
  }

  /**
   * Core exit decision-making logic evaluating all risk scenarios.
   * STRICT: 100% full exit ONLY. No partial take profit.
   */
  public async evaluatePositionExit(
    position: Position,
    currentPriceSol: number,
    opts: {
      executableQuoteSol?: number;
      quoteTimestamp?: number;
      maxDataAgeMs?: number;
    } = {}
  ): Promise<ExitDecision> {
    if (position.status !== 'OPEN') {
      return { shouldExit: false, message: `Position status is ${position.status}, not OPEN` };
    }

    const now = Date.now();
    position.lastExitEvaluationAt = now;

    // Data freshness verification
    const maxAge = opts.maxDataAgeMs ?? 5000;
    const lastDataAt = opts.quoteTimestamp || position.lastExecutableQuoteAt || position.lastMarketPriceAt || 0;
    if (lastDataAt > 0 && (now - lastDataAt > maxAge)) {
      console.warn(`[EXIT_MONITOR_BLOCKED] reason=STALE_MARKET_DATA position=${position.id} mint=${position.mint} ageMs=${now - lastDataAt}`);
      return {
        shouldExit: false,
        message: `[EXIT_MONITOR_BLOCKED] reason=STALE_MARKET_DATA ageMs=${now - lastDataAt}`,
      };
    }

    const pnl = pnlEngine.calculatePnL(position, currentPriceSol);
    const criteria = criteriaRepository.getActiveCriteriaSync() as any;

    // Calculate gross PnL percentage using actual executable SOL proceeds if provided, else current market price
    let grossPnlPct: number;
    if (opts.executableQuoteSol !== undefined && position.totalSolSpent > 0) {
      grossPnlPct = ((opts.executableQuoteSol - position.totalSolSpent) / position.totalSolSpent) * 100;
    } else if (position.averageEntryPrice > 0) {
      grossPnlPct = ((currentPriceSol - position.averageEntryPrice) / position.averageEntryPrice) * 100;
    } else {
      grossPnlPct = pnl.unrealizedPnlPercent;
    }

    // Load configurations with explicit finite checks (Standardized: positive magnitude for TP/SL)
    const tpThreshold = Number.isFinite(position.tpPct) ? Math.abs(position.tpPct) : Math.abs(criteria.minTakeProfit || 25);
    const slThreshold = Number.isFinite(position.slPct) ? -Math.abs(position.slPct) : -Math.abs(criteria.stopLoss || 15);

    // Trailing stop loss configuration
    const trailingEnabled = criteria.trailingEnabled ?? true;
    const trailingStopPercent = criteria.trailingStopPercent ?? 5;
    const trailingActivationPercent = criteria.trailingActivationPercent ?? 10;

    console.log(
      `[EXIT_MONITOR] position=${position.id} mint=${position.mint} entryPrice=${position.averageEntryPrice.toFixed(6)} currentPrice=${currentPriceSol.toFixed(6)} pnlPct=${grossPnlPct.toFixed(2)}% tpThreshold=+${tpThreshold.toFixed(2)}% slThreshold=${slThreshold.toFixed(2)}%`
    );

    // 1. Check Max Hold Time (EMERGENCY_EXIT)
    if (position.maxHoldTimeMs && position.maxHoldTimeMs > 0) {
      const heldMs = now - position.openedAt;
      if (heldMs >= position.maxHoldTimeMs) {
        return {
          shouldExit: true,
          reason: 'EMERGENCY_EXIT',
          executablePnlPct: grossPnlPct,
          expectedOutSol: opts.executableQuoteSol,
          message: `[EXIT_MONITOR] Max hold time exceeded (${(heldMs / 1000).toFixed(0)}s >= ${(position.maxHoldTimeMs / 1000).toFixed(0)}s)`,
        };
      }
    }

    // 2. Check Stop Loss threshold (STOP_LOSS)
    if (grossPnlPct <= slThreshold) {
      console.log(`[SL_TRIGGERED] Stop loss triggered for ${position.mint}: ${grossPnlPct.toFixed(2)}% <= ${slThreshold.toFixed(2)}%`);
      return {
        shouldExit: true,
        reason: 'STOP_LOSS',
        executablePnlPct: grossPnlPct,
        expectedOutSol: opts.executableQuoteSol,
        message: `[SL_TRIGGERED] Stop loss triggered: ${grossPnlPct.toFixed(2)}% <= ${slThreshold.toFixed(2)}%`,
      };
    }

    // 3. Check Take Profit threshold (TAKE_PROFIT)
    if (grossPnlPct >= tpThreshold) {
      console.log(`[TP_TRIGGERED] Take profit triggered for ${position.mint}: +${grossPnlPct.toFixed(2)}% >= +${tpThreshold.toFixed(2)}% (100% full exit)`);
      return {
        shouldExit: true,
        reason: 'TAKE_PROFIT',
        executablePnlPct: grossPnlPct,
        expectedOutSol: opts.executableQuoteSol,
        message: `[TP_TRIGGERED] Take profit triggered: +${grossPnlPct.toFixed(2)}% >= +${tpThreshold.toFixed(2)}% (100% full exit)`,
      };
    }

    // 4. Check Trailing Stop (TRAILING_STOP)
    if (trailingEnabled && position.highestPnlPct >= trailingActivationPercent) {
      const dropFromPeak = position.highestPnlPct - grossPnlPct;
      if (dropFromPeak >= trailingStopPercent) {
        return {
          shouldExit: true,
          reason: 'TRAILING_STOP',
          executablePnlPct: grossPnlPct,
          expectedOutSol: opts.executableQuoteSol,
          message: `[TRAILING_STOP] Trailing stop triggered: peak +${position.highestPnlPct.toFixed(2)}%, dropped by ${dropFromPeak.toFixed(2)}% >= ${trailingStopPercent}%`,
        };
      }
    }

    return { shouldExit: false };
  }

  /**
   * Main driver to evaluate and execute exits atomically.
   */
  public async evaluateAndExecuteExit(
    position: Position,
    priceSol: number,
    opts: {
      executableQuoteSol?: number;
      quoteTimestamp?: number;
      maxDataAgeMs?: number;
    } = {}
  ): Promise<boolean> {
    const lockKey = `${position.network}:${position.wallet}:${position.mint.toLowerCase()}`;
    if (this.exitLocks.has(lockKey)) {
      return false; // Exit process already ongoing
    }

    const decision = await this.evaluatePositionExit(position, priceSol, opts);
    if (!decision.shouldExit || !decision.reason) return false;

    // Automatic exits MUST be backed by a fresh executable Jupiter quote.
    // A WSS/display price is only a trigger candidate and can never authorize a sell.
    if (decision.reason !== 'MANUAL_EXIT' && opts.executableQuoteSol === undefined) {
      console.warn(`[EXIT_MONITOR_BLOCKED] reason=NO_EXECUTABLE_QUOTE position=${position.id} mint=${position.mint} trigger=${decision.reason}`);
      return false;
    }

    // Acquire atomic lock
    if (!this.acquireExitLock(position.network, position.wallet, position.mint)) {
      return false;
    }

    const res = await this.authorizeAndExecuteWithRetry(position, decision.reason, decision.message || '', 3);
    return res.success;
  }

  /**
   * Authorizes and executes exit with fast retry loop on transient execution failures.
   */
  public async authorizeAndExecuteWithRetry(
    position: Position,
    reason: string,
    message: string,
    maxRetries: number = 3
  ): Promise<{ success: boolean; signature?: string; error?: string; result?: any }> {
    const startTime = Date.now();
    console.log(`[UnifiedExitEngine] [EXIT_AUTHORIZED] position=${position.id} mint=${position.mint} reason=${reason}: ${message}`);

    // Update position status to EXIT_PENDING to lock out duplicate triggers
    positionManager.updatePositionStatus(position.network, position.wallet, position.mint, 'EXIT_PENDING');
    positionRepository.updatePosition(position.id, { state: 'EXIT_REQUESTED' });

    this.recordAuditTrail(position.id, position.mint, 'EXIT_TRIGGERED', reason, message);
    this.recordAuditTrail(position.id, position.mint, 'EXIT_AUTHORIZED', reason, `Authorized for 100% exit execution.`);

    let attempt = 0;
    const slippageBps = reason === 'TAKE_PROFIT' ? position.slippageBpsTp : position.slippageBpsSl;
    let lastResult: any = undefined;

    while (attempt < maxRetries) {
      attempt++;
      this.recordAuditTrail(
        position.id,
        position.mint,
        'SELL_SUBMITTED',
        reason,
        `[SELL_SUBMITTED] Attempt ${attempt}/${maxRetries} submitting sell order for ${position.tokenAmount} raw tokens.`
      );

      try {
        const result = await fastExitExecutor.executeSell({
          positionId: position.id,
          network: position.network,
          wallet: position.wallet,
          mint: position.mint,
          amountRaw: position.tokenAmount,
          slippageBps,
          reason,
          clientRequestId: `exit_${position.mint.slice(0, 8)}_${Date.now()}_att${attempt}`,
        });
        lastResult = result;

        if (result.success) {
          const elapsedMs = Date.now() - startTime;
          this.recordAuditTrail(
            position.id,
            position.mint,
            'SELL_CONFIRMED',
            reason,
            `[SELL_CONFIRMED] On-chain sell confirmed in ${elapsedMs}ms. Signature: ${result.signature}`,
            { signature: result.signature, elapsedMs }
          );

          // Authoritatively close position ONLY upon verified on-chain confirmation
          positionManager.updatePositionStatus(position.network, position.wallet, position.mint, 'CLOSED', {
            exitSignature: result.signature,
            netProceedsSol: result.netProceedsSol,
          });

          this.recordAuditTrail(
            position.id,
            position.mint,
            'POSITION_CLOSED',
            reason,
            `[POSITION_CLOSED] Position closed authoritatively. Realized PnL: ${result.netProceedsSol !== undefined ? (result.netProceedsSol - position.totalSolSpent).toFixed(4) : 0} SOL.`,
            { netProceedsSol: result.netProceedsSol }
          );

          this.releaseExitLock(position.network, position.wallet, position.mint);
          return { success: true, signature: result.signature, result };
        }

        // Check if the transaction was broadcasted or entered ambiguous/recovery state
        if (result.signature || result.status === 'RECOVERY_REQUIRED' || result.isAmbiguous) {
          console.warn(`[UnifiedExitEngine] Sell broadcast or timed out (sig=${result.signature}). Retaining EXIT_PENDING status.`);
          positionManager.updatePositionStatus(position.network, position.wallet, position.mint, 'EXIT_PENDING', {
            exitSignature: result.signature,
          });
          positionRepository.updatePosition(position.id, {
            state: 'EXIT_REQUESTED',
            exitSignature: result.signature,
          });
          this.recordAuditTrail(
            position.id,
            position.mint,
            'SELL_FAILED',
            reason,
            `[SELL_BROADCAST_TIMEOUT] Transaction broadcasted (${result.signature}) but confirmation timed out. Status: EXIT_PENDING.`
          );
          // Do not release lock to prevent double sell
          return {
            success: false,
            signature: result.signature,
            error: result.error || 'CONFIRMATION_TIMEOUT: Sell broadcast but confirmation timed out',
            result,
          };
        }

        // Execution failed before broadcast
        const isTransient = result.error?.includes('QUOTE_UNAVAILABLE') || result.error?.includes('TIMEOUT') || result.error?.includes('SLIPPAGE');
        this.recordAuditTrail(
          position.id,
          position.mint,
          'SELL_RETRY',
          reason,
          `[TP_SL_RETRY: ${isTransient ? 'EXECUTABLE_QUOTE_UNAVAILABLE' : 'SELL_FAILED'}] Attempt ${attempt} failed: ${result.error}. Retrying...`
        );

        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 200 * attempt)); // Short backoff
        }
      } catch (err: any) {
        this.recordAuditTrail(
          position.id,
          position.mint,
          'SELL_RETRY',
          reason,
          `[TP_SL_RETRY: UNEXPECTED_ERROR] Unexpected error on attempt ${attempt}: ${err.message || err}. Retrying...`
        );
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 200 * attempt));
        }
      }
    }

    // All retries failed. NEVER blindly reopen: the transaction may have landed.
    // Leave the position in recovery so reconciliation can inspect the chain/order state.
    this.recordAuditTrail(
      position.id,
      position.mint,
      'SELL_FAILED',
      reason,
      `[SELL_FAILED] All ${maxRetries} sell attempts failed. Position moved to RECOVERY_REQUIRED; blockchain reconciliation is required before another sell.`
    );

    positionManager.updatePositionStatus(position.network, position.wallet, position.mint, 'RECOVERY_REQUIRED');
    positionRepository.updatePosition(position.id, { state: 'RECOVERY_REQUIRED' });

    this.releaseExitLock(position.network, position.wallet, position.mint);
    return {
      success: false,
      signature: lastResult?.signature,
      error: lastResult?.error || `[SELL_FAILED] All ${maxRetries} sell attempts failed.`,
      result: lastResult,
    };
  }

  /**
   * Public interface to execute a manual exit request.
   */
  public async executeManualExit(positionId: string): Promise<boolean> {
    const res = await this.executeManualExitDetail(positionId);
    return res.success;
  }

  public async executeManualExitDetail(positionId: string): Promise<{ success: boolean; signature?: string; error?: string; result?: any }> {
    const position = positionManager.getPositionById(positionId);
    if (!position || position.status !== 'OPEN') {
      return {
        success: false,
        error: position ? `Position in non-open status (${position.status})` : 'Position not found',
      };
    }

    if (!this.acquireExitLock(position.network, position.wallet, position.mint)) {
      return {
        success: false,
        error: 'EXIT_ALREADY_PENDING: Exit lock already held for this position',
      };
    }

    return this.authorizeAndExecuteWithRetry(position, 'MANUAL_EXIT', 'Manual exit requested by user.', 3);
  }

  /**
   * Event logging & Audit trail recorder
   */
  private recordAuditTrail(
    positionId: string,
    mint: string,
    event: AuditTrailEntry['event'],
    reason?: string,
    message?: string,
    metadata?: Record<string, any>
  ): void {
    const entry: AuditTrailEntry = {
      timestamp: Date.now(),
      positionId,
      mint,
      event,
      reason,
      message,
      metadata,
    };
    this.auditTrail.unshift(entry);
    
    // Cap in-memory audit logs at 1000 entries
    if (this.auditTrail.length > 1000) {
      this.auditTrail.pop();
    }

    console.log(`[UnifiedExitEngine] [AUDIT] [${event}] [pos=${positionId}] ${message || ''}`);
  }

  private recordGlobalLog(level: string, message: string): void {
    console.log(`[UnifiedExitEngine] [${level}] ${message}`);
  }

  public getAuditTrail(positionId?: string): AuditTrailEntry[] {
    if (positionId) {
      return this.auditTrail.filter(entry => entry.positionId === positionId);
    }
    return [...this.auditTrail];
  }
}

export const unifiedExitEngine = UnifiedExitEngine.getInstance();
