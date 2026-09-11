// server/trading/OpportunityScorer.ts
import { EnrichedCandidate } from './CandidateEnricher.js';
import { BondingCurveState, bondingCurveFastLane } from './BondingCurveFastLane.js';
import { migrationDetector } from './MigrationDetector.js';
import { candidateRegistry } from '../market/CandidateRegistry.js';

export interface OpportunityScoreBreakdown {
  momentumScore: number;       // 0-30
  buyerGrowthScore: number;    // 0-25
  liquidityScore: number;      // 0-20
  discoveryScore: number;      // 0-15
  executabilityScore: number;  // 0-10
  riskPenalty: number;         // 0 to -40
  totalScore: number;          // 0-100
  recommendedAction: 'BUY' | 'WATCH' | 'IGNORE';
  reasons: string[];
}

export interface ScoreContext {
  bondingCurveState?: BondingCurveState;
  migrationState?: any;
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
    return this.score(candidate);
  }

  public score(
    candidate: EnrichedCandidate,
    context: ScoreContext = {}
  ): OpportunityScoreBreakdown {
    const reasons: string[] = [];
    let momentumScore = 0;
    let buyerGrowthScore = 0;
    let liquidityScore = 0;
    let discoveryScore = 0;
    let executabilityScore = 0;
    let riskPenalty = 0;

    // ---- 1. MOMENTUM SCORE (0-30) ----
    const bCurve = context.bondingCurveState || bondingCurveFastLane.getState(candidate.mintAddress);
    if (bCurve) {
      // Buy velocity: more buys in recent window = higher momentum
      const buyVel = bCurve.buyVelocity || 0;
      const sellVel = bCurve.sellVelocity || 0;
      const netBuyPressure = buyVel - sellVel;
      momentumScore += Math.min(15, Math.max(0, netBuyPressure * 3));

      // Price acceleration
      if (bCurve.priceSolPerToken > 0) {
        momentumScore += Math.min(10, bCurve.volumeVelocitySol * 2);
      }

      // Unique buyer growth
      if (bCurve.uniqueBuyerVelocity > 3) {
        momentumScore += 5;
        reasons.push(`STRONG_BUYER_GROWTH: ${bCurve.uniqueBuyerVelocity} unique buyers in window`);
      }
    } else {
      // Fallback: use enriched price data
      const priceSol = candidate.priceSol?.value;
      if (priceSol && priceSol > 0) {
        momentumScore += 10; // Baseline momentum for having a valid price
      }
    }
    momentumScore = Math.min(30, momentumScore);

    // ---- 2. BUYER GROWTH SCORE (0-25) ----
    if (bCurve) {
      const uniqueBuyers = bCurve.uniqueBuyerVelocity || 0;
      if (uniqueBuyers >= 10) {
        buyerGrowthScore = 25;
        reasons.push(`HIGH_BUYER_COUNT: ${uniqueBuyers} unique buyers`);
      } else if (uniqueBuyers >= 5) {
        buyerGrowthScore = 18;
      } else if (uniqueBuyers >= 2) {
        buyerGrowthScore = 10;
      }
    }

    // ---- 3. LIQUIDITY SCORE (0-20) ----
    const liqUsd = candidate.liquidityUsd?.value;
    if (liqUsd !== null && liqUsd !== undefined) {
      if (liqUsd >= 50000) {
        liquidityScore = 20;
      } else if (liqUsd >= 25000) {
        liquidityScore = 15;
      } else if (liqUsd >= 10000) {
        liquidityScore = 10;
      } else if (liqUsd >= 5000) {
        liquidityScore = 5;
      } else {
        riskPenalty += 10;
        reasons.push(`LOW_LIQUIDITY_PENALTY: $${liqUsd}`);
      }
    }

    // ---- 4. DISCOVERY SCORE (0-15) ----
    const dataSource = String(candidate.dataSource);
    if (dataSource === 'LASERSTREAM' || dataSource === 'HELIUS_GRPC') {
      discoveryScore = 15; // Fastest discovery sources
      reasons.push(`FAST_DISCOVERY: ${dataSource}`);
    } else if (dataSource === 'HELIUS_WSS') {
      discoveryScore = 12;
    } else if (dataSource === 'PUMPFUN_BONDING') {
      discoveryScore = 10;
    } else if (dataSource === 'DEXSCREENER') {
      discoveryScore = 7;
    } else {
      discoveryScore = 3;
    }

    // Migration bonus
    const migration = context.migrationState || migrationDetector.getMigratedPool(candidate.mintAddress);
    if (migration) {
      discoveryScore = Math.min(15, discoveryScore + 5);
      reasons.push(`MIGRATED_POOL: ${migration.poolType}`);
    }

    // ---- 5. EXECUTABILITY SCORE (0-10) ----
    const dexId = candidate.dexId?.toLowerCase() || '';
    if (dexId.includes('jupiter') || dexId.includes('raydium') || dexId.includes('orca')) {
      executabilityScore = 10;
    } else if (dexId.includes('pumpswap') || dexId.includes('meteora')) {
      executabilityScore = 8;
    } else if (dexId.includes('pump')) {
      executabilityScore = 6; // Bonding curve - executable but higher risk
    } else if (dexId === 'unknown') {
      executabilityScore = 2;
      riskPenalty += 5;
      reasons.push('UNKNOWN_DEX_EXECUTABILITY_RISK');
    } else {
      executabilityScore = 4;
    }

    // ---- 6. RISK PENALTY (0 to -40) ----
    const riskScore = candidate.riskScore?.value;
    if (riskScore !== null && riskScore !== undefined) {
      if (riskScore > 80) {
        riskPenalty += 25;
        reasons.push(`HIGH_RISK_SCORE: ${riskScore}`);
      } else if (riskScore > 60) {
        riskPenalty += 15;
        reasons.push(`ELEVATED_RISK_SCORE: ${riskScore}`);
      } else if (riskScore > 40) {
        riskPenalty += 5;
      }
    }

    // Dev ownership penalty
    const devOwnership = (candidate as any).devOwnership?.value ?? candidate.devWalletOwnershipPct?.value;
    if (devOwnership !== null && devOwnership !== undefined && devOwnership > 10) {
      riskPenalty += 10;
      reasons.push(`HIGH_DEV_OWNERSHIP: ${devOwnership}%`);
    }

    // Top 10 holders penalty
    const top10 = (candidate as any).top10Holders?.value ?? candidate.top10HoldersPct?.value;
    if (top10 !== null && top10 !== undefined && top10 > 50) {
      riskPenalty += 10;
      reasons.push(`CONCENTRATED_HOLDERS: top10=${top10}%`);
    }

    // ---- TOTAL SCORE ----
    const rawTotal = momentumScore + buyerGrowthScore + liquidityScore + discoveryScore + executabilityScore - riskPenalty;
    const totalScore = Math.max(0, Math.min(100, rawTotal));

    // ---- RECOMMENDED ACTION ----
    let recommendedAction: 'BUY' | 'WATCH' | 'IGNORE';
    if (totalScore >= 65 && riskPenalty < 15) {
      recommendedAction = 'BUY';
    } else if (totalScore >= 40) {
      recommendedAction = 'WATCH';
    } else {
      recommendedAction = 'IGNORE';
    }

    return {
      momentumScore: Math.round(momentumScore * 10) / 10,
      buyerGrowthScore: Math.round(buyerGrowthScore * 10) / 10,
      liquidityScore: Math.round(liquidityScore * 10) / 10,
      discoveryScore: Math.round(discoveryScore * 10) / 10,
      executabilityScore: Math.round(executabilityScore * 10) / 10,
      riskPenalty: Math.round(riskPenalty * 10) / 10,
      totalScore: Math.round(totalScore * 10) / 10,
      recommendedAction,
      reasons,
    };
  }
}

export const opportunityScorer = OpportunityScorer.getInstance();
