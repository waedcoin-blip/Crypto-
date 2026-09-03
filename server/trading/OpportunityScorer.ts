// server/trading/OpportunityScorer.ts
import { EnrichedCandidate } from './CandidateEnricher.js';

export interface OpportunityScoreBreakdown {
  momentumScore: number;       // 0 - 30
  buyerGrowthScore: number;    // 0 - 25
  liquidityScore: number;      // 0 - 20
  discoveryScore: number;      // 0 - 15
  executabilityScore: number;  // 0 - 10
  riskPenalty: number;         // 0 to -40
  totalScore: number;          // 0 - 100
  recommendedAction: 'BUY' | 'WATCH' | 'IGNORE';
  reasons: string[];
}

export class OpportunityScorer {
  private static instance: OpportunityScorer;

  private constructor() {}

  public static getInstance(): OpportunityScorer {
    if (!OpportunityScorer.instance) {
      OpportunityScorer.instance = new OpportunityScorer();
    }
    return OpportunityScorer.instance;
  }

  public scoreCandidate(candidate: EnrichedCandidate): OpportunityScoreBreakdown {
    const reasons: string[] = [];

    // 1. Momentum Score (0 - 30)
    let momentumScore = 0;
    if (candidate.priceChange5m > 0) {
      momentumScore += Math.min(15, candidate.priceChange5m * 1.5);
    }
    if (candidate.priceChange1m > 0 && candidate.priceChange1m <= 15) {
      momentumScore += Math.min(10, candidate.priceChange1m * 2);
    }
    if (candidate.volume24h > 10000) {
      momentumScore += 5;
    }
    momentumScore = Math.min(30, Math.max(0, Math.round(momentumScore)));

    // 2. Buyer Growth Score (0 - 25)
    let buyerGrowthScore = 0;
    if (candidate.uniqueBuyers30s >= 4) {
      buyerGrowthScore += Math.min(12, candidate.uniqueBuyers30s * 2.5);
    }
    if (candidate.buyCount30s >= 5 && candidate.buyCount30s <= 40) {
      buyerGrowthScore += 8;
    }
    const buySellRatio = candidate.totalBuys / Math.max(1, candidate.totalSells);
    if (buySellRatio >= 2.0) {
      buyerGrowthScore += 5;
    }
    buyerGrowthScore = Math.min(25, Math.max(0, Math.round(buyerGrowthScore)));

    // 3. Liquidity & Market Quality Score (0 - 20)
    let liquidityScore = 0;
    if (candidate.liquidityUsd >= 10000) {
      liquidityScore += Math.min(10, (candidate.liquidityUsd / 20000) * 10);
    }
    const liqRatio = candidate.liquidityUsd / Math.max(1, candidate.marketCapUsd);
    if (liqRatio >= 0.10 && liqRatio <= 0.50) {
      liquidityScore += 5;
    }
    if (candidate.marketCapUsd >= 40000 && candidate.marketCapUsd <= 1500000) {
      liquidityScore += 5;
    }
    liquidityScore = Math.min(20, Math.max(0, Math.round(liquidityScore)));

    // 4. Discovery & Timing Score (0 - 15)
    let discoveryScore = 0;
    if (candidate.ageMinutes <= 5) {
      discoveryScore = 15;
    } else if (candidate.ageMinutes <= 30) {
      discoveryScore = 12;
    } else if (candidate.ageMinutes <= 120) {
      discoveryScore = 8;
    } else {
      discoveryScore = 4;
    }

    // 5. Executability Score (0 - 10)
    let executabilityScore = 0;
    if (Number.isInteger(candidate.decimals) && candidate.decimals >= 0 && candidate.decimals <= 18) {
      executabilityScore += 5;
    }
    if (candidate.isSellable) {
      executabilityScore += 5;
    }

    // 6. Risk Penalty (0 to -40)
    let riskPenalty = 0;
    if (candidate.riskScore > 18) {
      const excessRisk = candidate.riskScore - 18;
      riskPenalty -= Math.min(25, excessRisk * 2);
      reasons.push(`Risk score penalty: -${Math.min(25, excessRisk * 2)} (risk=${candidate.riskScore})`);
    }
    if (candidate.devWalletOwnershipPct > 10) {
      const excessDev = candidate.devWalletOwnershipPct - 10;
      riskPenalty -= Math.min(15, excessDev * 3);
      reasons.push(`Dev ownership penalty: -${Math.min(15, excessDev * 3)} (dev=${candidate.devWalletOwnershipPct.toFixed(1)}%)`);
    }
    if (candidate.top10HoldersPct > 35) {
      riskPenalty -= 10;
      reasons.push(`Top 10 concentration penalty: -10 (top10=${candidate.top10HoldersPct.toFixed(1)}%)`);
    }

    const rawTotal = momentumScore + buyerGrowthScore + liquidityScore + discoveryScore + executabilityScore + riskPenalty;
    const totalScore = Math.min(100, Math.max(0, Math.round(rawTotal)));

    let recommendedAction: 'BUY' | 'WATCH' | 'IGNORE' = 'IGNORE';
    if (totalScore >= 55 && candidate.isRugSafe && candidate.isSellable && riskPenalty >= -20) {
      recommendedAction = 'BUY';
      reasons.push(`High opportunity composite score: ${totalScore}/100`);
    } else if (totalScore >= 35) {
      recommendedAction = 'WATCH';
      reasons.push(`Moderate opportunity score: ${totalScore}/100`);
    } else {
      recommendedAction = 'IGNORE';
      reasons.push(`Low opportunity score: ${totalScore}/100`);
    }

    return {
      momentumScore,
      buyerGrowthScore,
      liquidityScore,
      discoveryScore,
      executabilityScore,
      riskPenalty,
      totalScore,
      recommendedAction,
      reasons,
    };
  }
}

export const opportunityScorer = OpportunityScorer.getInstance();
