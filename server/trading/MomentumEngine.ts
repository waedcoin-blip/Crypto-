// server/trading/MomentumEngine.ts
import { EnrichedCandidate } from './CandidateEnricher.js';
import { logger } from '../utils/logger.js';

export interface MomentumMetrics {
  mint: string;
  priceVelocity: number; // % change per second
  priceAcceleration: number; // change in velocity
  buyVelocity: number; // buys per second
  buyAcceleration: number;
  sellVelocity: number; // sells per second
  sellAcceleration: number;
  volumeVelocity: number; // SOL per second
  volumeAcceleration: number;
  uniqueBuyerVelocity: number;
  uniqueBuyerAcceleration: number;
  transactionVelocity: number;
  liquidityVelocity: number;
  liquidityAcceleration: number;
  buySellRatio: number;
  netBuyPressure: number;
  bondingCurveVelocity: number;
  migrationMomentum: number;
  momentumScore: number; // 0-100
}

interface TradeEvent {
  price: number;
  isBuy: boolean;
  solAmount: number;
  buyer: string;
  timestamp: number;
}

export class MomentumEngine {
  private static instance: MomentumEngine;
  private tradeHistory: Map<string, TradeEvent[]> = new Map();
  private lastMetrics: Map<string, MomentumMetrics> = new Map();
  private readonly WINDOW_MS = 30000; // 30 second analysis window
  private readonly MAX_EVENTS_PER_TOKEN = 1000;

  private constructor() {
    // FIX: Periodic cleanup with .unref() to prevent memory leaks
    const cleanupInterval = setInterval(() => this.cleanupOldTrades(), 60000);
    if (cleanupInterval.unref) cleanupInterval.unref();
  }

  public static getInstance(): MomentumEngine {
    if (!MomentumEngine.instance) {
      MomentumEngine.instance = new MomentumEngine();
    }
    return MomentumEngine.instance;
  }

  // ==========================================
  // EVENT RECORDING
  // ==========================================

  public recordEvent(mint: string, event: {
    price: number;
    isBuy: boolean;
    solAmount: number;
    buyer: string;
    timestamp?: number;
  }): void {
    const key = mint.trim().toLowerCase();
    let events = this.tradeHistory.get(key);
    if (!events) {
      events = [];
      this.tradeHistory.set(key, events);
    }

    events.push({
      ...event,
      timestamp: event.timestamp || Date.now(),
    });

    // Cap events per token
    if (events.length > this.MAX_EVENTS_PER_TOKEN) {
      events.splice(0, events.length - this.MAX_EVENTS_PER_TOKEN);
    }
  }

  // ==========================================
  // MOMENTUM CALCULATION
  // ==========================================

