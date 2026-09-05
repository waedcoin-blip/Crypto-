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
    };
  }
}

export const serverEntryGate = ServerEntryGate.getInstance();
