// server/trading/MomentumEngine.ts
import { EnrichedCandidate } from './CandidateEnricher.js';
import { bondingCurveFastLane } from './BondingCurveFastLane.js';
import { migrationDetector } from './MigrationDetector.js';

export interface MomentumMetrics {
  mint: string;
  priceVelocity: number; // % change last 15s
  priceAcceleration: number; // velocity change rate

  buyVelocity: number; // buys last 15s
  buyAcceleration: number; // buy rate change

  sellVelocity: number; // sells last 15s
  sellAcceleration: number; // sell rate change

  volumeVelocity: number; // SOL vol last 15s
  volumeAcceleration: number; // vol change rate

  uniqueBuyerVelocity: number;
  uniqueBuyerAcceleration: number;

  transactionVelocity: number; // total tx/s
  liquidityVelocity: number;
  liquidityAcceleration: number;

  buySellRatio: number;
  netBuyPressure: number;
  bondingCurveVelocity: number;
  migrationMomentum: number;
  
  momentumScore: number;
}

export interface MomentumConfig {
  weightPriceAcceleration: number;
  weightBuyAcceleration: number;
  weightVolumeAcceleration: number;
  weightUniqueBuyerAcceleration: number;
  weightBuySellImbalance: number;
  weightLiquidityAcceleration: number;
  weightBondingCurveVelocity: number;
  weightMigrationMomentum: number;
}

export class MomentumEngine {
  private static instance: MomentumEngine;
  private tokenHistory: Map<string, Array<{ price: number; isBuy: boolean; solAmount: number; buyer: string; timestamp: number }>> = new Map();
  private prevMetrics: Map<string, MomentumMetrics> = new Map();

  private config: MomentumConfig = {
    weightPriceAcceleration: 0.20,
    weightBuyAcceleration: 0.15,
    weightVolumeAcceleration: 0.15,
    weightUniqueBuyerAcceleration: 0.10,
    weightBuySellImbalance: 0.15,
    weightLiquidityAcceleration: 0.10,
    weightBondingCurveVelocity: 0.05,
    weightMigrationMomentum: 0.10,
  };

  private constructor() {
    setInterval(() => this.pruneHistory(), 60000);
  }

  public static getInstance(): MomentumEngine {
    if (!MomentumEngine.instance) {
      MomentumEngine.instance = new MomentumEngine();
    }
    return MomentumEngine.instance;
  }

  public setConfig(config: Partial<MomentumConfig>): void {
    this.config = { ...this.config, ...config };
  }

  public getConfig(): MomentumConfig {
    return { ...this.config };
  }

  /**
   * Record trade event for a token to build historical momentum metrics
   */
  public recordTrade(mint: string, price: number, isBuy: boolean, solAmount: number, buyer: string): void {
    let history = this.tokenHistory.get(mint);
    if (!history) {
      history = [];
      this.tokenHistory.set(mint, history);
    }
    history.push({ price, isBuy, solAmount, buyer, timestamp: Date.now() });
  }

