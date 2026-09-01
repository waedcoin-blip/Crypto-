// src/services/OpportunityScoreEngine.ts
import type { TokenMetric } from '../types';
import type { AdvancedTokenMetrics } from './jupiterService';

export type SecurityStatus = 'UNKNOWN' | 'PENDING' | 'SAFE' | 'UNSAFE';

export interface MultiWindowMomentum {
  buys3s: number;
  buys10s: number;
  buys30s: number;
  buys60s: number;
  sells3s: number;
  sells10s: number;
  sells30s: number;
  sells60s: number;
  uniqueBuyers30s: number;
  windowedBuyPressure30s: number;
  volumeAcceleration: number;
  priceAcceleration: number;
}

export interface TradeCandidate {
  mint: string;
  symbol: string;
  discoveryScore: number;
  momentumScore: number;
  liquidityScore: number;
  buyerGrowthScore: number;
  riskScore: number;
  executableScore: number;
  securityStatus: SecurityStatus;
  executable: boolean;
  totalScore: number;
  reasons: string[];
  metrics: AdvancedTokenMetrics;
  multiWindow: MultiWindowMomentum;
  recommendedAction: 'BUY' | 'WATCH' | 'IGNORE';
}

export interface OpportunityScoreConfig {
  minMcapPump?: number;
  minMcapRaydium?: number;
  maxMcap?: number;
  minLiquidity?: number;
  minLiquidityRatio?: number;
  maxRiskScore?: number;
  maxDevOwnership?: number;
  maxTop10Ownership?: number;
  minAge?: number;
  maxAge?: number;
  tradePumpFun?: boolean;
  tradeRaydium?: boolean;
  tradeBonding?: boolean;
  tradeUnknown?: boolean;
  hardenedMinProfit5m?: number;
  minBuyScoreThreshold?: number;
  tradeOnlyOnce?: boolean;
  maxRebuyTimes?: number;
  tradedMints?: Set<string> | string[];
}

export class OpportunityScoreEngine {
  private static instance: OpportunityScoreEngine;

  public static getInstance(): OpportunityScoreEngine {
    if (!OpportunityScoreEngine.instance) {
      OpportunityScoreEngine.instance = new OpportunityScoreEngine();
    }
    return OpportunityScoreEngine.instance;
  }

  /**
   * 4-State Security Classification
   * UNKNOWN: Initial discovery without security enrichment. Not failed.
   * PENDING: Enrichment in progress.
   * SAFE: Passed verification checks (sellable, low risk score, safe distribution).
   * UNSAFE: Definitively dangerous (honeypot, unsellable, extreme concentration).
   */
  public evaluateSecurityStatus(
    token: Partial<TokenMetric> & { mintAddress?: string; address?: string; isSellable?: boolean; riskScore?: number; devWalletOwnershipPct?: number; devWalletPercentage?: number; top10HoldersPct?: number; top10Percentage?: number; hasLowLiquidity?: boolean }
  ): { status: SecurityStatus; effectiveRiskScore: number; reasons: string[] } {
    const reasons: string[] = [];

    // Explicit unsellable / honeypot is definitively UNSAFE
    if (token.isSellable === false) {
      reasons.push('TOKEN_NOT_SELLABLE');
      return { status: 'UNSAFE', effectiveRiskScore: 100, reasons };
    }

    const devPct = token.devWalletOwnershipPct ?? token.devWalletPercentage;
    const top10Pct = token.top10HoldersPct ?? token.top10Percentage;
    const rawRiskScore = token.riskScore;

    // Extreme single-wallet or dev concentration
    if (devPct !== undefined && devPct > 80) {
      reasons.push(`DEV_OWNERSHIP_EXTREME_${devPct.toFixed(0)}%`);
      return { status: 'UNSAFE', effectiveRiskScore: 95, reasons };
    }
    if (top10Pct !== undefined && top10Pct > 90) {
      reasons.push(`TOP10_OWNERSHIP_EXTREME_${top10Pct.toFixed(0)}%`);
      return { status: 'UNSAFE', effectiveRiskScore: 90, reasons };
    }

    // If risk score is explicitly high (> 80), mark UNSAFE
    if (rawRiskScore !== undefined && rawRiskScore > 80) {
      reasons.push(`CONFIRMED_HIGH_RISK_${rawRiskScore}`);
      return { status: 'UNSAFE', effectiveRiskScore: rawRiskScore, reasons };
    }

    // If security fields are missing / undefined, treat as UNKNOWN or PENDING
    if (rawRiskScore === undefined && devPct === undefined && token.isRugSafe === undefined) {
      reasons.push('ENRICHMENT_PENDING');
      // Provisional baseline risk score (neutral ~25, NEVER 100)
      return { status: 'PENDING', effectiveRiskScore: 25, reasons };
    }

    // If evaluated with acceptable risk
    const effectiveRiskScore = rawRiskScore ?? 20;
    if (effectiveRiskScore <= 35) {
      return { status: 'SAFE', effectiveRiskScore, reasons: ['SECURITY_VERIFIED_CLEAN'] };
    }

    return { status: 'SAFE', effectiveRiskScore, reasons: ['SECURITY_ACCEPTABLE'] };
  }

