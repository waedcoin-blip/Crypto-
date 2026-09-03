// server/trading/UnifiedExitEngine.ts
import { marketEventBus } from '../market/MarketEventBus.js';
import { MarketEvent } from '../market/EventNormalizer.js';
import { Position, positionManager } from './PositionManager.js';
import { pnlEngine } from './PnLEngine.js';
import { criteriaRepository } from '../repositories/CriteriaRepository.js';
import { fastExitExecutor } from '../execution/FastExitExecutor.js';
import { positionRepository } from '../repositories/PositionRepository.js';

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
  event: 'EXIT_EVALUATED' | 'EXIT_TRIGGERED' | 'EXIT_AUTHORIZED' | 'SELL_SUBMITTED' | 'SELL_CONFIRMED' | 'SELL_FAILED' | 'POSITION_CLOSED';
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
   * Starts the UnifiedExitEngine and subscribes to the MarketEventBus for real-time triggers.
   */
  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // Subscribe to MarketEventBus
    this.unsubscribeBus = marketEventBus.subscribe((event: MarketEvent) => {
      this.onMarketEvent(event).catch(err => {
        console.error('[UnifiedExitEngine] Error handling market event:', err);
      });
    });

    console.log('[UnifiedExitEngine] Authorized server-side Exit Engine active and subscribed to MarketEventBus.');
    this.recordGlobalLog('SYSTEM', 'Exit Engine started successfully.');
  }

  public stop(): void {
    this.isRunning = false;
    if (this.unsubscribeBus) {
      this.unsubscribeBus();
      this.unsubscribeBus = null;
    }
    console.log('[UnifiedExitEngine] Stopped.');
  }

  /**
   * Main real-time handler for streaming market updates.
   */
  private async onMarketEvent(event: MarketEvent): Promise<void> {
    if (!this.isRunning) return;

    // Use event.mint to find any active open position
    const mint = event.mint || (event as any).candidateMint;
    if (!mint) return;

    const openPositions = positionManager.getOpenPositions();
    const position = openPositions.find(p => p.mint.toLowerCase() === mint.toLowerCase());
    
    if (!position || position.status !== 'OPEN') return;

    // Determine the current price in SOL
    let priceSol = event.price;
    if (!priceSol || priceSol <= 0) {
      // If price is not explicitly in the event, trigger re-evaluation using position manager's tracked price
      priceSol = position.currentPriceSol;
    }

    if (!priceSol || priceSol <= 0) return;

    // Update position price and recalculate PnL in the repository
    positionManager.updatePositionPrice(position.network, position.wallet, position.mint, priceSol);

    // Evaluate exit
    await this.evaluateAndExecuteExit(position, priceSol);
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

    // Load configurations from position or criteria
    const tpThreshold = position.tpPct !== undefined ? position.tpPct : (criteria.minTakeProfit || 25);
    const slThreshold = position.slPct !== undefined ? -Math.abs(position.slPct) : -(Math.abs(criteria.stopLoss || 15));

    // Trailing stop loss configuration
    const trailingEnabled = criteria.trailingEnabled ?? true;
    const trailingStopPercent = criteria.trailingStopPercent ?? 5;
    const trailingActivationPercent = criteria.trailingActivationPercent ?? 10;

    // 1. Check Max Hold Time (EMERGENCY_EXIT / MAX_HOLD)
    if (position.maxHoldTimeMs && position.maxHoldTimeMs > 0) {
      const heldMs = Date.now() - position.openedAt;
      if (heldMs >= position.maxHoldTimeMs) {
        return {
          shouldExit: true,
          reason: 'EMERGENCY_EXIT',
          message: `Max hold time exceeded (${(heldMs / 1000).toFixed(0)}s >= ${(position.maxHoldTimeMs / 1000).toFixed(0)}s)`,
        };
      }
    }

    // 2. Check Stop Loss threshold (STOP_LOSS)
    if (pnl.unrealizedPnlPercent <= slThreshold) {
      return {
        shouldExit: true,
        reason: 'STOP_LOSS',
        executablePnlPct: pnl.unrealizedPnlPercent,
        message: `Stop loss triggered: ${pnl.unrealizedPnlPercent.toFixed(2)}% <= ${slThreshold.toFixed(2)}%`,
      };
    }

    // 3. Check Take Profit threshold (TAKE_PROFIT)
    // Note: No partial take-profit! Any TP triggers a 100% position sell.
    if (pnl.unrealizedPnlPercent >= tpThreshold) {
      return {
        shouldExit: true,
        reason: 'TAKE_PROFIT',
        executablePnlPct: pnl.unrealizedPnlPercent,
        message: `Take profit triggered: +${pnl.unrealizedPnlPercent.toFixed(2)}% >= +${tpThreshold.toFixed(2)}% (100% full exit)`,
      };
    }

    // 4. Check Trailing Stop (TRAILING_STOP)
    if (trailingEnabled && position.highestPnlPct >= trailingActivationPercent) {
      const dropFromPeak = position.highestPnlPct - pnl.unrealizedPnlPercent;
      if (dropFromPeak >= trailingStopPercent) {
        return {
          shouldExit: true,
          reason: 'TRAILING_STOP',
          executablePnlPct: pnl.unrealizedPnlPercent,
          message: `Trailing stop triggered: peak +${position.highestPnlPct.toFixed(2)}%, dropped by ${dropFromPeak.toFixed(2)}% >= ${trailingStopPercent}%`,
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

    // Acquire lock and authorize exit
    if (!this.acquireExitLock(position.network, position.wallet, position.mint)) {
      return false;
    }

    return this.authorizeAndExecute(position, decision.reason, decision.message || '');
  }

  /**
   * Triggers an authorized exit command via FastExitExecutor.
   */
  private async authorizeAndExecute(
    position: Position,
    reason: string,
    message: string
  ): Promise<boolean> {
    const startTime = Date.now();
    console.log(`[UnifiedExitEngine] [AUTHORIZE_EXIT] position=${position.id} mint=${position.mint} reason=${reason}: ${message}`);

    // Update position status to EXIT_PENDING to lock out any other triggers
    positionManager.updatePositionStatus(position.network, position.wallet, position.mint, 'EXIT_PENDING');
    positionRepository.updatePosition(position.id, { state: 'EXIT_REQUESTED' });

    this.recordAuditTrail(position.id, position.mint, 'EXIT_TRIGGERED', reason, message);
    this.recordAuditTrail(position.id, position.mint, 'EXIT_AUTHORIZED', reason, `Authorized for fast execution.`);

    try {
      this.recordAuditTrail(position.id, position.mint, 'SELL_SUBMITTED', reason, `Submitting sell order for ${position.tokenAmount} tokens.`);
      
      const slippageBps = reason === 'TAKE_PROFIT' ? position.slippageBpsTp : position.slippageBpsSl;

      // Delegate pure execution to FastExitExecutor
      const result = await fastExitExecutor.executeSell({
        positionId: position.id,
        network: position.network,
        wallet: position.wallet,
        mint: position.mint,
        amountRaw: position.tokenAmount,
        slippageBps,
        reason,
        clientRequestId: `exit_${position.mint.slice(0, 8)}_${Date.now()}`,
      });

      if (result.success) {
        this.recordAuditTrail(
          position.id,
          position.mint,
          'SELL_CONFIRMED',
          reason,
          `On-chain sell confirmed. Sig: ${result.signature}`,
          { signature: result.signature, elapsedMs: Date.now() - startTime }
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
          `Position closed in local registry and database. Net Proceeds: ${result.netProceedsSol} SOL.`,
          { netProceedsSol: result.netProceedsSol }
        );

        this.releaseExitLock(position.network, position.wallet, position.mint);
        return true;
      } else {
        this.recordAuditTrail(
          position.id,
          position.mint,
          'SELL_FAILED',
          reason,
          `On-chain sell failed: ${result.error || 'Unknown error'}`
        );

        // Revert status to OPEN to allow retries
        positionManager.updatePositionStatus(position.network, position.wallet, position.mint, 'OPEN');
        positionRepository.updatePosition(position.id, { state: 'OPEN' });
        
        this.releaseExitLock(position.network, position.wallet, position.mint);
        return false;
      }
    } catch (err: any) {
      this.recordAuditTrail(
        position.id,
        position.mint,
        'SELL_FAILED',
        reason,
        `Unexpected error during sell execution: ${err.message || err}`
      );

      // Revert status to OPEN
      positionManager.updatePositionStatus(position.network, position.wallet, position.mint, 'OPEN');
      positionRepository.updatePosition(position.id, { state: 'OPEN' });

      this.releaseExitLock(position.network, position.wallet, position.mint);
      return false;
    }
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

    return this.authorizeAndExecute(position, 'MANUAL_EXIT', 'Manual exit requested by user.');
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