  /**
   * Analyzes an enriched candidate's live velocities and calculates its comprehensive momentum score.
   */
  public calculateMomentum(candidate: EnrichedCandidate): MomentumMetrics {
    const mint = candidate.mintAddress;
    const now = Date.now();
    const history = this.tokenHistory.get(mint) || [];

    // Rolling windows
    const window15s = history.filter(x => now - x.timestamp <= 15000);
    const window30s = history.filter(x => now - x.timestamp <= 30000 && now - x.timestamp > 15000);

    const price15s = window15s.length > 0 ? window15s[window15s.length - 1].price : (candidate.priceSol?.value || 0.000001);
    const price30s = window30s.length > 0 ? window30s[window30s.length - 1].price : price15s;

    // Price velocities and acceleration
    const priceVelocity = price30s > 0 ? ((price15s - price30s) / price30s) * 100 : 0;
    const prevMetrics = this.prevMetrics.get(mint);
    const prevPriceVelocity = prevMetrics?.priceVelocity || 0;
    const priceAcceleration = priceVelocity - prevPriceVelocity;

    // Buy/Sell counts
    const buys15s = window15s.filter(x => x.isBuy).length;
    const sells15s = window15s.filter(x => !x.isBuy).length;
    const buys30s = window30s.filter(x => x.isBuy).length;
    const sells30s = window30s.filter(x => !x.isBuy).length;

    const buyVelocity = buys15s;
    const buyAcceleration = buys15s - buys30s;

    const sellVelocity = sells15s;
    const sellAcceleration = sells15s - sells30s;

    // Volume
    const vol15s = window15s.reduce((sum, x) => sum + x.solAmount, 0);
    const vol30s = window30s.reduce((sum, x) => sum + x.solAmount, 0);
    const volumeVelocity = vol15s;
    const volumeAcceleration = vol15s - vol30s;

    // Unique buyers
    const uniq15s = new Set(window15s.filter(x => x.isBuy).map(x => x.buyer)).size;
    const uniq30s = new Set(window30s.filter(x => x.isBuy).map(x => x.buyer)).size;
    const uniqueBuyerVelocity = uniq15s;
    const uniqueBuyerAcceleration = uniq15s - uniq30s;

    const transactionVelocity = (window15s.length) / 15;

    // Liquidity acceleration
    const liquidityVelocity = (candidate as any).liquiditySol?.value || (candidate.liquidityUsd?.value ? candidate.liquidityUsd.value / 150 : 0);
    const prevLiqVelocity = prevMetrics?.liquidityVelocity || 0;
    const liquidityAcceleration = liquidityVelocity - prevLiqVelocity;

    const buySellRatio = sells15s > 0 ? buys15s / sells15s : buys15s;
    const netBuyPressure = buys15s - sells15s;

    // Fetch bonding curve and migration fast-lane statistics
    const bCurve = bondingCurveFastLane.getState(mint);
    const bondingCurveVelocity = bCurve ? bCurve.buyVelocity : 0;

    const migration = migrationDetector.getMigratedPool(mint);
    const migrationMomentum = migration ? migration.postMigrationMomentumScore : 0;

    // Score synthesis
    let rawScore = 0;

    // Price Acceleration Component (up to 100)
    const scorePriceAcc = Math.max(0, Math.min(100, (priceAcceleration > 0 ? priceAcceleration * 10 : 0)));
    rawScore += scorePriceAcc * this.config.weightPriceAcceleration;

    // Buy Acceleration Component (up to 100)
    const scoreBuyAcc = Math.max(0, Math.min(100, buyAcceleration * 5));
    rawScore += scoreBuyAcc * this.config.weightBuyAcceleration;

    // Volume Acceleration Component (up to 100)
    const scoreVolAcc = Math.max(0, Math.min(100, volumeAcceleration * 15));
    rawScore += scoreVolAcc * this.config.weightVolumeAcceleration;

    // Unique Buyer Acceleration (up to 100)
    const scoreUniqAcc = Math.max(0, Math.min(100, uniqueBuyerAcceleration * 10));
    rawScore += scoreUniqAcc * this.config.weightUniqueBuyerAcceleration;

    // Buy/Sell imbalance (up to 100)
    const scoreImbalance = Math.max(0, Math.min(100, buySellRatio * 15));
    rawScore += scoreImbalance * this.config.weightBuySellImbalance;

    // Liquidity Acceleration Component (up to 100)
    const scoreLiqAcc = Math.max(0, Math.min(100, (liquidityAcceleration > 0 ? liquidityAcceleration * 5 : 0)));
    rawScore += scoreLiqAcc * this.config.weightLiquidityAcceleration;

    // Bonding curve progress velocity (up to 100)
    const scoreBCurve = Math.max(0, Math.min(100, bondingCurveVelocity * 4));
    rawScore += scoreBCurve * this.config.weightBondingCurveVelocity;

    // Migration momentum (up to 100)
    const scoreMigration = migrationMomentum;
    rawScore += scoreMigration * this.config.weightMigrationMomentum;

    // Normalizing Score (0-100)
    let momentumScore = Math.max(0, Math.min(100, rawScore));

    // Safety and State Penalties
    if (sellAcceleration > buyAcceleration) {
      momentumScore -= Math.min(15, (sellAcceleration - buyAcceleration) * 2); // Penalty for accelerating sells
    }
    if (candidate.riskScore.value !== null && candidate.riskScore.value > 50) {
      momentumScore -= 10; // Penalty for suspicious risk profile
    }
    if (candidate.ageMinutes.value !== null && candidate.ageMinutes.value > 120) {
      momentumScore -= 5; // Slight penalty for aged stale tokens
    }

    const metrics: MomentumMetrics = {
      mint,
      priceVelocity,
      priceAcceleration,
      buyVelocity,
      buyAcceleration,
      sellVelocity,
      sellAcceleration,
      volumeVelocity,
      volumeAcceleration,
      uniqueBuyerVelocity,
      uniqueBuyerAcceleration,
      transactionVelocity,
      liquidityVelocity,
      liquidityAcceleration,
      buySellRatio,
      netBuyPressure,
      bondingCurveVelocity,
      migrationMomentum,
      momentumScore: Math.max(0, Math.min(100, momentumScore)),
    };

    this.prevMetrics.set(mint, metrics);
    return metrics;
  }

  private pruneHistory(): void {
    const now = Date.now();
    const maxAgeMs = 5 * 60 * 1000; // Keep only 5 minutes of historical trades for momentum calculation

    for (const [mint, list] of this.tokenHistory.entries()) {
      const active = list.filter(x => now - x.timestamp <= maxAgeMs);
      if (active.length === 0) {
        this.tokenHistory.delete(mint);
        this.prevMetrics.delete(mint);
      } else {
        this.tokenHistory.set(mint, active);
      }
    }
  }
}

export const momentumEngine = MomentumEngine.getInstance();