  /**
   * Multi-Window Momentum Analysis across 3s, 10s, 30s, 60s, 5m
   */
  public analyzeMultiWindowMomentum(token: Partial<TokenMetric>): MultiWindowMomentum {
    const now = Date.now();
    const timeline = Array.isArray(token.recentBuysTimeline) ? token.recentBuysTimeline : [];

    let buys3s = 0;
    let buys10s = 0;
    let buys30s = 0;
    let buys60s = 0;
    let sells3s = 0;
    let sells10s = 0;
    let sells30s = 0;
    let sells60s = 0;
    const uniqueBuyers30sSet = new Set<string>();

    for (const item of timeline) {
      if (!item || typeof item.t !== 'number') continue;
      const ageMs = now - item.t;
      const isBuy = item.type !== 'sell';

      if (ageMs <= 3000) {
        if (isBuy) buys3s++;
        else sells3s++;
      }
      if (ageMs <= 10000) {
        if (isBuy) buys10s++;
        else sells10s++;
      }
      if (ageMs <= 30000) {
        if (isBuy) {
          buys30s++;
          if (item.w) uniqueBuyers30sSet.add(item.w);
        } else {
          sells30s++;
        }
      }
      if (ageMs <= 60000) {
        if (isBuy) buys60s++;
        else sells60s++;
      }
    }

    // If timeline is empty (e.g. from DEX batch data), fallback to 5m transaction stats
    if (timeline.length === 0) {
      const buyCount5m = token.buyCount || 0;
      const sellCount5m = token.sellCount || 0;
      buys30s = Math.round(buyCount5m / 10);
      sells30s = Math.round(sellCount5m / 10);
      buys60s = Math.round(buyCount5m / 5);
      sells60s = Math.round(sellCount5m / 5);
    }

    const total30s = buys30s + sells30s;
    const windowedBuyPressure30s = total30s > 0 ? buys30s / total30s : (token.buyRatio ? Math.min(token.buyRatio / (token.buyRatio + 1), 1) : 0.65);

    // Volume acceleration calculation (5m volume relative to liquidity)
    const liquidity = token.liquidity || 0;
    const vol24h = token.volume24h || 0;
    const vol5m = (token as any).buyVolume || (vol24h / 288);
    const volumeAcceleration = liquidity > 0 ? (vol5m * 12) / liquidity : 1.0;

    // Price acceleration (1m vs 5m change)
    const priceChange1m = token.priceChange1m ?? token.percentageIncrease ?? 0;
    const priceChange5m = token.priceChange5m ?? token.percentageIncrease ?? 0;
    const priceAcceleration = priceChange1m * 2 + (priceChange5m > 0 ? priceChange5m : 0);

    return {
      buys3s,
      buys10s,
      buys30s,
      buys60s,
      sells3s,
      sells10s,
      sells30s,
      sells60s,
      uniqueBuyers30s: uniqueBuyers30sSet.size || (buys30s > 0 ? Math.max(1, Math.round(buys30s * 0.8)) : 0),
      windowedBuyPressure30s,
      volumeAcceleration,
      priceAcceleration,
    };
  }