  public calculateMomentum(candidate: EnrichedCandidate): MomentumMetrics {
    const key = candidate.mint.trim().toLowerCase();
    const events = this.tradeHistory.get(key) || [];
    const now = Date.now();
    const windowStart = now - this.WINDOW_MS;

    // Filter events to current window
    const recent = events.filter(e => e.timestamp >= windowStart);

    // Split window into two halves for acceleration calculation
    const midPoint = now - (this.WINDOW_MS / 2);
    const firstHalf = recent.filter(e => e.timestamp < midPoint);
    const secondHalf = recent.filter(e => e.timestamp >= midPoint);

    const halfWindowSec = (this.WINDOW_MS / 2) / 1000;

    // 1. Buy/Sell counts and velocities
    const buys1 = firstHalf.filter(e => e.isBuy).length;
    const buys2 = secondHalf.filter(e => e.isBuy).length;
    const buyVel1 = buys1 / halfWindowSec;
    const buyVel2 = buys2 / halfWindowSec;
    const buyVelocity = buyVel2;
    const buyAcceleration = (buyVel2 - buyVel1) / halfWindowSec;

    const sells1 = firstHalf.filter(e => !e.isBuy).length;
    const sells2 = secondHalf.filter(e => !e.isBuy).length;
    const sellVel1 = sells1 / halfWindowSec;
    const sellVel2 = sells2 / halfWindowSec;
    const sellVelocity = sellVel2;
    const sellAcceleration = (sellVel2 - sellVel1) / halfWindowSec;

    // 2. Volume velocities
    const vol1 = firstHalf.reduce((sum, e) => sum + e.solAmount, 0);
    const vol2 = secondHalf.reduce((sum, e) => sum + e.solAmount, 0);
    const volVel1 = vol1 / halfWindowSec;
    const volVel2 = vol2 / halfWindowSec;
    const volumeVelocity = volVel2;
    const volumeAcceleration = (volVel2 - volVel1) / halfWindowSec;

    // 3. Unique buyers
    const buyers1 = new Set(firstHalf.filter(e => e.isBuy).map(e => e.buyer)).size;
    const buyers2 = new Set(secondHalf.filter(e => e.isBuy).map(e => e.buyer)).size;
    const uniqueBuyerVel1 = buyers1 / halfWindowSec;
    const uniqueBuyerVel2 = buyers2 / halfWindowSec;
    const uniqueBuyerVelocity = uniqueBuyerVel2;
    const uniqueBuyerAcceleration = (uniqueBuyerVel2 - uniqueBuyerVel1) / halfWindowSec;

    // 4. Price velocities
    const prices1 = firstHalf.map(e => e.price).filter(p => p > 0);
    const prices2 = secondHalf.map(e => e.price).filter(p => p > 0);
    const startPrice = prices1[0] || prices2[0] || candidate.priceSol?.value || 0;
    const midPrice = prices1[prices1.length - 1] || startPrice;
    const endPrice = prices2[prices2.length - 1] || midPrice;

    const priceChange1 = startPrice > 0 ? ((midPrice - startPrice) / startPrice) * 100 : 0;
    const priceChange2 = midPrice > 0 ? ((endPrice - midPrice) / midPrice) * 100 : 0;
    const priceVel1 = priceChange1 / halfWindowSec;
    const priceVel2 = priceChange2 / halfWindowSec;
    const priceVelocity = priceVel2;
    const priceAcceleration = (priceVel2 - priceVel1) / halfWindowSec;

    // 5. Ratios and composite metrics
    const totalBuys = buys1 + buys2;
    const totalSells = sells1 + sells2;
    const buySellRatio = totalSells > 0 ? totalBuys / totalSells : totalBuys > 0 ? 10 : 1;
    const netBuyPressure = (vol2 - firstHalf.reduce((sum, e) => e.isBuy ? sum : sum + e.solAmount, 0));
    const transactionVelocity = recent.length / (this.WINDOW_MS / 1000);

    // 6. Bonding curve / Migration momentum
    const bondingCurveVelocity = 0; // populated by BondingCurveFastLane if applicable
    const migrationMomentum = candidate.dexId ? 50 : 0;

    // 7. Composite momentum score (0-100)
    let score = 50; // Neutral baseline
    if (priceAcceleration > 0) score += Math.min(15, priceAcceleration * 5);
    if (priceAcceleration < 0) score -= Math.min(20, Math.abs(priceAcceleration) * 5);
    if (buyAcceleration > 0) score += Math.min(15, buyAcceleration * 10);
    if (volumeAcceleration > 0) score += Math.min(10, volumeAcceleration * 2);
    if (uniqueBuyerAcceleration > 0) score += Math.min(10, uniqueBuyerAcceleration * 5);
    if (buySellRatio > 2) score += Math.min(10, (buySellRatio - 2) * 3);
    if (buySellRatio < 0.5) score -= Math.min(15, (0.5 - buySellRatio) * 20);

    const clampedScore = Math.max(0, Math.min(100, Math.round(score)));

    const metrics: MomentumMetrics = {
      mint: candidate.mint,
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
      liquidityVelocity: 0,
      liquidityAcceleration: 0,
      buySellRatio,
      netBuyPressure,
      bondingCurveVelocity,
      migrationMomentum,
      momentumScore: clampedScore,
    };

    this.lastMetrics.set(key, metrics);
    return metrics;
  }

  public getMetrics(mint: string): MomentumMetrics | undefined {
    return this.lastMetrics.get(mint.trim().toLowerCase());
  }

  public getMomentum(mint: string): MomentumMetrics | undefined {
    return this.getMetrics(mint);
  }

  // ==========================================
  // CLEANUP
  // ==========================================

  private cleanupOldTrades(): void {
    const cutoff = Date.now() - (this.WINDOW_MS * 2);
    for (const [key, events] of this.tradeHistory.entries()) {
      const filtered = events.filter(e => e.timestamp >= cutoff);
      if (filtered.length === 0) {
        this.tradeHistory.delete(key);
      } else {
        this.tradeHistory.set(key, filtered);
      }
    }
  }

  public clear(): void {
    this.tradeHistory.clear();
    this.lastMetrics.clear();
  }
}

export const momentumEngine = MomentumEngine.getInstance();
