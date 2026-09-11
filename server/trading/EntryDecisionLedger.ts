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
  totalEvaluated: number;
  totalEnriched: number;
  totalScored: number;
  totalPassedGate: number;
  totalBuyAttempts: number;
  totalBuySuccesses: number;
  totalBuyFailures: number;
  config: {
    autoSniperEnabled: boolean;
    isLiveTrading: boolean;
    network: string;
  };
  recentDecisions: DecisionLogEntry[];
  recentBuyAttempts: BuyAttemptLogEntry[];
}

const MAX_LOG_SIZE = 2000;

export class EntryDecisionLedger {
  private static instance: EntryDecisionLedger;

  private totalEvaluated = 0;
  private totalEnriched = 0;
  private totalScored = 0;
  private totalPassedGate = 0;
  private totalBuyAttempts = 0;
  private totalBuySuccesses = 0;
  private totalBuyFailures = 0;

  public recentDecisions: DecisionLogEntry[] = [];
  public recentBuyAttempts: BuyAttemptLogEntry[] = [];

  private constructor() {}

  public static getInstance(): EntryDecisionLedger {
    if (!EntryDecisionLedger.instance) {
      EntryDecisionLedger.instance = new EntryDecisionLedger();
    }
    return EntryDecisionLedger.instance;
  }

  public recordEnriched(): void {
    this.totalEvaluated++;
    this.totalEnriched++;
  }

  public recordScored(): void {
    this.totalScored++;
  }

  public recordDecision(
    decision: ServerEntryDecision,
    scoring: OpportunityScoreBreakdown,
    dataSource: string
  ): void {
    if (decision.allowed) {
      this.totalPassedGate++;
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
      criteriaResults: (decision as any).criteriaResults || {},
      dataSource,
    };
    
    // FIX: O(1) push instead of O(N) unshift
    this.recentDecisions.push(logEntry);
    if (this.recentDecisions.length > MAX_LOG_SIZE) {
      this.recentDecisions = this.recentDecisions.slice(-MAX_LOG_SIZE);
    }
  }

  public recordBuyAttempt(attempt: Omit<BuyAttemptLogEntry, 'id' | 'timestamp'>): void {
    this.totalBuyAttempts++;
    if (attempt.success) {
      this.totalBuySuccesses++;
    } else {
      this.totalBuyFailures++;
    }
    
    const entry: BuyAttemptLogEntry = {
      ...attempt,
      id: `buy_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: Date.now(),
    };
    
    // FIX: O(1) push instead of O(N) unshift
    this.recentBuyAttempts.push(entry);
    if (this.recentBuyAttempts.length > MAX_LOG_SIZE) {
      this.recentBuyAttempts = this.recentBuyAttempts.slice(-MAX_LOG_SIZE);
    }
  }

  public getDiagnostics(config: { autoSniperEnabled: boolean; isLiveTrading: boolean; network: string }): EntryDiagnosticsReport {
    return {
      totalEvaluated: this.totalEvaluated,
      totalEnriched: this.totalEnriched,
      totalScored: this.totalScored,
      totalPassedGate: this.totalPassedGate,
      totalBuyAttempts: this.totalBuyAttempts,
      totalBuySuccesses: this.totalBuySuccesses,
      totalBuyFailures: this.totalBuyFailures,
      config,
      recentDecisions: [...this.recentDecisions].reverse(),
      recentBuyAttempts: [...this.recentBuyAttempts].reverse(),
    };
  }

  public clear(): void {
    this.totalEvaluated = 0;
    this.totalEnriched = 0;
    this.totalScored = 0;
    this.totalPassedGate = 0;
    this.totalBuyAttempts = 0;
    this.totalBuySuccesses = 0;
    this.totalBuyFailures = 0;
    this.recentDecisions = [];
    this.recentBuyAttempts = [];
  }
}

export const entryDecisionLedger = EntryDecisionLedger.getInstance();
