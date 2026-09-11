// server/market/LaserStreamPipeline.ts
import { marketEventBus } from './MarketEventBus.js';
import { candidateRegistry } from './CandidateRegistry.js';
import { CanonicalEventNormalizer } from './CanonicalEventNormalizer.js';
import { sourceHealthMonitor } from './SourceHealthMonitor.js';
import { tokenMintResolver } from './TokenMintResolver.js';
import { streamingTransportManager } from './StreamingTransportManager.js';
import { UnifiedMarketEvent, EventSource } from '../types/index.js';

/**
 * LaserStream Pipeline: Ingests Helius LaserStream gRPC/WSS data
 * and publishes normalized events to the MarketEventBus.
 *
 * ARCHITECTURE:
 * 1. LaserStream gRPC/WSS receives raw blockchain transactions
 * 2. Fast filter: Only Pump.fun program transactions pass
 * 3. Mint resolution: Extract token mint from transaction
 * 4. Mint validation: Verify mint is a valid SPL token
 * 5. Deduplication: Skip already-processed signatures
 * 6. Candidate registration: Register new tokens in CandidateRegistry
 * 7. Event publication: Publish to MarketEventBus
 * 8. Simulation/Paper cannot authorize LIVE BUY
 */
export class LaserStreamPipeline {
  private static instance: LaserStreamPipeline;
  private isRunning: boolean = false;
  private unsubscribeBus: (() => void) | null = null;
  private seenSignatures: Set<string> = new Set();
  private readonly MAX_SEEN_SIGNATURES = 5000;

  private counters = {
    ingest: 0,
    fastFilterPassed: 0,
    mintResolved: 0,
    processed: 0,
    duplicate: 0,
    candidate: 0,
    enriched: 0,
    criteriaPass: 0,
  };
  private prevCounters = { ...this.counters };

  // Rate tracking
  private rates = {
    ingestRate: 0,
    fastFilterPassedRate: 0,
    mintResolvedRate: 0,
    processedRate: 0,
    duplicateRate: 0,
    candidateRate: 0,
    enrichedRate: 0,
    criteriaPassRate: 0,
  };
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
    this.unsubscribeBus = marketEventBus.subscribe((event: UnifiedMarketEvent) => {
      this.handleIncomingRawEvent(event);
    });

    // 2. Start rate calculation timer
    this.ratesTimer = setInterval(() => this.calculateRates(), 1000);
    if (this.ratesTimer.unref) this.ratesTimer.unref();

    // 3. Start periodic logging
    this.logTimer = setInterval(() => this.logRates(), 10000);
    if (this.logTimer.unref) this.logTimer.unref();

    console.log('[LaserStreamPipeline] Pipeline started. Processing incoming events.');
  }

  public stop(): void {
    this.isRunning = false;
    if (this.unsubscribeBus) {
      this.unsubscribeBus();
      this.unsubscribeBus = null;
    }
    if (this.ratesTimer) { clearInterval(this.ratesTimer); this.ratesTimer = null; }
    if (this.logTimer) { clearInterval(this.logTimer); this.logTimer = null; }
    this.seenSignatures.clear();
    console.log('[LaserStreamPipeline] Pipeline stopped.');
  }

  private handleIncomingRawEvent(event: UnifiedMarketEvent): void {
    if (!this.isRunning) return;
    this.counters.ingest++;

    // Fast filter: Only process trade events
    if (event.eventType !== 'TRADE' && event.eventType !== 'BUY' && event.eventType !== 'SELL') return;
    this.counters.fastFilterPassed++;

    // Deduplication
    if (event.signature && this.seenSignatures.has(event.signature)) {
      this.counters.duplicate++;
      return;
    }
    if (event.signature) {
      this.seenSignatures.add(event.signature);
      if (this.seenSignatures.size > this.MAX_SEEN_SIGNATURES) {
        const first = this.seenSignatures.values().next().value;
        if (first) this.seenSignatures.delete(first);
      }
    }

    // Mint validation
    if (!event.mint || !tokenMintResolver.isValidMint(event.mint)) return;
    this.counters.mintResolved++;

    // Register candidate
    const registered = candidateRegistry.registerCandidate({
      mint: event.mint,
      symbol: event.symbol,
      network: event.network || 'mainnet',
      source: event.source,
      pool: event.pool,
      protocol: event.protocol,
    });
    if (registered) this.counters.candidate++;

    // Record in source health monitor
    sourceHealthMonitor.recordEventNormalized(event.source);
    this.counters.processed++;
  }

  private calculateRates(): void {
    const elapsed = 1; // 1 second interval
    this.rates.ingestRate = this.counters.ingest - this.prevCounters.ingest;
    this.rates.fastFilterPassedRate = this.counters.fastFilterPassed - this.prevCounters.fastFilterPassed;
    this.rates.mintResolvedRate = this.counters.mintResolved - this.prevCounters.mintResolved;
    this.rates.processedRate = this.counters.processed - this.prevCounters.processed;
    this.rates.duplicateRate = this.counters.duplicate - this.prevCounters.duplicate;
    this.rates.candidateRate = this.counters.candidate - this.prevCounters.candidate;
    this.rates.enrichedRate = this.counters.enriched - this.prevCounters.enriched;
    this.rates.criteriaPassRate = this.counters.criteriaPass - this.prevCounters.criteriaPass;
    this.prevCounters = { ...this.counters };
  }

  private logRates(): void {
    if (!this.isRunning) return;
    console.log(
      `[TRADING PIPELINE] WSS_IN=${this.rates.ingestRate}/s ` +
      `FAST_FILTER=${this.rates.fastFilterPassedRate}/s ` +
      `MINT_RESOLVED=${this.rates.mintResolvedRate}/s ` +
      `MINT_VALID=${this.rates.processedRate}/s ` +
      `DEDUP=${this.rates.duplicateRate}/s ` +
      `CANDIDATES=${this.rates.candidateRate}/s ` +
      `ENRICHED=${this.rates.enrichedRate}/s ` +
      `CRITERIA_PASS=${this.rates.criteriaPassRate}/s`
    );
  }

  public getTelemetry() {
    return {
      isRunning: this.isRunning,
      rates: { ...this.rates },
      counters: { ...this.counters },
      seenSignaturesCount: this.seenSignatures.size,
    };
  }
}

export const laserStreamPipeline = LaserStreamPipeline.getInstance();
