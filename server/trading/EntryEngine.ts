// server/trading/EntryEngine.ts
import { MarketEvent } from '../market/EventNormalizer.js';
import { marketEventBus } from '../market/MarketEventBus.js';
import { candidateEnricher, EnrichedCandidate } from './CandidateEnricher.js';
import { opportunityScorer, OpportunityScoreBreakdown } from './OpportunityScorer.js';
import { serverEntryGate, ServerEntryDecision } from './ServerEntryGate.js';
import { hardenedCriteriaEngine } from './HardenedCriteriaEngine.js';
import { tradingEngine, TradeEngineResponse } from './TradingEngine.js';
import { entryDecisionLedger, EntryDiagnosticsReport } from './EntryDecisionLedger.js';
import { criteriaRepository } from '../repositories/CriteriaRepository.js';
import { CriteriaConfig } from '../services/criteriaService.js';
import { tokenDiscovery } from '../market/TokenDiscovery.js';
import { laserStreamPipeline } from '../market/LaserStreamPipeline.js';
import { bondingCurveFastLane } from './BondingCurveFastLane.js';
import { migrationDetector } from './MigrationDetector.js';
import { candidateRegistry } from '../market/CandidateRegistry.js';
import { laserstreamSignalEngine, marketDataAggregator } from './LaserstreamSignalEngine.js';

export type PipelineStage =
  | 'DISCOVERED'
  | 'ENRICHING'
  | 'READY_FOR_EVALUATION'
  | 'BUY_SIGNAL'
  | 'BUY_LOCKED'
  | 'BUY_SUBMITTED'
  | 'BUY_CONFIRMED'
  | 'POSITION_OPEN'
  | 'REJECTED'
  | 'BUY_FAILED';

export interface EntryEvaluationResult {
  mintAddress: string;
  symbol: string;
  stage: PipelineStage;
  enrichedCandidate?: EnrichedCandidate;
  scoreBreakdown?: OpportunityScoreBreakdown;
  decision?: ServerEntryDecision;
  tradeResponse?: TradeEngineResponse;
  status: 'PROCESSED' | 'SKIPPED' | 'FAILED';
  error?: string;
}

export class EntryEngine {
  private static instance: EntryEngine;
  private isRunning: boolean = false;
  private autoSniperEnabled: boolean = false;
  private isLiveTrading: boolean = false;
  private targetNetwork: string = 'paper';
  private defaultWallet: string = 'default';
  private activeEvaluationLocks: Map<string, Promise<EntryEvaluationResult>> = new Map();

  private constructor() {
    this.autoSniperEnabled = process.env.AUTO_SNIPER_ENABLED === 'true';
    this.isLiveTrading = process.env.IS_LIVE_TRADING === 'true';
    this.targetNetwork = process.env.DEFAULT_NETWORK || (this.isLiveTrading ? 'mainnet' : 'paper');
  }

  public static getInstance(): EntryEngine {
    if (!EntryEngine.instance) {
      EntryEngine.instance = new EntryEngine();
    }
    return EntryEngine.instance;
  }

  // ==========================================
  // LIFECYCLE
  // ==========================================

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // Subscribe to market events for automated entry evaluation
    marketEventBus.subscribeUnified((event: any) => {
      if (!this.isRunning || !this.autoSniperEnabled) return;
      this.handleMarketEvent(event).catch(err => {
        console.error(`[EntryEngine] Unhandled event error for ${event?.mint}:`, err);
      });
    });

