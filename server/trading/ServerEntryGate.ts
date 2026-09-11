// server/trading/ServerEntryGate.ts
import { EnrichedCandidate } from './CandidateEnricher.js';
import { CriteriaConfig } from '../services/criteriaService.js';
import { hardenedCriteriaEngine } from './HardenedCriteriaEngine.js';

export interface CriterionCheckResult {
  pass: boolean;
  actualValue?: string | number | boolean | null;
  threshold?: string | number | boolean;
  reason: string;
}

export interface ServerEntryDecision {
  allowed: boolean;
  decision: 'BUY' | 'BLOCK' | 'CRITERIA_PASSED' | 'CRITERIA_FAILED';
  mintAddress: string;
  symbol: string;
  buyAmountSol: number;
  matchScorePct?: number;
  confidenceScore?: number;
  candidateId?: string;
  criteriaResults?: Record<string, CriterionCheckResult>;
  blockingReasons: string[];
  evaluatedAt: number;
}

export class ServerEntryGate {
  private static instance: ServerEntryGate;

  private constructor() {}

  public static getInstance(): ServerEntryGate {
    if (!ServerEntryGate.instance) {
      ServerEntryGate.instance = new ServerEntryGate();
    }
    return ServerEntryGate.instance;
  }

  public async evaluateEntry(params: {
    candidate: EnrichedCandidate;
    criteria?: Partial<CriteriaConfig>;
    network: string;
    wallet: string;
    autoSniperEnabled: boolean;
  }): Promise<ServerEntryDecision> {
    const { candidate, criteria, network, wallet, autoSniperEnabled } = params;

    try {
      const res = await hardenedCriteriaEngine.evaluateCandidate(candidate, {
        network,
        wallet,
        autoSniperEnabled,
        criteria,
      });

      const isPass = res.decision === 'PASS';

      return {
        allowed: isPass && !!res.approval,
        decision: isPass ? 'CRITERIA_PASSED' : 'CRITERIA_FAILED',
        mintAddress: candidate.mintAddress,
        symbol: candidate.symbol,
        buyAmountSol: res.buyAmountSol,
        blockingReasons: res.rejectionReasons,
        evaluatedAt: Date.now(),
        candidateId: candidate.mintAddress,
        criteriaResults: this.buildCriteriaResults(res.checks),
      };
    } catch (err: any) {
      // FIX: Catch unexpected errors to prevent 500s propagating to caller
      return {
        allowed: false,
        decision: 'CRITERIA_FAILED',
        mintAddress: candidate.mintAddress,
        symbol: candidate.symbol,
        buyAmountSol: 0,
        blockingReasons: [`CRITERIA_ENGINE_ERROR: ${err?.message || String(err)}`],
        evaluatedAt: Date.now(),
        candidateId: candidate.mintAddress,
      };
    }
  }

  private buildCriteriaResults(checks: any[]): Record<string, CriterionCheckResult> {
    const results: Record<string, CriterionCheckResult> = {};
    for (const check of checks) {
      results[check.ruleId] = {
        pass: check.passed,
        actualValue: check.observedValue,
        threshold: check.threshold,
        reason: check.reason || '',
      };
    }
    return results;
  }
}

export const serverEntryGate = ServerEntryGate.getInstance();
