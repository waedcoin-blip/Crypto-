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
    currentPriceSol: number
  ): Promise<ExitDecision> {
    if (position.status !== 'OPEN') {
      return { shouldExit: false, message: `Position status is ${position.status}, not OPEN` };
    }

    const pnl = pnlEngine.calculatePnL(position, currentPriceSol);
    const criteria = criteriaRepository.getActiveCriteriaSync() as any;

    // Gross PnL percentage calculation (market price vs entry price)
    const grossPnlPct = position.averageEntryPrice > 0
      ? ((currentPriceSol - position.averageEntryPrice) / position.averageEntryPrice) * 100
      : pnl.unrealizedPnlPercent;

    // Load configurations from position or criteria (Standardized: positive magnitude for SL)
    const tpThreshold = position.tpPct !== undefined ? Math.abs(position.tpPct) : (criteria.minTakeProfit || 25);
    const slThreshold = position.slPct !== undefined ? -Math.abs(position.slPct) : -(Math.abs(criteria.stopLoss || 15));

    // Trailing stop loss configuration
    const trailingEnabled = criteria.trailingEnabled ?? true;
    const trailingStopPercent = criteria.trailingStopPercent ?? 5;
    const trailingActivationPercent = criteria.trailingActivationPercent ?? 10;

    // 1. Check Max Hold Time (EMERGENCY_EXIT)
    if (position.maxHoldTimeMs && position.maxHoldTimeMs > 0) {
      const heldMs = Date.now() - position.openedAt;
      if (heldMs >= position.maxHoldTimeMs) {
        return {
          shouldExit: true,
          reason: 'EMERGENCY_EXIT',
          executablePnlPct: grossPnlPct,
          message: `[EXIT_MONITOR] Max hold time exceeded (${(heldMs / 1000).toFixed(0)}s >= ${(position.maxHoldTimeMs / 1000).toFixed(0)}s)`,
        };
      }
    }

    // 2. Check Stop Loss threshold (STOP_LOSS)
    if (grossPnlPct <= slThreshold) {
      return {
        shouldExit: true,
        reason: 'STOP_LOSS',
        executablePnlPct: grossPnlPct,
        message: `[SL_TRIGGERED] Stop loss triggered: ${grossPnlPct.toFixed(2)}% <= ${slThreshold.toFixed(2)}%`,
      };
    }

    // 3. Check Take Profit threshold (TAKE_PROFIT)
    if (grossPnlPct >= tpThreshold) {
      return {
        shouldExit: true,
        reason: 'TAKE_PROFIT',
        executablePnlPct: grossPnlPct,
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
          message: `[TRAILING_STOP] Trailing stop triggered: peak +${position.highestPnlPct.toFixed(2)}%, dropped by ${dropFromPeak.toFixed(2)}% >= ${trailingStopPercent}%`,
        };
      }
    }

    return { shouldExit: false };
  }

  /**
   * Main driver to evaluate and execute exits atomically.
   */
  public async evaluateAndExecuteExit(position: Position, priceSol: number): Promise<boolean> {
    const lockKey = `${position.network}:${position.wallet}:${position.mint.toLowerCase()}`;
    if (this.exitLocks.has(lockKey)) {
      return false; // Exit process already ongoing
    }

    const decision = await this.evaluatePositionExit(position, priceSol);
    if (!decision.shouldExit || !decision.reason) return false;

    // Acquire atomic lock
    if (!this.acquireExitLock(position.network, position.wallet, position.mint)) {
      return false;
    }

    return this.authorizeAndExecuteWithRetry(position, decision.reason, decision.message || '', 3);
  }

  /**
   * Authorizes and executes exit with fast retry loop on transient execution failures.
   */
  private async authorizeAndExecuteWithRetry(
    position: Position,
    reason: string,
    message: string,
    maxRetries: number = 3
  ): Promise<boolean> {
    const startTime = Date.now();
    console.log(`[UnifiedExitEngine] [EXIT_AUTHORIZED] position=${position.id} mint=${position.mint} reason=${reason}: ${message}`);

    // Update position status to EXIT_PENDING to lock out duplicate triggers
    positionManager.updatePositionStatus(position.network, position.wallet, position.mint, 'EXIT_PENDING');
    positionRepository.updatePosition(position.id, { state: 'EXIT_REQUESTED' });

    this.recordAuditTrail(position.id, position.mint, 'EXIT_TRIGGERED', reason, message);
    this.recordAuditTrail(position.id, position.mint, 'EXIT_AUTHORIZED', reason, `Authorized for 100% exit execution.`);

    let attempt = 0;
    const slippageBps = reason === 'TAKE_PROFIT' ? position.slippageBpsTp : position.slippageBpsSl;

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
          return true;
        }

        // Execution failed
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

    // All retries failed
    this.recordAuditTrail(
      position.id,
      position.mint,
      'SELL_FAILED',
      reason,
      `[SELL_FAILED] All ${maxRetries} sell attempts failed. Reverting position state to OPEN for failsafe reconciliation.`
    );

    positionManager.updatePositionStatus(position.network, position.wallet, position.mint, 'OPEN');
    positionRepository.updatePosition(position.id, { state: 'OPEN' });

    this.releaseExitLock(position.network, position.wallet, position.mint);
    return false;
  }

  /**
   * Public interface to execute a manual exit request.
   */
  public async executeManualExit(positionId: string): Promise<boolean> {
    const position = positionManager.getPositionById(positionId);
    if (!position || position.status !== 'OPEN') {
      return false;
    }

    if (!this.acquireExitLock(position.network, position.wallet, position.mint)) {
      return false; // Exit is already locked/running
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
