// server/trading/EntryEngine.ts
import { MarketEvent } from '../market/EventNormalizer.js';
import { marketEventBus } from '../market/MarketEventBus.js';
import { candidateEnricher, EnrichedCandidate } from './CandidateEnricher.js';
import { opportunityScorer, OpportunityScoreBreakdown } from './OpportunityScorer.js';
import { serverEntryGate, ServerEntryDecision } from './ServerEntryGate.js';
import { tradingEngine, TradeEngineResponse } from './TradingEngine.js';
import { entryDecisionLedger, EntryDiagnosticsReport } from './EntryDecisionLedger.js';
import { criteriaRepository } from '../repositories/CriteriaRepository.js';
import { CriteriaService, CriteriaConfig } from '../services/criteriaService.js';
import { tokenDiscovery } from '../market/TokenDiscovery.js';

export interface EntryEvaluationResult {
  mintAddress: string;
  symbol: string;
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
  private busUnsubscribe: (() => void) | null = null;

  private constructor() {
    // Read initial environment defaults
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
   * Starts the 24/7 server-side entry engine and subscribes to authoritative market events.
   */
  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    this.busUnsubscribe = marketEventBus.subscribe((event: MarketEvent) => {
      this.processMarketEvent(event).catch((err) => {
        console.warn(`[EntryEngine] Error processing market event ${event.signature || 'unknown'}:`, err.message);
      });
    });

    console.log(`[EntryEngine] Started 24/7 server entry engine (autoSniperEnabled=${this.autoSniperEnabled}, isLiveTrading=${this.isLiveTrading}, network=${this.targetNetwork})`);
  }

  public stop(): void {
    if (this.busUnsubscribe) {
      this.busUnsubscribe();
      this.busUnsubscribe = null;
    }
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
    entryDecisionLedger.recordEventReceived();

    if (event.type !== 'ON_CHAIN_TX' || !event.accountKeys || !Array.isArray(event.accountKeys)) {
      return;
    }

    for (const key of event.accountKeys) {
      if (!tokenDiscovery.isValidMintCandidate(key)) continue;
      entryDecisionLedger.recordCandidateDetected();

      // Process candidate evaluation
      this.evaluateAndTrade(key, 'HELIUS_WSS_STREAM').catch(() => {});
    }
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
      return this.activeEvaluationLocks.get(lockKey)!;
    }

    const evalPromise = this.executePipeline(trimmedMint, network, wallet, triggerSource);
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
    try {
      // 1. Enrich candidate market data
      entryDecisionLedger.recordEnriched();
      const candidate = await candidateEnricher.enrichCandidate(mint, network);

      // 2. Score opportunity
      entryDecisionLedger.recordScored();
      const scoreBreakdown = opportunityScorer.scoreCandidate(candidate);

      // 3. Load active criteria
      let activeCriteria: Partial<CriteriaConfig> = {};
      try {
        const repoCriteria = criteriaRepository.getActiveCriteriaSync() as any;
        activeCriteria = repoCriteria || {};
      } catch {
        activeCriteria = {};
      }

      // 4. Evaluate Entry Gate
      const decision = await serverEntryGate.evaluateEntry({
        candidate,
        criteria: activeCriteria,
        network,
        wallet,
        autoSniperEnabled: this.autoSniperEnabled,
      });

      // 5. Record telemetry
      entryDecisionLedger.recordDecision(decision, scoreBreakdown, candidate.dataSource);

      // Structured logging
      console.log(
        `[ENTRY EVALUATION] mint=${mint} symbol=${candidate.symbol} score=${scoreBreakdown.totalScore}/100 decision=${decision.decision} reason="${decision.blockingReasons[0] || 'CRITERIA_PASSED'}" (src=${triggerSource})`
      );

      // 6. Execute BUY if Entry Gate Passed
      let tradeResponse: TradeEngineResponse | undefined;

      if (decision.allowed) {
        console.log(
          `[BUY ATTEMPT] mint=${mint} symbol=${candidate.symbol} amountSol=${decision.buyAmountSol} network=${network} wallet=${wallet}`
        );

        tradeResponse = await tradingEngine.buy({
          network,
          wallet,
          mint,
          amountSol: decision.buyAmountSol,
          decimals: candidate.decimals,
          slippageBps: Math.round((Number(activeCriteria.slippage) || 1.0) * 100) || 250,
          maxRebuyTimes: activeCriteria.maxRebuyTimes ?? 1,
          tradeOnlyOnce: activeCriteria.tradeOnlyOnce ?? true,
          label: `entry_engine_${triggerSource.toLowerCase()}`,
          tpPct: activeCriteria.minTakeProfit ?? 25,
          slPct: activeCriteria.stopLoss ? Math.abs(activeCriteria.stopLoss) : 15,
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
          console.log(
            `[BUY CONFIRMED] mint=${mint} symbol=${candidate.symbol} orderId=${tradeResponse.orderId} sig=${tradeResponse.signature}`
          );
        } else {
          console.warn(
            `[BUY FAILED] mint=${mint} symbol=${candidate.symbol} error=${tradeResponse.error}`
          );
        }
      }

      return {
        mintAddress: mint,
        symbol: candidate.symbol,
        enrichedCandidate: candidate,
        scoreBreakdown,
        decision,
        tradeResponse,
        status: 'PROCESSED',
      };
    } catch (err: any) {
      console.error(`[EntryEngine Pipeline Error] mint=${mint}:`, err.message);
      return {
        mintAddress: mint,
        symbol: 'UNKNOWN',
        status: 'FAILED',
        error: err.message,
      };
    }
  }

  public getDiagnostics(): EntryDiagnosticsReport {
    return entryDecisionLedger.getDiagnostics({
      autoSniperEnabled: this.autoSniperEnabled,
      isLiveTrading: this.isLiveTrading,
      network: this.targetNetwork,
    });
  }
}

export const entryEngine = EntryEngine.getInstance();
