// server/market/LaserStreamPipeline.ts
import { MarketEvent } from './EventNormalizer.js';
import { marketEventBus } from './MarketEventBus.js';
import { tokenMintResolver } from './TokenMintResolver.js';
import { tokenDiscovery } from './TokenDiscovery.js';
import { entryEngine } from '../trading/EntryEngine.js';
import { candidateEnricher } from '../trading/CandidateEnricher.js';
import { opportunityScorer } from '../trading/OpportunityScorer.js';
import { serverEntryGate } from '../trading/ServerEntryGate.js';
import { tradingEngine } from '../trading/TradingEngine.js';
import { entryDecisionLedger } from '../trading/EntryDecisionLedger.js';
import { criteriaRepository } from '../repositories/CriteriaRepository.js';
import { CriteriaConfig } from '../services/criteriaService.js';
import { laserLogger } from '../utils/logger.js';

// Protocols and Program IDs
export const SUPPORTED_PROTOCOLS = {
  PUMP_FUN: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
  RAYDIUM_AMM: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
  RAYDIUM_CLMM: 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',
  RAYDIUM_CPMM: 'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C',
  METEORA_DLMM: 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo',
  METEORA_POOLS: 'Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB',
  ORCA_WHIRLPOOL: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
  JUPITER_V6: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
};

const PROTOCOL_PROGRAM_SET = new Set<string>(Object.values(SUPPORTED_PROTOCOLS));

export interface PipelineEvent {
  mint: string;
  signature: string;
  slot: number;
  source: string;
  protocol: string;
  isNewToken: boolean;
  isNewPool: boolean;
  priority: 'high' | 'medium' | 'low';
  timestamp: number;
}

export class LaserStreamPipeline {
  private static instance: LaserStreamPipeline;

  private isRunning = false;
  private unsubscribeBus: (() => void) | null = null;

  // Queues
  private highQueue: PipelineEvent[] = [];
  private mediumQueue: PipelineEvent[] = [];
  private lowQueue: PipelineEvent[] = [];
  private readonly MAX_QUEUE_LIMIT = 5000;

  // Deduplication cache
  private dedupeCache: Map<string, { state: string; timestamp: number }> = new Map();
  private readonly DEDUPE_TTL = 30000; // 30 seconds TTL

  // Micro-batching timer
  private workerTimer: NodeJS.Timeout | null = null;
  private readonly BATCH_INTERVAL_MS = 10;

  // Concurrency limiter for enrichment workers
  private activeEnrichments = 0;
  private readonly MAX_CONCURRENT_ENRICHMENTS = 10;

  // Diagnostic metrics counters
  private counters = {
    wssIn: 0,
    fastFilterPassed: 0,
    protocolRecognized: 0,
    mintExtractionAttempted: 0,
    mintExtractionSuccess: 0,
    mintValidationSuccess: 0,
    candidateCreated: 0,
    candidateDeduplicated: 0,
    candidateEnriched: 0,
    candidateRejected: 0,
    criteriaEvaluated: 0,
    criteriaPassed: 0,
    buyAuthorized: 0,
    buyAttempted: 0,
    buyConfirmed: 0,
    buyFailed: 0,
    dropped: 0,
    duplicates: 0,
  };

  // Rejection reasons with counts
  private rejectionReasons: Record<string, number> = {
    marketCapTooLow: 0,
    liquidityTooLow: 0,
    liquidityRatioTooLow: 0,
    top10TooHigh: 0,
    devOwnershipTooHigh: 0,
    riskTooHigh: 0,
    bondingCurveInvalid: 0,
    tokenTooOld: 0,
    rugUnsafe: 0,
    dataUnavailable: 0,
    decimalsUnresolved: 0,
  };

  // 1-second rolling rates tracker
  private rates = {
    ingestRate: 0,
    fastFilterPassedRate: 0,
    processedRate: 0,
    filteredRate: 0,
    candidateRate: 0,
    queueDepth: 0,
    droppedRate: 0,
    duplicateRate: 0,
    mintResolvedRate: 0,
    enrichedRate: 0,
    criteriaPassRate: 0,
    buyAuthRate: 0,
    buyAttemptRate: 0,
    buyConfirmedRate: 0,
    buyFailedRate: 0,
  };

  private prevCounters = { ...this.counters };
  private ratesTimer: NodeJS.Timeout | null = null;
  private logTimer: NodeJS.Timeout | null = null;

  private constructor() {}

