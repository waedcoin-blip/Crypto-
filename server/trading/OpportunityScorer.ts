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

    // Extract unwrapped metric values
    const priceChange5m = candidate.priceChange5m.value;
    const priceChange1m = candidate.priceChange1m.value;
    const volume24h = candidate.volume24h.value;
    const uniqueBuyers30s = candidate.uniqueBuyers30s.value;
    const buyCount30s = candidate.buyCount30s.value;
    const totalBuys = candidate.totalBuys.value;
    const totalSells = candidate.totalSells.value;
    const liquidityUsd = candidate.liquidityUsd.value;
    const marketCapUsd = candidate.marketCapUsd.value;
    const ageMinutes = candidate.ageMinutes.value;
    const decimals = candidate.decimals.value;
    const riskScore = candidate.riskScore.value;
    const devOwnership = candidate.devWalletOwnershipPct.value;
    const top10Holders = candidate.top10HoldersPct.value;
    const isRugSafe = candidate.isRugSafe.value === true;
    const isSellable = candidate.isSellable.value === true;

    // 1. Momentum Score (0 - 30)
    let momentumScore = 0;
    if (priceChange5m !== null && priceChange5m > 0) {
      momentumScore += Math.min(15, priceChange5m * 1.5);
    }
    if (priceChange1m !== null && priceChange1m > 0 && priceChange1m <= 15) {
      momentumScore += Math.min(10, priceChange1m * 2);
    }
    if (volume24h !== null && volume24h > 10000) {
      momentumScore += 5;
    }
    momentumScore = Math.min(30, Math.max(0, Math.round(momentumScore)));

    // 2. Buyer Growth Score (0 - 25)
    let buyerGrowthScore = 0;
    if (uniqueBuyers30s !== null && uniqueBuyers30s >= 4) {
      buyerGrowthScore += Math.min(12, uniqueBuyers30s * 2.5);
    }
    if (buyCount30s !== null && buyCount30s >= 5 && buyCount30s <= 40) {
      buyerGrowthScore += 8;
    }
    if (totalBuys !== null && totalSells !== null) {
      const buySellRatio = totalBuys / Math.max(1, totalSells);
      if (buySellRatio >= 2.0) {
        buyerGrowthScore += 5;
      }
    }
    buyerGrowthScore = Math.min(25, Math.max(0, Math.round(buyerGrowthScore)));

    // 3. Liquidity & Market Quality Score (0 - 20)
    let liquidityScore = 0;
    if (liquidityUsd !== null && liquidityUsd >= 10000) {
      liquidityScore += Math.min(10, (liquidityUsd / 20000) * 10);
    }
    if (liquidityUsd !== null && marketCapUsd !== null && marketCapUsd > 0) {
      const liqRatio = liquidityUsd / marketCapUsd;
      if (liqRatio >= 0.10 && liqRatio <= 0.50) {
        liquidityScore += 5;
      }
    }
    if (marketCapUsd !== null && marketCapUsd >= 40000 && marketCapUsd <= 1500000) {
      liquidityScore += 5;
    }
    liquidityScore = Math.min(20, Math.max(0, Math.round(liquidityScore)));

    // 4. Discovery & Timing Score (0 - 15)
    let discoveryScore = 0;
    if (ageMinutes !== null) {
      if (ageMinutes <= 5) {
        discoveryScore = 15;
      } else if (ageMinutes <= 30) {
        discoveryScore = 12;
      } else if (ageMinutes <= 120) {
        discoveryScore = 8;
      } else {
        discoveryScore = 4;
      }
    }

    // 5. Executability Score (0 - 10)
    let executabilityScore = 0;
    if (decimals !== null && Number.isInteger(decimals) && decimals >= 0 && decimals <= 18) {
      executabilityScore += 5;
    }
    if (isSellable) {
      executabilityScore += 5;
    }

    // 6. Risk Penalty (0 to -40)
    let riskPenalty = 0;
    if (riskScore !== null && riskScore > 18) {
      const excessRisk = riskScore - 18;
      const penalty = Math.min(25, excessRisk * 2);
      riskPenalty -= penalty;
      reasons.push(`Risk score penalty: -${penalty} (risk=${riskScore})`);
    }
    if (devOwnership !== null && devOwnership > 10) {
      const excessDev = devOwnership - 10;
      const penalty = Math.min(15, excessDev * 3);
      riskPenalty -= penalty;
      reasons.push(`Dev ownership penalty: -${penalty} (dev=${devOwnership.toFixed(1)}%)`);
    }
    if (top10Holders !== null && top10Holders > 35) {
      riskPenalty -= 10;
      reasons.push(`Top 10 concentration penalty: -10 (top10=${top10Holders.toFixed(1)}%)`);
    }

    const rawTotal = momentumScore + buyerGrowthScore + liquidityScore + discoveryScore + executabilityScore + riskPenalty;
    const totalScore = Math.min(100, Math.max(0, Math.round(rawTotal)));

    let recommendedAction: 'BUY' | 'WATCH' | 'IGNORE' = 'IGNORE';
    if (totalScore >= 55 && isRugSafe && isSellable && riskPenalty >= -20) {
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