  /**
   * Score an individual candidate token
   */
  public scoreCandidate(
    token: TokenMetric | (AdvancedTokenMetrics & Partial<TokenMetric>),
    config?: OpportunityScoreConfig
  ): TradeCandidate {
    const mint = (token as any).address || (token as any).mintAddress || '';
    const symbol = (token as any).symbol || 'UNKNOWN';
    const now = Date.now();

    const tokenTime = (token as any).pairCreatedAt
      ? ((token as any).pairCreatedAt < 1000000000000 ? (token as any).pairCreatedAt * 1000 : (token as any).pairCreatedAt)
      : ((token as any).discoveredAt || now);
    const ageMinutes = (now - tokenTime) / 60000;

    const marketCap = (token as any).marketCap ?? (token as any).marketCapUsd ?? 0;
    const liquidity = (token as any).liquidity ?? (token as any).liquidityUsd ?? 0;
    const volume24h = (token as any).volume24h ?? 0;

    const multiWindow = this.analyzeMultiWindowMomentum(token as any);
    const security = this.evaluateSecurityStatus(token as any);

    const advancedMetrics: AdvancedTokenMetrics = {
      mintAddress: mint,
      bondingCurveProgress: (token as any).bondingCurveProgress || 0,
      isRaydiumListed: (token as any).isRaydiumListed ?? (
        !mint.toLowerCase().endsWith('pump') &&
        (!((token as any).dexId || '').toLowerCase().includes('pump') || ((token as any).dexId || '').toLowerCase().includes('pumpswap'))
      ),
      marketCapUsd: marketCap,
      liquidityUsd: liquidity,
      isRugSafe: security.status === 'SAFE' || security.status === 'PENDING',
      riskScore: security.effectiveRiskScore,
      devWalletOwnershipPct: (token as any).devWalletPercentage ?? (token as any).devWalletOwnershipPct ?? 0,
      top10HoldersPct: (token as any).top10Percentage ?? (token as any).top10HoldersPct ?? 0,
      buyCount30s: multiWindow.buys30s,
      uniqueBuyers30s: multiWindow.uniqueBuyers30s,
      totalBuys: (token as any).buyCount ?? (token as any).totalBuys ?? multiWindow.buys60s,
      totalSells: (token as any).sellCount ?? (token as any).totalSells ?? multiWindow.sells60s,
      priceChange1m: (token as any).priceChange1m ?? (token as any).percentageIncrease ?? 0,
      priceChange5m: (token as any).priceChange5m ?? (token as any).percentageIncrease ?? 0,
      percentageIncrease: (token as any).percentageIncrease ?? 0,
      ageMinutes,
      volume24h,
      dexId: (token as any).dexId || 'unknown',
    };

    const reasons: string[] = [];

    // 1. MOMENTUM SCORE (0 - 30 points)
    // Rewards short-term price momentum, buy velocity, and acceleration
    let momentumScore = 0;
    if (multiWindow.priceAcceleration > 0) {
      momentumScore += Math.min(12, multiWindow.priceAcceleration * 0.8);
    }
    if (multiWindow.buys3s > 0) momentumScore += 6;
    else if (multiWindow.buys10s > 0) momentumScore += 4;
    else if (multiWindow.buys30s >= 2) momentumScore += 3;

    if (multiWindow.volumeAcceleration > 1.2) momentumScore += 6;
    else if (multiWindow.volumeAcceleration > 0.8) momentumScore += 4;
    else momentumScore += 2;

    if ((token as any).isSurging) momentumScore += 6;
    momentumScore = Math.min(30, Math.max(0, momentumScore));

    // 2. BUYER GROWTH SCORE (0 - 25 points)
    // Rewards unique buyers, high buy pressure
    let buyerGrowthScore = 0;
    if (multiWindow.uniqueBuyers30s >= 5) buyerGrowthScore += 12;
    else if (multiWindow.uniqueBuyers30s >= 3) buyerGrowthScore += 8;
    else if (multiWindow.uniqueBuyers30s >= 1) buyerGrowthScore += 4;

    if (multiWindow.windowedBuyPressure30s >= 0.80) buyerGrowthScore += 13;
    else if (multiWindow.windowedBuyPressure30s >= 0.65) buyerGrowthScore += 9;
    else if (multiWindow.windowedBuyPressure30s >= 0.50) buyerGrowthScore += 5;
    else buyerGrowthScore += 1;
    buyerGrowthScore = Math.min(25, Math.max(0, buyerGrowthScore));

    // 3. LIQUIDITY & MARKET QUALITY SCORE (0 - 20 points)
    let liquidityScore = 0;
    if (liquidity >= 50000) liquidityScore += 10;
    else if (liquidity >= 15000) liquidityScore += 8;
    else if (liquidity >= 5000) liquidityScore += 5;
    else liquidityScore += 2;

    const liqMcapRatio = marketCap > 0 ? liquidity / marketCap : 0;
    if (liqMcapRatio >= 0.08 && liqMcapRatio <= 0.60) liquidityScore += 10;
    else if (liqMcapRatio >= 0.04) liquidityScore += 6;
    else liquidityScore += 2;
    liquidityScore = Math.min(20, Math.max(0, liquidityScore));

    // 4. DISCOVERY SCORE (0 - 15 points)
    // Rewards fresh on-chain discovery (LaserStream signal, optimal token age)
    let discoveryScore = 0;
    if (ageMinutes >= 0 && ageMinutes <= 30) discoveryScore += 10;
    else if (ageMinutes <= 120) discoveryScore += 7;
    else if (ageMinutes <= 720) discoveryScore += 4;
    else discoveryScore += 2;

    const signal = (token as any).signal || (token as any).source;
    if (signal === 'LASERSTREAM_ON_CHAIN_TX' || signal === 'ON_CHAIN_TX') discoveryScore += 5;
    else discoveryScore += 2;
    discoveryScore = Math.min(15, Math.max(0, discoveryScore));

    // 5. EXECUTABLE SCORE (0 - 10 points)
    let executableScore = 10;
    if (mint === 'So11111111111111111111111111111111111111112') executableScore = 0;
    if ((token as any).hasUnknownDecimals) executableScore = 0;

    // 6. RISK PENALTIES (0 to -40 points)
    let riskPenalty = 0;
    const devPct = advancedMetrics.devWalletOwnershipPct;
    if (devPct > 15) riskPenalty += 15;
    else if (devPct > 5) riskPenalty += 5;

    const top10Pct = advancedMetrics.top10HoldersPct;
    if (top10Pct > 50) riskPenalty += 15;
    else if (top10Pct > 35) riskPenalty += 8;

    if (security.effectiveRiskScore > 30) {
      riskPenalty += Math.min(20, (security.effectiveRiskScore - 30) * 0.5);
    }

    // Total Composite Score
    const rawTotal = momentumScore + buyerGrowthScore + liquidityScore + discoveryScore + executableScore - riskPenalty;
    const totalScore = Math.max(0, Math.round(rawTotal * 10) / 10);

    const isExecutable = executableScore > 0 && security.status !== 'UNSAFE';

    let recommendedAction: 'BUY' | 'WATCH' | 'IGNORE' = 'IGNORE';
    const buyThreshold = config?.minBuyScoreThreshold ?? 50;

    if (isExecutable && security.status === 'SAFE' && totalScore >= buyThreshold) {
      recommendedAction = 'BUY';
      reasons.push(`HIGH_OPPORTUNITY_SCORE_${totalScore}`);
    } else if (isExecutable && totalScore >= 35) {
      recommendedAction = 'WATCH';
      reasons.push(`MODERATE_OPPORTUNITY_SCORE_${totalScore}`);
    } else {
      reasons.push(`BELOW_THRESHOLD_OR_UNSAFE`);
    }

    return {
      mint,
      symbol,
      discoveryScore,
      momentumScore,
      liquidityScore,
      buyerGrowthScore,
      riskScore: security.effectiveRiskScore,
      executableScore,
      securityStatus: security.status,
      executable: isExecutable,
      totalScore,
      reasons,
      metrics: advancedMetrics,
      multiWindow,
      recommendedAction,
    };
  }