  public static getInstance(): LaserStreamPipeline {
    if (!LaserStreamPipeline.instance) {
      LaserStreamPipeline.instance = new LaserStreamPipeline();
    }
    return LaserStreamPipeline.instance;
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // 1. Intercept standard market events directly from the bus
    this.unsubscribeBus = marketEventBus.subscribe((event: MarketEvent) => {
      this.handleIncomingRawEvent(event);
    });

    // 2. Start worker loop
    this.workerTimer = setInterval(() => {
      this.processMicroBatch();
    }, this.BATCH_INTERVAL_MS);

    // 3. Start rates calculation timer
    this.ratesTimer = setInterval(() => {
      this.calculateRates();
    }, 1000);

    // 4. Start diagnostic logging timer
    this.logTimer = setInterval(() => {
      this.printDiagnosticLog();
    }, 1000);

    laserLogger.info('[LASERSTREAM PIPELINE] Pipeline started and subscribed successfully');
  }

  public stop(): void {
    this.isRunning = false;

    if (this.unsubscribeBus) {
      this.unsubscribeBus();
      this.unsubscribeBus = null;
    }

    if (this.workerTimer) {
      clearInterval(this.workerTimer);
      this.workerTimer = null;
    }

    if (this.ratesTimer) {
      clearInterval(this.ratesTimer);
      this.ratesTimer = null;
    }

    if (this.logTimer) {
      clearInterval(this.logTimer);
      this.logTimer = null;
    }

    this.highQueue = [];
    this.mediumQueue = [];
    this.lowQueue = [];
    this.dedupeCache.clear();

    laserLogger.info('[LASERSTREAM PIPELINE] Pipeline stopped cleanly');
  }

  public getMetrics() {
    return {
      ...this.rates,
      counters: { ...this.counters },
      rejectionReasons: { ...this.rejectionReasons },
    };
  }

