// server/trading/EntryDecisionLedger.ts
import { ServerEntryDecision } from './ServerEntryGate.js';
import { OpportunityScoreBreakdown } from './OpportunityScorer.js';

export interface DecisionLogEntry {
  id: string;
  timestamp: number;
  mintAddress: string;
  symbol: string;
  score: number;
  recommendedAction: string;
  decision: 'PASS' | 'BLOCK';
  blockingReason?: string;
  blockingReasons: string[];
  criteriaResults: Record<string, any>;
  dataSource: string;
}

export interface BuyAttemptLogEntry {
  id: string;
  timestamp: number;
  mintAddress: string;
  symbol: string;
  network: string;
  wallet: string;
  amountSol: number;
  signature?: string;
  orderId?: string;
  positionId?: string;
  success: boolean;
  error?: string;
}

export interface EntryDiagnosticsReport {
  timestamp: number;
  uptimeSeconds: number;
  autoSniperEnabled: boolean;
  isLiveTrading: boolean;
  network: string;
  counters: {
    eventsReceived: number;
    candidatesDetected: number;
    enriched: number;
    scored: number;
    passedCriteria: number;
    blockedCriteria: number;
    entryGatePassed: number;
    rebuyGuardPassed: number;
    buyAttempts: number;
    buyConfirmed: number;
    buyFailed: number;
  };
  topBlockingReasons: { reason: string; count: number }[];
  recentDecisions: DecisionLogEntry[];
  recentBuyAttempts: BuyAttemptLogEntry[];
}

const MAX_LOG_SIZE = 2000;

export class EntryDecisionLedger {
  private static instance: EntryDecisionLedger;
  private startTime = Date.now();

  private counters = {
    eventsReceived: 0,
    candidatesDetected: 0,
    enriched: 0,
    scored: 0,
    passedCriteria: 0,
    blockedCriteria: 0,
    entryGatePassed: 0,
    rebuyGuardPassed: 0,
    buyAttempts: 0,
    buyConfirmed: 0,
    buyFailed: 0,
  };

  private blockingReasonCounts: Map<string, number> = new Map();
  private recentDecisions: DecisionLogEntry[] = [];
  private recentBuyAttempts: BuyAttemptLogEntry[] = [];

  private constructor() {}

  public static getInstance(): EntryDecisionLedger {
    if (!EntryDecisionLedger.instance) {
      EntryDecisionLedger.instance = new EntryDecisionLedger();
    }
    return EntryDecisionLedger.instance;
  }

  public recordEventReceived(): void {
    this.counters.eventsReceived++;
  }

  public recordCandidateDetected(): void {
    this.counters.candidatesDetected++;
  }

  public recordEnriched(): void {
    this.counters.enriched++;
  }

  public recordScored(): void {
    this.counters.scored++;
  }

  public recordDecision(
    decision: ServerEntryDecision,
    scoring: OpportunityScoreBreakdown,
    dataSource: string
  ): void {
    if (decision.allowed) {
      this.counters.passedCriteria++;
      this.counters.entryGatePassed++;
      this.counters.rebuyGuardPassed++;
    } else {
      this.counters.blockedCriteria++;
      for (const reason of decision.blockingReasons) {
        const key = reason.split(':')[0].trim();
        this.blockingReasonCounts.set(key, (this.blockingReasonCounts.get(key) || 0) + 1);
      }
    }

    const logEntry: DecisionLogEntry = {
      id: `dec_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: decision.evaluatedAt,
      mintAddress: decision.mintAddress,
      symbol: decision.symbol,
      score: scoring.totalScore,
      recommendedAction: scoring.recommendedAction,
      decision: decision.allowed ? 'PASS' : 'BLOCK',
      blockingReason: decision.blockingReasons[0],
      blockingReasons: decision.blockingReasons,
      criteriaResults: decision.criteriaResults,
      dataSource,
    };

    this.recentDecisions.unshift(logEntry);
    if (this.recentDecisions.length > MAX_LOG_SIZE) {
      this.recentDecisions.length = MAX_LOG_SIZE;
    }
  }

  public recordBuyAttempt(attempt: Omit<BuyAttemptLogEntry, 'id' | 'timestamp'>): void {
    this.counters.buyAttempts++;
    if (attempt.success) {
      this.counters.buyConfirmed++;
    } else {
      this.counters.buyFailed++;
    }

    const entry: BuyAttemptLogEntry = {
      ...attempt,
      id: `buy_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: Date.now(),
    };

    this.recentBuyAttempts.unshift(entry);
    if (this.recentBuyAttempts.length > MAX_LOG_SIZE) {
      this.recentBuyAttempts.length = MAX_LOG_SIZE;
    }
  }

  public getDiagnostics(context: {
    autoSniperEnabled: boolean;
    isLiveTrading: boolean;
    network: string;
  }): EntryDiagnosticsReport {
    const topBlocking = Array.from(this.blockingReasonCounts.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      timestamp: Date.now(),
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      autoSniperEnabled: context.autoSniperEnabled,
      isLiveTrading: context.isLiveTrading,
      network: context.network,
      counters: { ...this.counters },
      topBlockingReasons: topBlocking,
      recentDecisions: this.recentDecisions.slice(0, 50),
      recentBuyAttempts: this.recentBuyAttempts.slice(0, 50),
    };
  }

  public clear(): void {
    this.counters = {
      eventsReceived: 0,
      candidatesDetected: 0,
      enriched: 0,
      scored: 0,
      passedCriteria: 0,
      blockedCriteria: 0,
      entryGatePassed: 0,
      rebuyGuardPassed: 0,
      buyAttempts: 0,
      buyConfirmed: 0,
      buyFailed: 0,
    };
    this.blockingReasonCounts.clear();
    this.recentDecisions = [];
    this.recentBuyAttempts = [];
  }
}

export const entryDecisionLedger = EntryDecisionLedger.getInstance();
