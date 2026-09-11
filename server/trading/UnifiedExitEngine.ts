// server/trading/UnifiedExitEngine.ts
import { Position, positionManager } from './PositionManager.js';
import { pnlEngine } from './PnLEngine.js';
import { criteriaRepository } from '../repositories/CriteriaRepository.js';
import { fastExitExecutor } from '../execution/FastExitExecutor.js';
import { positionRepository } from '../repositories/PositionRepository.js';
import { activePositionMarketFeed } from '../market/ActivePositionMarketFeed.js';
import { executionGateway } from '../execution/ExecutionGateway.js';
import { positionValuationEngine } from './PositionValuationEngine.js';
import { orderManager } from './OrderManager.js';
import { ExitPreCheckResult } from '../types/index.js';

export interface AuditTrailEntry {
  timestamp: number;
  positionId: string;
  mint: string;
  event: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'SYSTEM';
  message: string;
  metadata?: Record<string, any>;
}

export interface ExitDecision {
  shouldExit: boolean;
  reason: 'TP' | 'SL' | 'TRAILING_STOP' | 'MAX_HOLD' | 'MANUAL' | 'NONE';
  currentPnlPct: number;
  message: string;
}

export class UnifiedExitEngine {
  private static instance: UnifiedExitEngine;
  private isRunning: boolean = false;
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

  // ==========================================
  // LIFECYCLE
  // ==========================================

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // Start the ActivePositionMarketFeed which drives price updates and exit evaluations
    activePositionMarketFeed.start();