  /**
   * Fast Ingestion Entrypoint - Bounded & Non-blocking
   */
  private handleIncomingRawEvent(event: MarketEvent): void {
    this.counters.wssIn++;

    // Only process ON_CHAIN_TX
    if (event.type !== 'ON_CHAIN_TX') {
      return;
    }

    // 1. FAST PROGRAM FILTER: Immediately drop if not related to any supported protocol
    const keys = event.accountKeys || [];
    const logs = (event as any).logMessages || [];

    let matchedProgram: string | null = null;
    for (const key of keys) {
      if (PROTOCOL_PROGRAM_SET.has(key)) {
        matchedProgram = key;
        break;
      }
    }

    if (!matchedProgram && logs.length > 0) {
      for (const log of logs) {
        if (typeof log === 'string') {
          for (const progId of PROTOCOL_PROGRAM_SET) {
            if (log.includes(progId)) {
              matchedProgram = progId;
              break;
            }
          }
        }
        if (matchedProgram) break;
      }
    }

    if (!matchedProgram) {
      // Discard immediately before any validation or deduplication
      return;
    }

    this.counters.fastFilterPassed++;

    // 2. FAST EVENT CLASSIFICATION & PROTOCOL RECOGNITION
    let protocol = 'UNKNOWN';
    let isNewToken = false;
    let isNewPool = false;
    let priority: 'high' | 'medium' | 'low' = 'low';

    if (matchedProgram === SUPPORTED_PROTOCOLS.PUMP_FUN) {
      protocol = 'PUMP_FUN';
      const logStr = logs.join('\n');
      if (logStr.includes('Instruction: Create')) {
        isNewToken = true;
        priority = 'high';
      } else if (logStr.includes('Instruction: Buy') || logStr.includes('Instruction: Sell')) {
        priority = 'medium';
      }
    } else if (
      matchedProgram === SUPPORTED_PROTOCOLS.RAYDIUM_AMM ||
      matchedProgram === SUPPORTED_PROTOCOLS.RAYDIUM_CLMM ||
      matchedProgram === SUPPORTED_PROTOCOLS.RAYDIUM_CPMM
    ) {
      protocol = 'RAYDIUM';
      const logStr = logs.join('\n');
      if (logStr.includes('Instruction: Initialize') || logStr.includes('Instruction: Initialize2')) {
        isNewPool = true;
        priority = 'high';
      } else {
        priority = 'medium';
      }
    } else if (
      matchedProgram === SUPPORTED_PROTOCOLS.METEORA_DLMM ||
      matchedProgram === SUPPORTED_PROTOCOLS.METEORA_POOLS
    ) {
      protocol = 'METEORA';
      const logStr = logs.join('\n');
      if (logStr.includes('Initialize') || logStr.includes('init_pool')) {
        isNewPool = true;
        priority = 'high';
      } else {
        priority = 'medium';
      }
    } else if (matchedProgram === SUPPORTED_PROTOCOLS.ORCA_WHIRLPOOL) {
      protocol = 'ORCA';
      const logStr = logs.join('\n');
      if (logStr.includes('Initialize') || logStr.includes('CreatePool')) {
        isNewPool = true;
        priority = 'high';
      } else {
        priority = 'medium';
      }
    } else if (matchedProgram === SUPPORTED_PROTOCOLS.JUPITER_V6) {
      protocol = 'JUPITER';
      priority = 'low';
    }

    this.counters.protocolRecognized++;

    // 3. ACTUAL MINT EXTRACTION
    this.counters.mintExtractionAttempted++;
    let extractedMint: string | null = null;

    if (protocol === 'PUMP_FUN') {
      extractedMint = tokenMintResolver.extractMintFromLogs(logs);
    }

    if (!extractedMint) {
      // Find valid SPL token candidate inside account keys by filtering non-mints
      for (const key of keys) {
        if (tokenMintResolver.isValidMint(key)) {
          extractedMint = key;
          break;
        }
      }
    }

    if (!extractedMint) {
      // Unresolved mint - DROP EVENT
      return;
    }

    this.counters.mintExtractionSuccess++;

    // 4. MINT VALIDATION (Cheap Structural Validation)
    if (!tokenMintResolver.isValidPublicKey(extractedMint)) {
      return;
    }

    this.counters.mintValidationSuccess++;

    // 5. DEDUPLICATION & CAPACITY BOUNDS
    const dedupeKey = `${extractedMint}:${protocol}`;
    const cached = this.dedupeCache.get(dedupeKey);
    if (cached && Date.now() - cached.timestamp < this.DEDUPE_TTL) {
      this.counters.duplicates++;
      return;
    }

    // Check bounded queue capacity limits
    const totalQueueSize = this.highQueue.length + this.mediumQueue.length + this.lowQueue.length;
    if (totalQueueSize >= this.MAX_QUEUE_LIMIT) {
      this.counters.dropped++;
      return;
    }

    this.dedupeCache.set(dedupeKey, { state: 'DISCOVERED', timestamp: Date.now() });
    this.counters.candidateDeduplicated++;

    const pipelineEvent: PipelineEvent = {
      mint: extractedMint,
      signature: event.signature || 'none',
      slot: event.slot,
      source: event.network || 'mainnet',
      protocol,
      isNewToken,
      isNewPool,
      priority,
      timestamp: Date.now(),
    };

    // Push into the correct priority queue
    if (priority === 'high') {
      this.highQueue.push(pipelineEvent);
    } else if (priority === 'medium') {
      this.mediumQueue.push(pipelineEvent);
    } else {
      this.lowQueue.push(pipelineEvent);
    }

    this.counters.candidateCreated++;
  }

  /**
   * Micro-batch Consumer Loop
   */
  private processMicroBatch(): void {
    if (!this.isRunning) return;

    // Check if we can start any enrichment worker
    while (this.activeEnrichments < this.MAX_CONCURRENT_ENRICHMENTS) {
      // Get next event based on priority
      const nextEvent = this.highQueue.shift() || this.mediumQueue.shift() || this.lowQueue.shift();
      if (!nextEvent) break;

      this.activeEnrichments++;
      this.processEnrichmentAndEvaluation(nextEvent)
        .catch(() => {})
        .finally(() => {
          this.activeEnrichments--;
        });
    }
  }