  /**
   * Deduplicate, score, filter, and rank all candidate tokens by expected opportunity.
   */
  public rankCandidates(
    tokens: (TokenMetric | (AdvancedTokenMetrics & Partial<TokenMetric>))[],
    config?: OpportunityScoreConfig
  ): TradeCandidate[] {
    const seenMints = new Set<string>();
    const tradedSet = config?.tradedMints
      ? (config.tradedMints instanceof Set ? config.tradedMints : new Set(config.tradedMints))
      : null;
    const candidates: TradeCandidate[] = [];

    for (const token of tokens) {
      const mint = (token as any).address || (token as any).mintAddress;
      if (!mint || seenMints.has(mint)) continue;
      seenMints.add(mint);

      // If tradeOnlyOnce is active and token was already traded, exclude candidate
      if (config?.tradeOnlyOnce && tradedSet && tradedSet.has(mint)) {
        continue;
      }

      const scored = this.scoreCandidate(token, config);
      // Filter out definitely unsafe or invalid mints from trade consideration
      if (scored.securityStatus === 'UNSAFE' || !scored.executable) continue;

      candidates.push(scored);
    }

    // Sort descending by total composite opportunity score
    return candidates.sort((a, b) => b.totalScore - a.totalScore);
  }
}

export const opportunityScoreEngine = OpportunityScoreEngine.getInstance();