    console.log('[UnifiedExitEngine] Sole authoritative server-side Exit Engine active; ActivePositionMarketFeed owns market-event ingestion.');
    this.recordGlobalLog('SYSTEM', 'Exit Engine started successfully.');
  }

  public stop(): void {
    this.isRunning = false;
    activePositionMarketFeed.stop();
    console.log('[UnifiedExitEngine] Exit Engine stopped.');
    this.recordGlobalLog('SYSTEM', 'Exit Engine stopped.');
  }

  // ==========================================
  // EXIT LOCK MANAGEMENT
  // ==========================================

  public acquireExitLock(network: string, wallet: string, mint: string): boolean {
    const key = `${network}:${wallet}:${mint}`;
    if (this.exitLocks.has(key)) {
      console.warn(`[UnifiedExitEngine] EXIT LOCK ALREADY HELD for ${key}`);
      return false;
    }
    this.exitLocks.add(key);
    return true;
  }

  public releaseExitLock(network: string, wallet: string, mint: string): void {
    const key = `${network}:${wallet}:${mint}`;
    this.exitLocks.delete(key);
  }

  // ==========================================
  // EXIT EVALUATION (TP/SL/Trailing/MaxHold)
  // ==========================================

  public evaluatePositionExit(position: Position, marketPriceSol: number): ExitDecision {
    if (position.status !== 'OPEN') {
      return { shouldExit: false, reason: 'NONE', currentPnlPct: 0, message: `Position status is ${position.status}` };
    }

    const pnlMetrics = pnlEngine.calculatePnL(position, marketPriceSol);
    const currentPnlPct = pnlMetrics.unrealizedPnlPercent;

    // 1. Take Profit
    if (position.tpPct > 0 && currentPnlPct >= position.tpPct) {
      return {
        shouldExit: true,
        reason: 'TP',
        currentPnlPct,
        message: `Take Profit triggered: ${currentPnlPct.toFixed(2)}% >= ${position.tpPct}%`,
      };
    }

    // 2. Stop Loss
    if (position.slPct > 0 && currentPnlPct <= -position.slPct) {
      return {
        shouldExit: true,
        reason: 'SL',
        currentPnlPct,
        message: `Stop Loss triggered: ${currentPnlPct.toFixed(2)}% <= -${position.slPct}%`,
      };
    }

    // 3. Trailing Stop
    if (position.trailingSlPct && position.trailingSlPct > 0 && position.peakPrice > 0) {
      const drawdownFromPeak = ((position.peakPrice - marketPriceSol) / position.peakPrice) * 100;
      if (drawdownFromPeak >= position.trailingSlPct) {
        return {
          shouldExit: true,
          reason: 'TRAILING_STOP',
          currentPnlPct,
          message: `Trailing Stop triggered: ${drawdownFromPeak.toFixed(2)}% drawdown from peak >= ${position.trailingSlPct}%`,
        };
      }
    }

    // 4. Max Hold Time
    if (position.maxHoldTimeMs && position.maxHoldTimeMs > 0 && position.openedAt) {
      const holdDuration = Date.now() - position.openedAt;
      if (holdDuration >= position.maxHoldTimeMs) {
        return {
          shouldExit: true,
          reason: 'MAX_HOLD',
          currentPnlPct,
          message: `Max Hold Time exceeded: ${holdDuration}ms >= ${position.maxHoldTimeMs}ms`,
        };
      }
    }

    return { shouldExit: false, reason: 'NONE', currentPnlPct, message: 'No exit condition met' };
  }

  // ==========================================
  // EXIT PRE-CHECK (Fail-Closed)
  // ==========================================

  public async performExitPreCheck(
    position: Position,
    opts: { preValidatedQuote?: any } = {}
  ): Promise<ExitPreCheckResult> {
    const makeResult = (valid: boolean, reason: string, pos?: Position, quote?: any): ExitPreCheckResult => ({
      valid,
      mint: pos?.mint || position.mint,
      marketPriceSol: pos?.currentPrice || position.currentPrice || 0,
      executablePriceSol: quote?.executablePriceSol || pos?.currentPrice || position.currentPrice || 0,
      priceDivergencePct: 0,
      routeAvailable: valid,
      rawBalance: pos?.tokenAmountRaw || position.tokenAmountRaw || '0',
      quote,
      reason,
      timestamp: Date.now(),
    });

    try {
      // 1. Verify position is still open
      const currentPos = positionManager.getPositionById(position.id);
      if (!currentPos || currentPos.status === 'CLOSED') {
        return makeResult(false, 'POSITION_ALREADY_CLOSED');
      }
      if (currentPos.status === 'EXIT_REQUESTED' || currentPos.status === 'EXIT_SUBMITTED' || currentPos.status === 'EXIT_CONFIRMING' || currentPos.status === 'RECOVERY_REQUIRED') {
        return makeResult(false, `POSITION_IN_TERMINAL_STATE: ${currentPos.status}`, currentPos);
      }

      // 2. Verify token amount is positive
      const rawAmount = BigInt(currentPos.tokenAmountRaw || '0');
      if (rawAmount <= 0n) {
        return makeResult(false, 'ZERO_TOKEN_BALANCE', currentPos);
      }

      // 3. Verify network executor exists
      const executor = executionGateway.getExecutor(currentPos.network);
      if (!executor) {
        return makeResult(false, `NO_EXECUTOR_FOR_NETWORK: ${currentPos.network}`, currentPos);
      }

      // 4. Verify quote freshness (if pre-validated quote provided)
      if (opts.preValidatedQuote) {
        const quoteAge = Date.now() - (opts.preValidatedQuote.timestamp || 0);
        if (quoteAge > 10000) {
          return makeResult(false, `STALE_QUOTE: ${quoteAge}ms old`, currentPos);
        }
      }

      return makeResult(true, 'PRE_CHECK_PASSED', currentPos, opts.preValidatedQuote);
    } catch (err: any) {
      return makeResult(false, `PRE_CHECK_ERROR: ${err?.message || String(err)}`);
    }
  }

  // ==========================================
  // AUTOMATED EXIT (TP/SL/Trailing/MaxHold)
  // ==========================================

  public async evaluateAndExecuteExit(
    position: Position,
    marketPriceSol: number,
    opts: { maxDataAgeMs?: number } = {}
  ): Promise<{ success: boolean; signature?: string; error?: string; reason?: string }> {
    if (!this.isRunning) {
      return { success: false, error: 'EXIT_ENGINE_NOT_RUNNING' };
    }

    // Evaluate exit conditions
    const exitDecision = this.evaluatePositionExit(position, marketPriceSol);
    if (!exitDecision.shouldExit) {
      return { success: false, error: 'NO_EXIT_CONDITION_MET', reason: exitDecision.reason };
    }

    // Acquire exit lock to prevent concurrent exits
    if (!this.acquireExitLock(position.network, position.wallet, position.mint)) {
      return { success: false, error: 'EXIT_LOCK_ALREADY_HELD' };
    }

    try {
      return await this.executeExitWithRetry(position, exitDecision.reason, exitDecision.message);
    } finally {
      this.releaseExitLock(position.network, position.wallet, position.mint);
    }
  }

  // ==========================================
  // MANUAL EXIT
  // ==========================================

  public async executeManualExitDetail(
    positionId: string
  ): Promise<{ success: boolean; signature?: string; error?: string; result?: any }> {
    const position = positionManager.getPositionById(positionId);
    if (!position) {
      return { success: false, error: `POSITION_NOT_FOUND: ${positionId}` };
    }
    if (position.status === 'CLOSED') {
      return { success: false, error: 'POSITION_ALREADY_CLOSED' };
    }
    if (position.status === 'EXIT_REQUESTED' || position.status === 'EXIT_SUBMITTED' || position.status === 'EXIT_CONFIRMING') {
      return { success: false, error: 'EXIT_ALREADY_PENDING' };
    }

    if (!this.acquireExitLock(position.network, position.wallet, position.mint)) {
      return { success: false, error: 'EXIT_LOCK_ALREADY_HELD' };
    }

    try {
      return await this.executeExitWithRetry(position, 'MANUAL', 'Manual exit triggered');
    } finally {
      this.releaseExitLock(position.network, position.wallet, position.mint);
    }
  }

  // ==========================================
  // CORE EXIT EXECUTION WITH RETRY
  // ==========================================

  public async authorizeAndExecuteWithRetry(
    position: Position,
    reason: string,
    message: string,
    maxRetries: number = 3,
    preValidatedQuote?: any
  ): Promise<{ success: boolean; signature?: string; error?: string; result?: any }> {
    return this.executeExitWithRetry(position, reason as any, message, maxRetries, preValidatedQuote);
  }

  private async executeExitWithRetry(
    position: Position,
    reason: ExitDecision['reason'] | string,
    message: string,
    maxRetries: number = 3,
    preValidatedQuote?: any
  ): Promise<{ success: boolean; signature?: string; error?: string; result?: any }> {
    const startTime = Date.now();
    console.log(`[UnifiedExitEngine][EXIT_AUTHORIZED] position=${position.id} mint=${position.mint} reason=${reason}: ${message}`);

    // Mandatory Invariant: Exit Pre-Check must pass before execution
    const preCheck = await this.performExitPreCheck(position, { preValidatedQuote });
    if (!preCheck.valid) {
      this.recordAudit(position.id, position.mint, 'WARN', `EXIT_PRECHECK_FAILED: ${preCheck.reason}`);
      return { success: false, error: `EXIT_PRECHECK_FAILED: ${preCheck.reason}` };
    }

    // Mark position as EXIT_REQUESTED
    positionManager.updatePositionStatus(position.network, position.wallet, position.mint, 'EXIT_REQUESTED');
    this.recordAudit(position.id, position.mint, 'INFO', `EXIT_REQUESTED: ${reason}`);

    let lastError = '';
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[UnifiedExitEngine] Exit attempt ${attempt}/${maxRetries} for ${position.mint}`);

        const executor = executionGateway.getExecutor(position.network);
        if (!executor) {
          throw new Error(`NO_EXECUTOR_FOR_NETWORK: ${position.network}`);
        }

        // Execute sell via FastExitExecutor
        const sellResult = await fastExitExecutor.executeSell({
          positionId: position.id,
          network: position.network,
          wallet: position.wallet,
          mint: position.mint,
          amountRaw: position.tokenAmountRaw,
          slippageBps: position.slippageBpsSl || 500,
          reason: String(reason),
          clientRequestId: `exit_${position.id}_${attempt}_${Date.now()}`,
          preValidatedQuote,
        });

        if (sellResult.success) {
          // Update position with exit details
          const netProceedsSol = sellResult.netProceedsSol || 0;
          positionManager.updatePositionStatus(
            position.network,
            position.wallet,
            position.mint,
            'CLOSED',
            {
              exitSignature: sellResult.signature,
              netProceedsSol,
            }
          );

          // FIX: Purge valuation record to prevent stale state (Fix #2 from audit)
          positionValuationEngine.removeValuation(position.network, position.wallet, position.mint);

          this.recordAudit(position.id, position.mint, 'INFO',
            `EXIT_CONFIRMED: reason=${reason} signature=${sellResult.signature} proceeds=${netProceedsSol} SOL duration=${Date.now() - startTime}ms`);

          console.log(`[UnifiedExitEngine] EXIT CONFIRMED for ${position.mint}: signature=${sellResult.signature}`);
          return { success: true, signature: sellResult.signature, result: sellResult };
        } else {
          lastError = sellResult.error || 'SELL_EXECUTION_FAILED';
          this.recordAudit(position.id, position.mint, 'WARN',
            `EXIT_ATTEMPT_${attempt}_FAILED: ${lastError}`);
        }
      } catch (err: any) {
        lastError = err?.message || String(err);
        this.recordAudit(position.id, position.mint, 'ERROR',
          `EXIT_ATTEMPT_${attempt}_ERROR: ${lastError}`);
        console.error(`[UnifiedExitEngine] Exit attempt ${attempt} error for ${position.mint}:`, lastError);
      }

      // Wait before retry (exponential backoff)
      if (attempt < maxRetries) {
        const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }

    // All retries exhausted — mark as RECOVERY_REQUIRED
    positionManager.updatePositionStatus(position.network, position.wallet, position.mint, 'RECOVERY_REQUIRED');
    this.recordAudit(position.id, position.mint, 'ERROR',
      `EXIT_ALL_RETRIES_EXHAUSTED: ${lastError}. Position marked RECOVERY_REQUIRED.`);

    return { success: false, error: `EXIT_FAILED_AFTER_${maxRetries}_RETRIES: ${lastError}` };
  }

  // ==========================================
  // AUDIT TRAIL
  // ==========================================

  private recordAudit(positionId: string, mint: string, level: AuditTrailEntry['level'], message: string): void {
    this.auditTrail.push({
      timestamp: Date.now(),
      positionId,
      mint,
      event: 'EXIT_LIFECYCLE',
      level,
      message,
    });
    // Cap audit trail at 5000 entries
    if (this.auditTrail.length > 5000) {
      this.auditTrail = this.auditTrail.slice(-5000);
    }
    console.log(`[UnifiedExitEngine][${level}] ${message}`);
  }

  private recordGlobalLog(level: string, message: string): void {
    console.log(`[UnifiedExitEngine][${level}] ${message}`);
  }

  public getAuditTrail(positionId?: string): AuditTrailEntry[] {
    if (positionId) {
      return this.auditTrail.filter(entry => entry.positionId === positionId);
    }
    return [...this.auditTrail];
  }
}

export const unifiedExitEngine = UnifiedExitEngine.getInstance();