  /**
   * Asynchronous Candidate Enrichment & Trading Evaluation Worker
   */
  private async processEnrichmentAndEvaluation(event: PipelineEvent): Promise<void> {
    const dedupeKey = `${event.mint}:${event.protocol}`;
    this.dedupeCache.set(dedupeKey, { state: 'ENRICHING', timestamp: Date.now() });

    try {
      // Trigger async discovery registration asynchronously
      tokenDiscovery.processMarketEvent({
        network: event.source,
        slot: event.slot,
        signature: event.signature,
        timestamp: Date.now(),
        type: 'ON_CHAIN_TX',
        accountKeys: [event.mint],
      });

      // 1. CANDIDATE ENRICHMENT: Fetch REAL market data
      const candidate = await candidateEnricher.enrichCandidate(event.mint, event.source);
      this.counters.candidateEnriched++;

      // Fail-closed verification
      if (!candidate || candidate.marketCapUsd.value === null || candidate.liquidityUsd.value === null) {
        this.rejectionReasons.dataUnavailable++;
        this.counters.candidateRejected++;
        this.dedupeCache.set(dedupeKey, { state: 'REJECTED', timestamp: Date.now() });
        return;
      }

      this.dedupeCache.set(dedupeKey, { state: 'READY', timestamp: Date.now() });

      // 2. SCORING OPPORTUNITY
      const scoreBreakdown = opportunityScorer.scoreCandidate(candidate);

      // 3. LOAD CRITERIA CONFIG
      let activeCriteria: Partial<CriteriaConfig> = {};
      try {
        const repoCriteria = await criteriaRepository.getActiveCriteria();
        activeCriteria = repoCriteria || {};
      } catch {
        activeCriteria = {};
      }

      // 4. ENTRY GATE EVALUATION
      this.counters.criteriaEvaluated++;
      this.dedupeCache.set(dedupeKey, { state: 'EVALUATING', timestamp: Date.now() });

      const decision = await serverEntryGate.evaluateEntry({
        candidate,
        criteria: activeCriteria,
        network: event.source,
        wallet: 'default',
        autoSniperEnabled: entryEngine.getConfig().autoSniperEnabled,
      });

      // Keep track of criteria rejection reasons
      if (!decision.allowed) {
        this.counters.candidateRejected++;
        this.dedupeCache.set(dedupeKey, { state: 'REJECTED', timestamp: Date.now() });

        for (const reason of decision.blockingReasons) {
          const rawReason = reason.split(':')[0].trim();
          if (rawReason in this.rejectionReasons) {
            this.rejectionReasons[rawReason]++;
          } else {
            const key = rawReason.charAt(0).toLowerCase() + rawReason.slice(1);
            if (key in this.rejectionReasons) {
              this.rejectionReasons[key]++;
            } else {
              this.rejectionReasons[rawReason] = (this.rejectionReasons[rawReason] || 0) + 1;
            }
          }
        }
        return;
      }

      this.counters.criteriaPassed++;
      this.counters.buyAuthorized++;

      // 5. ATOMIC REBUY PROTECTION & EXPLICIT BUY EXECUTION SERVER-SIDE
      this.dedupeCache.set(dedupeKey, { state: 'BUY_PENDING', timestamp: Date.now() });
      this.counters.buyAttempted++;

      const tradeResponse = await tradingEngine.buy({
        network: event.source,
        wallet: 'default',
        mint: event.mint,
        amountSol: decision.buyAmountSol,
        decimals: candidate.decimals.value ?? undefined,
        slippageBps: Math.round((Number(activeCriteria.slippage) || 1.0) * 100) || 250,
        maxRebuyTimes: activeCriteria.maxRebuyTimes ?? 1,
        tradeOnlyOnce: activeCriteria.tradeOnlyOnce ?? true,
        label: `laserstream_pipeline`,
        tpPct: activeCriteria.minTakeProfit ?? 25,
        slPct: activeCriteria.stopLoss ? Math.abs(activeCriteria.stopLoss) : 15,
      });

      // Register attempt to diagnostics
      entryDecisionLedger.recordBuyAttempt({
        mintAddress: event.mint,
        symbol: candidate.symbol,
        network: event.source,
        wallet: 'default',
        amountSol: decision.buyAmountSol,
        signature: tradeResponse.signature,
        orderId: tradeResponse.orderId,
        positionId: tradeResponse.positionId,
        success: tradeResponse.success,
        error: tradeResponse.error,
      });

      if (tradeResponse.success) {
        this.counters.buyConfirmed++;
        this.dedupeCache.set(dedupeKey, { state: 'BOUGHT', timestamp: Date.now() });
        console.log(`[PIPELINE SUCCESS] Successfully executed trade! mint=${event.mint} sig=${tradeResponse.signature}`);
      } else {
        this.counters.buyFailed++;
        this.dedupeCache.set(dedupeKey, { state: 'REJECTED', timestamp: Date.now() });
        console.warn(`[PIPELINE FAILURE] Trade execution failed: mint=${event.mint} err=${tradeResponse.error}`);
      }

    } catch (err: any) {
      this.counters.candidateRejected++;
      this.dedupeCache.set(dedupeKey, { state: 'REJECTED', timestamp: Date.now() });
      laserLogger.warn({ error: err.message, mint: event.mint }, 'Pipeline evaluation error');
    }
  }