    console.log(`[EntryEngine] Started. Network=${this.targetNetwork} Live=${this.isLiveTrading} AutoSniper=${this.autoSniperEnabled}`);
  }

  public stop(): void {
    this.isRunning = false;
    this.activeEvaluationLocks.clear();
    console.log('[EntryEngine] Stopped.');
  }

  public setConfig(config: {
    autoSniperEnabled?: boolean;
    isLiveTrading?: boolean;
    network?: string;
    wallet?: string;
  }): void {
    if (config.autoSniperEnabled !== undefined) this.autoSniperEnabled = config.autoSniperEnabled;
    if (config.isLiveTrading !== undefined) this.isLiveTrading = config.isLiveTrading;
    if (config.network !== undefined) this.targetNetwork = config.network;
    if (config.wallet !== undefined) this.defaultWallet = config.wallet;
  }

  public getConfig(): any {
    return {
      autoSniperEnabled: this.autoSniperEnabled,
      isLiveTrading: this.isLiveTrading,
      network: this.targetNetwork,
      wallet: this.defaultWallet,
      isRunning: this.isRunning,
      activeEvaluations: this.activeEvaluationLocks.size,
    };
  }

  public getDiagnostics(): EntryDiagnosticsReport {
    return entryDecisionLedger.getDiagnostics({
      autoSniperEnabled: this.autoSniperEnabled,
      isLiveTrading: this.isLiveTrading,
      network: this.targetNetwork,
    });
  }

  // ==========================================
  // MARKET EVENT HANDLER
  // ==========================================

  private async handleMarketEvent(event: any): Promise<void> {
    if (!event.mint || !this.autoSniperEnabled) return;

    // Skip if already evaluating this mint
    if (this.activeEvaluationLocks.has(event.mint)) return;

    // Skip if candidate is already in a position
    const existingPosition = (await import('./PositionManager.js')).positionManager
      .getPosition(this.targetNetwork, this.defaultWallet, event.mint);
    if (existingPosition && existingPosition.status !== 'CLOSED') return;

    await this.evaluateAndTrade(event.mint, (event as any).source || 'MARKET_EVENT');
  }

  // ==========================================
  // CORE PIPELINE: evaluateAndTrade
  // ==========================================

  public async evaluateAndTrade(mint: string, triggerSource: string = 'MANUAL'): Promise<EntryEvaluationResult> {
    const trimmedMint = mint.trim();
    const network = this.targetNetwork;
    const wallet = this.defaultWallet;
    const lockKey = `${network}:${wallet}:${trimmedMint}`;

    // Atomic lock: prevent multiple concurrent evaluations and buys for the same mint
    if (this.activeEvaluationLocks.has(lockKey)) {
      console.log(`[EntryEngine] Atomic lock blocked concurrent evaluation for ${trimmedMint}`);
      return {
        mintAddress: trimmedMint,
        symbol: trimmedMint.slice(0, 6).toUpperCase(),
        stage: 'REJECTED',
        status: 'SKIPPED',
        error: 'ATOMIC_LOCK_CONCURRENT_EVALUATION_BLOCKED',
      };
    }

    const evaluationPromise = this.executePipeline(trimmedMint, network, wallet, triggerSource);
    this.activeEvaluationLocks.set(lockKey, evaluationPromise);

    try {
      return await evaluationPromise;
    } catch (err: any) {
      // FIX: Top-level error boundary prevents unhandled rejections
      const errorMsg = err?.message || String(err);
      console.error(`[EntryEngine] PIPELINE ERROR for ${trimmedMint}: ${errorMsg}`, err);
      return {
        mintAddress: trimmedMint,
        symbol: trimmedMint.slice(0, 6).toUpperCase(),
        stage: 'REJECTED',
        status: 'FAILED',
        error: `PIPELINE_ERROR: ${errorMsg}`,
      };
    } finally {
      this.activeEvaluationLocks.delete(lockKey);
    }
  }

  private async executePipeline(
    mint: string,
    network: string,
    wallet: string,
    triggerSource: string
  ): Promise<EntryEvaluationResult> {
    const src = triggerSource.toUpperCase();

    // 1. Check if candidate is eligible for evaluation
    const canAttempt = candidateRegistry.canAttemptBuy(network, wallet, mint);
    if (!canAttempt.allowed) {
      return {
        mintAddress: mint,
        symbol: mint.slice(0, 6).toUpperCase(),
        stage: 'REJECTED',
        status: 'SKIPPED',
        error: `CANDIDATE_REGISTRY_BLOCK: ${canAttempt.reason}`,
      };
    }

    // 2. Enrich candidate with market data
    console.log(`[PIPELINE STAGE] CandidateEnricher ENRICHING mint=${mint} source=${src}`);
    let candidate: EnrichedCandidate;
    try {
      candidate = await candidateEnricher.enrichCandidateWithRetry(mint, network);
    } catch (err: any) {
      return {
        mintAddress: mint,
        symbol: mint.slice(0, 6).toUpperCase(),
        stage: 'REJECTED',
        status: 'FAILED',
        error: `ENRICHMENT_FAILED: ${err?.message || String(err)}`,
      };
    }

    if (!candidate.isEnriched && network !== 'paper') {
      return {
        mintAddress: mint,
        symbol: candidate.symbol || mint.slice(0, 6).toUpperCase(),
        stage: 'REJECTED',
        status: 'SKIPPED',
        error: 'ENRICHMENT_DATA_UNAVAILABLE',
        enrichedCandidate: candidate,
      };
    }

    console.log(`[PIPELINE STAGE] CandidateEnricher COMPLETE mint=${mint} symbol=${candidate.symbol} dexId=${candidate.dexId}`);

    // 3. Load active criteria (fetch once to avoid redundant I/O)
    let activeCriteria: Partial<CriteriaConfig> = {};
    try {
      const repoCriteria = criteriaRepository.getActiveCriteriaSync() as any;
      activeCriteria = repoCriteria || {};
    } catch {
      activeCriteria = {};
    }

    // 4. Score the opportunity
    const scoreBreakdown = opportunityScorer.scoreCandidate(candidate);

    console.log(`[PIPELINE STAGE] OpportunityScorer SCORED mint=${mint} score=${scoreBreakdown.totalScore}/100 action=${scoreBreakdown.recommendedAction}`);

    // 5. Evaluate via Authoritative HardenedCriteriaEngine
    console.log(`[PIPELINE STAGE] HardenedCriteriaEngine EVALUATING mint=${mint}`);
    const evalResult = await hardenedCriteriaEngine.evaluateCandidate(candidate, {
      network,
      wallet,
      criteria: activeCriteria,
      autoSniperEnabled: this.autoSniperEnabled,
    });

    const decision: ServerEntryDecision = {
      allowed: evalResult.decision === 'PASS' && !!evalResult.approval,
      decision: evalResult.decision === 'PASS' ? 'CRITERIA_PASSED' : 'CRITERIA_FAILED',
      mintAddress: mint,
      symbol: candidate.symbol,
      buyAmountSol: evalResult.buyAmountSol,
      blockingReasons: evalResult.rejectionReasons,
      evaluatedAt: Date.now(),
      candidateId: mint,
    };

    console.log(`[PIPELINE STAGE] HardenedCriteriaEngine DECISION mint=${mint} allowed=${decision.allowed} blockingReasons=${JSON.stringify(decision.blockingReasons)}`);

    // 6. Record telemetry
    entryDecisionLedger.recordDecision(decision, scoreBreakdown, candidate.dataSource);

    // 7. If blocked, return early
    if (!decision.allowed) {
      return {
        mintAddress: mint,
        symbol: candidate.symbol,
        stage: 'REJECTED',
        enrichedCandidate: candidate,
        scoreBreakdown,
        decision,
        status: 'PROCESSED',
        error: decision.blockingReasons.join(', '),
      };
    }

    // NEW: Check Technical Analysis Signal
    console.log(`[PIPELINE STAGE] LaserstreamSignalEngine EVALUATING mint=${mint}`);
    const ohlcvData = await marketDataAggregator.getRecentOHLCV(mint, 50, candidate.priceUsd?.value || 1.0);
    const taSignal = laserstreamSignalEngine.evaluate(ohlcvData.closes, ohlcvData.volumes, ohlcvData.highs, ohlcvData.lows, network === 'paper');

    if (taSignal.action !== 'BUY') {
      console.log(`[PIPELINE STAGE] LaserstreamSignalEngine REJECTED mint=${mint} reason=${taSignal.reason}`);
      return {
        mintAddress: mint,
        symbol: candidate.symbol,
        stage: 'REJECTED',
        status: 'SKIPPED',
        error: `TA_SIGNAL_REJECTED: ${taSignal.reason}`,
      };
    }

    console.log(`[PIPELINE STAGE] LaserstreamSignalEngine PASSED mint=${mint} action=${taSignal.action} confidence=${taSignal.confidence}`);

    // If TA passes, inject the dynamic TP/SL into the buy parameters
    const dynamicTpPct = taSignal.takeProfitPct || activeCriteria.minTakeProfit || 25;
    const dynamicSlPct = Math.abs(taSignal.stopLossPct || activeCriteria.stopLoss || 15);

    // 8. Execute buy via TradingEngine
    console.log(`[PIPELINE STAGE] TradingEngine.buy() ATTEMPT mint=${mint} amountSol=${decision.buyAmountSol} approvalId=${evalResult.approval?.approvalId}`);

    entryDecisionLedger.recordBuyAttempt({
      mintAddress: mint,
      symbol: candidate.symbol,
      network,
      wallet,
      amountSol: decision.buyAmountSol,
      success: false,
    });

    let tradeResponse: TradeEngineResponse;
    try {
      tradeResponse = await tradingEngine.buy({
        network,
        wallet,
        mint,
        amountSol: decision.buyAmountSol,
        decimals: candidate.decimals?.value ?? undefined,
        slippageBps: Math.round((Number(activeCriteria.slippage) || 1.0) * 100) || 250,
        maxRebuyTimes: activeCriteria.maxRebuyTimes ?? 1,
        tradeOnlyOnce: activeCriteria.tradeOnlyOnce ?? true,
        label: `entry_engine_${triggerSource.toLowerCase()}`,
        tpPct: dynamicTpPct,
        slPct: dynamicSlPct,
        approval: evalResult.approval,
      });
    } catch (err: any) {
      entryDecisionLedger.recordBuyAttempt({
        mintAddress: mint,
        symbol: candidate.symbol,
        network,
        wallet,
        amountSol: decision.buyAmountSol,
        success: false,
        error: err?.message || String(err),
      });
      return {
        mintAddress: mint,
        symbol: candidate.symbol,
        stage: 'BUY_FAILED',
        enrichedCandidate: candidate,
        scoreBreakdown,
        decision,
        status: 'FAILED',
        error: `BUY_EXECUTION_ERROR: ${err?.message || String(err)}`,
      };
    }

    if (!tradeResponse.success) {
      entryDecisionLedger.recordBuyAttempt({
        mintAddress: mint,
        symbol: candidate.symbol,
        network,
        wallet,
        amountSol: decision.buyAmountSol,
        success: false,
        error: tradeResponse.error,
      });
      return {
        mintAddress: mint,
        symbol: candidate.symbol,
        stage: 'BUY_FAILED',
        enrichedCandidate: candidate,
        scoreBreakdown,
        decision,
        tradeResponse,
        status: 'FAILED',
        error: tradeResponse.error,
      };
    }

    // 9. Success
    entryDecisionLedger.recordBuyAttempt({
      mintAddress: mint,
      symbol: candidate.symbol,
      network,
      wallet,
      amountSol: decision.buyAmountSol,
      success: true,
      signature: tradeResponse.signature,
      orderId: tradeResponse.orderId,
    });

    console.log(`[PIPELINE STAGE] BUY CONFIRMED mint=${mint} orderId=${tradeResponse.orderId} signature=${tradeResponse.signature}`);

    return {
      mintAddress: mint,
      symbol: candidate.symbol,
      stage: 'POSITION_OPEN',
      enrichedCandidate: candidate,
      scoreBreakdown,
      decision,
      tradeResponse,
      status: 'PROCESSED',
    };
  }
}

export const entryEngine = EntryEngine.getInstance();
