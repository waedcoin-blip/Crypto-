// server/trading/EntryDecisionLedger.ts
import { logger } from '../utils/logger.js';

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
  counters: {
    eventsReceived: number;
    candidatesDetected: number;
    enriched: number;
    scored: number;
    buyAttempts: number;
    buyConfirmed: number;
  };
  config: {
    autoSniperEnabled: boolean;
    isLiveTrading: boolean;
    network: string;
  };
  recentDecisions: DecisionLogEntry[];
  recentBuyAttempts: BuyAttemptLogEntry[];
}

const MAX_LOG_SIZE = 500;

export class EntryDecisionLedger {
  private static instance: EntryDecisionLedger;
  private decisions: DecisionLogEntry[] = [];
  private buyAttempts: BuyAttemptLogEntry[] = [];

  // Cumulative counters
  private totalEvaluated: number = 0;
  private totalEnriched: number = 0;
  private totalScored: number = 0;
  private totalPassedGate: number = 0;
  private totalBuyAttempts: number = 0;
  private totalBuySuccesses: number = 0;
  private totalBuyFailures: number = 0;

  private constructor() {}

  public static getInstance(): EntryDecisionLedger {
    if (!EntryDecisionLedger.instance) {
      EntryDecisionLedger.instance = new EntryDecisionLedger();
    }
    return EntryDecisionLedger.instance;
  }

  // ==========================================
  // RECORDING METHODS
  // ==========================================

  public recordEvaluated(): void {
    this.totalEvaluated++;
  }

  public recordEnriched(): void {
    this.totalEnriched++;
  }

  public recordScored(): void {
    this.totalScored++;
  }

  public recordGateDecision(entry: Omit<DecisionLogEntry, 'id' | 'timestamp'>): void {
    const fullEntry: DecisionLogEntry = {
      ...entry,
      id: `dec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
    };

    this.decisions.unshift(fullEntry);
    if (this.decisions.length > MAX_LOG_SIZE) this.decisions.pop();

    if (entry.decision === 'PASS') {
      this.totalPassedGate++;
    }
  }

  public recordDecision(entry: any, scoreBreakdown?: any, dataSource?: any): void {
    const fullEntry: any = {
      decision: entry.decision || (entry.allowed ? 'PASS' : 'FAIL'),
      mintAddress: entry.mintAddress || entry.mint,
      symbol: entry.symbol || 'UNKNOWN',
      criteriaVersion: entry.criteriaVersion || '1.0',
      rejectionReasons: entry.blockingReasons || [],
      score: scoreBreakdown?.totalScore ?? 0,
      dataSource: dataSource || 'UNKNOWN',
      ...entry,
    };
    this.recordGateDecision(fullEntry);
  }

  public recordBuyAttempt(entry: Omit<BuyAttemptLogEntry, 'id' | 'timestamp'>): void {
    const fullEntry: BuyAttemptLogEntry = {
      ...entry,
      id: `buy_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
    };

    this.buyAttempts.unshift(fullEntry);
    if (this.buyAttempts.length > MAX_LOG_SIZE) this.buyAttempts.pop();

    this.totalBuyAttempts++;
    if (entry.success) {
      this.totalBuySuccesses++;
    } else {
      this.totalBuyFailures++;
    }
  }

  // ==========================================
  // DIAGNOSTICS & REPORTING
  // ==========================================

  public getDiagnostics(config?: Partial<EntryDiagnosticsReport['config']>): EntryDiagnosticsReport {
    return {
      totalEvaluated: this.totalEvaluated,
      totalEnriched: this.totalEnriched,
      totalScored: this.totalScored,
      totalPassedGate: this.totalPassedGate,
      totalBuyAttempts: this.totalBuyAttempts,
      totalBuySuccesses: this.totalBuySuccesses,
      totalBuyFailures: this.totalBuyFailures,
      counters: {
        eventsReceived: this.totalEvaluated,
        candidatesDetected: this.totalEvaluated,
        enriched: this.totalEnriched,
        scored: this.totalScored,
        buyAttempts: this.totalBuyAttempts,
        buyConfirmed: this.totalBuySuccesses,
      },
      config: {
        autoSniperEnabled: config?.autoSniperEnabled ?? true,
        isLiveTrading: config?.isLiveTrading ?? false,
        network: config?.network ?? 'paper',
      },
      recentDecisions: this.decisions.slice(0, 50),
      recentBuyAttempts: this.buyAttempts.slice(0, 50),
    };
  }

  public getRecentDecisions(limit = 50): DecisionLogEntry[] {
    return this.decisions.slice(0, limit);
  }

  public getRecentBuyAttempts(limit = 50): BuyAttemptLogEntry[] {
    return this.buyAttempts.slice(0, limit);
  }

  public clear(): void {
    this.decisions = [];
    this.buyAttempts = [];
    this.totalEvaluated = 0;
    this.totalEnriched = 0;
    this.totalScored = 0;
    this.totalPassedGate = 0;
    this.totalBuyAttempts = 0;
    this.totalBuySuccesses = 0;
    this.totalBuyFailures = 0;
  }
}

export const entryDecisionLedger = EntryDecisionLedger.getInstance();