  /**
   * Sliding 1-second Rates Calculator
   */
  private calculateRates(): void {
    const totalQueueSize = this.highQueue.length + this.mediumQueue.length + this.lowQueue.length;

    this.rates.ingestRate = this.counters.wssIn - this.prevCounters.wssIn;
    this.rates.fastFilterPassedRate = this.counters.fastFilterPassed - this.prevCounters.fastFilterPassed;
    this.rates.processedRate = this.counters.mintValidationSuccess - this.prevCounters.mintValidationSuccess;
    this.rates.filteredRate = this.counters.wssIn - this.counters.fastFilterPassed - (this.prevCounters.wssIn - this.prevCounters.fastFilterPassed);
    this.rates.candidateRate = this.counters.candidateCreated - this.prevCounters.candidateCreated;
    this.rates.queueDepth = totalQueueSize;
    this.rates.droppedRate = this.counters.dropped - this.prevCounters.dropped;
    this.rates.duplicateRate = this.counters.duplicates - this.prevCounters.duplicates;
    this.rates.mintResolvedRate = this.counters.mintExtractionSuccess - this.prevCounters.mintExtractionSuccess;
    this.rates.enrichedRate = this.counters.candidateEnriched - this.prevCounters.candidateEnriched;
    this.rates.criteriaPassRate = this.counters.criteriaPassed - this.prevCounters.criteriaPassed;
    this.rates.buyAuthRate = this.counters.buyAuthorized - this.prevCounters.buyAuthorized;
    this.rates.buyAttemptRate = this.counters.buyAttempted - this.prevCounters.buyAttempted;
    this.rates.buyConfirmedRate = this.counters.buyConfirmed - this.prevCounters.buyConfirmed;
    this.rates.buyFailedRate = this.counters.buyFailed - this.prevCounters.buyFailed;

    this.prevCounters = { ...this.counters };
  }

  /**
   * Diagnostic log printer (Every 1 second)
   */
  private printDiagnosticLog(): void {
    if (!this.isRunning) return;

    console.log(`[TRADING PIPELINE]
WSS_IN=${this.rates.ingestRate}/s
FAST_FILTER=${this.rates.fastFilterPassedRate}/s
MINT_RESOLVED=${this.rates.mintResolvedRate}/s
MINT_VALID=${this.rates.processedRate}/s
DEDUP=${this.rates.duplicateRate}/s
CANDIDATES=${this.rates.candidateRate}/s
ENRICHED=${this.rates.enrichedRate}/s
CRITERIA_PASS=${this.rates.criteriaPassRate}/s
BUY_AUTH=${this.rates.buyAuthRate}/s
BUY_ATTEMPT=${this.rates.buyAttemptRate}/s
BUY_CONFIRMED=${this.rates.buyConfirmedRate}/s
BUY_FAILED=${this.rates.buyFailedRate}/s
QUEUE=${this.rates.queueDepth}`);

    // If Pipeline blockers are detected, output explicit alerts
    if (this.rates.ingestRate > 0 && this.rates.mintResolvedRate === 0) {
      console.warn(`[PIPELINE BLOCKER] LaserStream active but no token mints are being extracted.`);
    } else if (this.rates.mintResolvedRate > 0 && this.rates.candidateRate === 0) {
      console.warn(`[PIPELINE BLOCKER] Mint extraction works but candidate creation is rejecting all events.`);
    } else if (this.rates.candidateRate > 0 && this.rates.enrichedRate === 0 && this.rates.queueDepth > 0) {
      console.warn(`[PIPELINE BLOCKER] Candidate enrichment is stalled.`);
    }

    // Output criteria rejection counts if any rejections occurred in this period
    const totalRejections = Object.values(this.rejectionReasons).reduce((a, b) => a + b, 0);
    if (totalRejections > 0) {
      const parts = Object.entries(this.rejectionReasons)
        .filter(([, count]) => count > 0)
        .map(([reason, count]) => `${reason}=${count}`)
        .join(' ');
      console.log(`[ENTRY REJECTIONS] ${parts}`);
    }
  }
}

export const laserStreamPipeline = LaserStreamPipeline.getInstance();
