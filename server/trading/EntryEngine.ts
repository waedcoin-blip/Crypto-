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
import { sourceHealthMonitor } from '../market/SourceHealthMonitor.js';
import { EventSource } from '../types/index.js';
import { canAuthorizeLiveBuy, isLiveDiscoverySource } from '../patches/unifiedBuyContract.js';

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

  /**
   * Starts the 24/7 server-side entry engine.
   */
  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    console.log(`[EntryEngine] Started 24/7 server entry engine (autoSniperEnabled=${this.autoSniperEnabled}, isLiveTrading=${this.isLiveTrading}, network=${this.targetNetwork})`);
  }

  public stop(): void {
    this.isRunning = false;
    console.log('[EntryEngine] Stopped server entry engine');
  }

  public setConfig(params: {
    autoSniperEnabled?: boolean;
    isLiveTrading?: boolean;
    network?: string;
    wallet?: string;
  }): void {
    if (params.autoSniperEnabled !== undefined) this.autoSniperEnabled = params.autoSniperEnabled;
    if (params.isLiveTrading !== undefined) this.isLiveTrading = params.isLiveTrading;
    if (params.network) this.targetNetwork = params.network;
    if (params.wallet) this.defaultWallet = params.wallet;

    console.log(`[EntryEngine] Configuration updated: autoSniperEnabled=${this.autoSniperEnabled}, isLiveTrading=${this.isLiveTrading}, network=${this.targetNetwork}`);
  }

  public getConfig(): {
    isRunning: boolean;
    autoSniperEnabled: boolean;
    isLiveTrading: boolean;
    network: string;
    wallet: string;
  } {
    return {
      isRunning: this.isRunning,
      autoSniperEnabled: this.autoSniperEnabled,
      isLiveTrading: this.isLiveTrading,
      network: this.targetNetwork,
      wallet: this.defaultWallet,
    };
  }

  /**
   * Processes a normalized market event (from Helius WSS / gRPC stream).
   */
  public async processMarketEvent(event: MarketEvent): Promise<void> {
    // Handled asynchronously by LaserStreamPipeline
  }

  /**
   * Evaluates a candidate mint through the complete authoritative entry pipeline.
   * Concurrency protected per network:wallet:mint.
   */
  public async evaluateAndTrade(
    mint: string,
    triggerSource: string = 'MANUAL'
  ): Promise<EntryEvaluationResult> {
    const trimmedMint = mint.trim();
    const network = this.targetNetwork;
    const wallet = this.defaultWallet;
    const lockKey = `${network}:${wallet}:${trimmedMint}`;

    if (this.activeEvaluationLocks.has(lockKey)) {
      return {
        mintAddress: trimmedMint,
        symbol: 'UNKNOWN',
        stage: 'BUY_LOCKED',
        status: 'SKIPPED',
        error: 'Evaluation locked due to concurrent process',
      };
    }

    // CandidateRegistry Idempotency Check
    const buyCheck = candidateRegistry.canAttemptBuy(network, trimmedMint);
    if (!buyCheck.allowed) {
      console.log(`[ENTRY ENGINE IDEMPOTENCY SKIP] mint=${trimmedMint} reason="${buyCheck.reason}"`);
      return {
        mintAddress: trimmedMint,
        symbol: 'UNKNOWN',
        stage: 'BUY_LOCKED',
        status: 'SKIPPED',
        error: buyCheck.reason,
      };
    }

    const { priorityScheduler, PriorityLevel } = await import('./PriorityScheduler.js');
    const bCurve = bondingCurveFastLane.getState(trimmedMint);
    const migration = migrationDetector.getMigratedPool(trimmedMint);
    
    let priority = PriorityLevel.P5_NORMAL_BUY;
    if (migration) {
      priority = PriorityLevel.P2_MIGRATION_BUY;
    } else if (bCurve) {
      priority = PriorityLevel.P3_BONDING_CURVE_BUY;
    } else if (triggerSource === 'HIGH_MOMENTUM') {
      priority = PriorityLevel.P4_HIGH_MOMENTUM_BUY;
    }

    const evalPromise = priorityScheduler.schedule(priority, () => 
      this.executePipeline(trimmedMint, network, wallet, triggerSource)
    );
    this.activeEvaluationLocks.set(lockKey, evalPromise);

    try {
      return await evalPromise;
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
    const src = (triggerSource in { PULSE_FEED: 1, LASERSTREAM: 1, HELIUS_WSS: 1, HELIUS_GRPC: 1, PUMP_FUN: 1, DEXSCREENER: 1, MANUAL: 1, SIMULATION: 1 } ? triggerSource : 'MANUAL') as EventSource;

    try {
      // Invariant: Simulation/Mock data must never authorize LIVE BUY
      if (network === 'mainnet' || this.isLiveTrading) {
        if (triggerSource === 'SIMULATION' || !canAuthorizeLiveBuy(triggerSource, 'LIVE')) {
          console.warn(`[${src} BUY BLOCKED] mint=${mint} source=${src} correlationId=none timestamp=${Date.now()} reason="Simulation/invalid source cannot authorize live BUY"`);
          candidateRegistry.updateCandidateState(network, mint, 'REJECTED', {
            rejectionReason: `SOURCE_NOT_AUTHORIZED_FOR_LIVE_BUY: ${triggerSource}`,
          });
          return {
            mintAddress: mint,
            symbol: 'UNKNOWN',
            stage: 'REJECTED',
            status: 'SKIPPED',
            error: `Simulation/invalid source ${triggerSource} cannot authorize live BUY`,
          };
        }
      }

      console.log(`[${src} CANDIDATE] mint=${mint} source=${src} correlationId=none timestamp=${Date.now()} reason="Registered in candidate registry"`);
      candidateRegistry.updateCandidateState(network, mint, 'ANALYZING');

      // 1. DISCOVERED -> ENRICHING
      entryDecisionLedger.recordEnriched();
      console.log(`[PIPELINE STAGE] ENRICHING mint=${mint}`);
      const candidate = await candidateEnricher.enrichCandidate(mint, network);
      if (!candidate.isEnriched) {
        console.warn(`[EntryEngine] ENRICHMENT FAILED: mint=${mint} reason=${candidate.enrichmentStatus}`);
        return {
          mintAddress: mint,
          symbol: 'INVALID',
          stage: 'REJECTED',
          status: 'FAILED',
          error: `ENRICHMENT_FAILED: ${candidate.enrichmentStatus}`,
        };
      }


      console.log(`[PIPELINE STAGE] REAL MARKET/RISK DATA mint=${mint} mcap=${candidate.marketCapUsd.value !== null ? '$' + candidate.marketCapUsd.value.toFixed(0) : 'none'} liq=${candidate.liquidityUsd.value !== null ? '$' + candidate.liquidityUsd.value.toFixed(0) : 'none'} age=${candidate.ageMinutes.value !== null ? candidate.ageMinutes.value.toFixed(1) + 'm' : 'none'} risk=${candidate.riskScore.value !== null ? candidate.riskScore.value : 'none'} decimals=${candidate.decimals.value !== null ? candidate.decimals.value : 'none'}`);

      // 2. READY_FOR_EVALUATION -> Score opportunity
      entryDecisionLedger.recordScored();
      const scoreBreakdown = opportunityScorer.scoreCandidate(candidate);
      console.log(`[${src} MOMENTUM] mint=${mint} source=${src} correlationId=none timestamp=${Date.now()} reason="Opportunity score ${scoreBreakdown.totalScore}/100 calculated"`);

      // 3. Load active criteria
      let activeCriteria: Partial<CriteriaConfig> = {};
      try {
        const repoCriteria = criteriaRepository.getActiveCriteriaSync() as any;
        activeCriteria = repoCriteria || {};
      } catch {
        activeCriteria = {};
      }

      // 4. Evaluate Entry Gate via Authoritative HardenedCriteriaEngine
      console.log(`[PIPELINE STAGE] HardenedCriteriaEngine EVALUATING mint=${mint}`);
      const evalResult = await hardenedCriteriaEngine.evaluateCandidate(candidate, { network, wallet, autoSniperEnabled: this.autoSniperEnabled });

      const decision: ServerEntryDecision = {
        candidateId: mint,
        mintAddress: mint,
        symbol: candidate.symbol,
        decision: evalResult.decision === 'PASS' ? 'CRITERIA_PASSED' : 'CRITERIA_FAILED',
        allowed: evalResult.decision === 'PASS' && !!evalResult.approval,
        blockingReasons: evalResult.rejectionReasons,
        buyAmountSol: evalResult.buyAmountSol,
        confidenceScore: scoreBreakdown.totalScore,
        evaluatedAt: Date.now(),
      };

      console.log(`[${src} CRITERIA] mint=${mint} source=${src} correlationId=none timestamp=${Date.now()} reason="${decision.decision}" approvalId=${evalResult.approval?.approvalId || 'none'}`);
      console.log(`[PIPELINE STAGE] HardenedCriteriaEngine DECISION mint=${mint} allowed=${decision.allowed} score=${scoreBreakdown.totalScore}/100 blockingReasons=${JSON.stringify(decision.blockingReasons)}`);

      // 5. Record telemetry
      entryDecisionLedger.recordDecision(decision, scoreBreakdown, candidate.dataSource);
      console.log(`[PIPELINE STAGE] EntryDecisionLedger RECORDED mint=${mint}`);

      // Structured logging
      console.log(
        `[ENTRY EVALUATION] mint=${mint} symbol=${candidate.symbol} score=${scoreBreakdown.totalScore}/100 decision=${decision.decision} reason="${decision.blockingReasons[0] || 'CRITERIA_PASSED'}" (src=${triggerSource})`
      );

      // 6. Execute BUY if Hardened Gate Passed and Issued Approval
      let tradeResponse: TradeEngineResponse | undefined;
      let finalStage: PipelineStage = decision.allowed ? 'BUY_SIGNAL' : 'REJECTED';

      if (!decision.allowed || !evalResult.approval) {
        console.log(`[${src} BUY BLOCKED] mint=${mint} source=${src} correlationId=none timestamp=${Date.now()} reason="${decision.blockingReasons[0] || 'CRITERIA_FAILED'}"`);
        candidateRegistry.updateCandidateState(network, mint, 'REJECTED', {
          score: scoreBreakdown.totalScore,
          rejectionReason: decision.blockingReasons[0] || 'CRITERIA_FAILED',
        });
        sourceHealthMonitor.recordRejection(src, decision.blockingReasons[0]);
      } else {
        console.log(`[${src} BUY AUTH] mint=${mint} source=${src} correlationId=none timestamp=${Date.now()} reason="Hardened gate passed; approval=${evalResult.approval.approvalId}"`);
        candidateRegistry.updateCandidateState(network, mint, 'BUY_AUTHORIZED', {
          score: scoreBreakdown.totalScore,
        });
        sourceHealthMonitor.recordQualified(src);

        finalStage = 'BUY_LOCKED';
        console.log(
          `[${src} BUY ATTEMPT] mint=${mint} symbol=${candidate.symbol} amountSol=${decision.buyAmountSol} network=${network} wallet=${wallet}`
        );

        // Mandatory Final Pre-Broadcast Revalidation
        const { riskManager } = await import('./RiskManager.js');
        const buyAmountLamports = BigInt(Math.round(decision.buyAmountSol * 1e9));
        const reval = await riskManager.revalidateBuyBeforeBroadcast({
          mint,
          buyAmountLamports,
          network,
          wallet,
        });

        if (!reval.allowed) {
          console.warn(`[${src} BUY BLOCKED] mint=${mint} source=${src} correlationId=none timestamp=${Date.now()} reason="REVALIDATION_ABORT: ${reval.reason}"`);
          candidateRegistry.updateCandidateState(network, mint, 'REJECTED', {
            rejectionReason: `REVALIDATION_ABORT: ${reval.reason}`,
          });
          sourceHealthMonitor.recordRejection(src, reval.reason);
          finalStage = 'REJECTED';
          return {
            mintAddress: mint,
            symbol: candidate.symbol,
            stage: 'REJECTED',
            enrichedCandidate: candidate,
            scoreBreakdown,
            decision: {
              ...decision,
              allowed: false,
              blockingReasons: [...decision.blockingReasons, `REVALIDATION_ABORT: ${reval.reason}`],
            },
            status: 'SKIPPED',
            error: reval.reason,
          };
        }

        finalStage = 'BUY_SUBMITTED';
        candidateRegistry.updateCandidateState(network, mint, 'BUYING');
        sourceHealthMonitor.recordBuyAttempt(src);

        console.log(`[PIPELINE STAGE] TradingEngine.buy() ATTEMPT mint=${mint} amountSol=${decision.buyAmountSol} approvalId=${evalResult.approval.approvalId}`);
        tradeResponse = await tradingEngine.buy({
          network,
          wallet,
          mint,
          amountSol: decision.buyAmountSol,
          decimals: reval.verifiedDecimals ?? candidate.decimals.value ?? undefined,
          slippageBps: Math.round((Number(activeCriteria.slippage) || 1.0) * 100) || 250,
          maxRebuyTimes: activeCriteria.maxRebuyTimes ?? 1,
          tradeOnlyOnce: activeCriteria.tradeOnlyOnce ?? true,
          label: `entry_engine_${triggerSource.toLowerCase()}`,
          tpPct: activeCriteria.minTakeProfit ?? 25,
          slPct: activeCriteria.stopLoss ? Math.abs(activeCriteria.stopLoss) : 15,
          approval: evalResult.approval,
        });

        entryDecisionLedger.recordBuyAttempt({
          mintAddress: mint,
          symbol: candidate.symbol,
          network,
          wallet,
          amountSol: decision.buyAmountSol,
          signature: tradeResponse.signature,
          orderId: tradeResponse.orderId,
          positionId: tradeResponse.positionId,
          success: tradeResponse.success,
          error: tradeResponse.error,
        });

        if (tradeResponse.success) {
          finalStage = 'POSITION_OPEN';
          candidateRegistry.updateCandidateState(network, mint, 'BOUGHT', {
            orderId: tradeResponse.orderId,
            signature: tradeResponse.signature,
            positionId: tradeResponse.positionId,
          });
          sourceHealthMonitor.recordBuyConfirmed(src);
          console.log(`[${src} BUY CONFIRMED] mint=${mint} source=${src} correlationId=none timestamp=${Date.now()} reason="Order ${tradeResponse.orderId} confirmed, signature ${tradeResponse.signature}"`);
          console.log(
            `[BUY CONFIRMED] mint=${mint} symbol=${candidate.symbol} orderId=${tradeResponse.orderId} sig=${tradeResponse.signature}`
          );
        } else {
          finalStage = 'BUY_FAILED';
          candidateRegistry.updateCandidateState(network, mint, 'REJECTED', {
            rejectionReason: tradeResponse.error || 'BUY_FAILED',
          });
          sourceHealthMonitor.recordBuyFailed(src, tradeResponse.error);
          console.log(`[${src} BUY BLOCKED] mint=${mint} source=${src} correlationId=none timestamp=${Date.now()} reason="${tradeResponse.error || 'BUY_FAILED'}"`);
          console.warn(
            `[BUY FAILED] mint=${mint} symbol=${candidate.symbol} error=${tradeResponse.error}`
          );
        }
      }

      return {
        mintAddress: mint,
        symbol: candidate.symbol,
        stage: finalStage,
        enrichedCandidate: candidate,
        scoreBreakdown,
        decision,
        tradeResponse,
        status: 'PROCESSED',
      };
    } catch (err: any) {
      console.error(`[EntryEngine Pipeline Error] mint=${mint}:`, err.message);
      candidateRegistry.updateCandidateState(network, mint, 'REJECTED', {
        rejectionReason: err.message,
      });
      sourceHealthMonitor.recordError(src, err.message);
      return {
        mintAddress: mint,
        symbol: 'UNKNOWN',
        stage: 'BUY_FAILED',
        status: 'FAILED',
        error: err.message,
      };
    }
  }

  public getDiagnostics(): EntryDiagnosticsReport {
    const report = entryDecisionLedger.getDiagnostics({
      autoSniperEnabled: this.autoSniperEnabled,
      isLiveTrading: this.isLiveTrading,
      network: this.targetNetwork,
    });

    const pipelineMetrics = laserStreamPipeline.getMetrics();
    return {
      ...report,
      pipeline: pipelineMetrics,
    } as any;
  }
}

export const entryEngine = EntryEngine.getInstance();
