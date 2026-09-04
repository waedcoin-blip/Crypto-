// src/services/PositionPnLEngine.ts
import { calcNetPnl, NetPnlResult, getSolPriceUsd } from '../utils/pnlCalculator';
import { resolveTokenDecimals } from './PaperTradeExecutor';

export interface PositionPnLMetrics {
  mint: string;
  amountRaw: number;
  decimals: number;
  tokenQty: number;
  entryPriceSol: number;
  solSpent: number;
  currentPriceSol: number;
  peakPriceSol: number;
  grossPnlSol: number;
  grossPnlPct: number;
  netPnlSol: number;
  netPnlPct: number;
  peakPnLPct: number;
  drawdownPct: number; // ((peakPrice - currentPrice) / peakPrice) * 100
  lastUpdateTimestamp: number;
  isStale: boolean;
}

/**
 * PositionPnLEngine: Authoritative single source of truth for PnL, price tracking,
 * peak detection, and drawdown calculations across UI, RiskManager, and Exit Engines.
 */
export class PositionPnLEngine {
  private static instance: PositionPnLEngine;

  public static getInstance(): PositionPnLEngine {
    if (!PositionPnLEngine.instance) {
      PositionPnLEngine.instance = new PositionPnLEngine();
    }
    return PositionPnLEngine.instance;
  }

  /**
   * Calculates comprehensive PnL metrics for a position.
   */
  public calculateMetrics(params: {
    mint: string;
    amountRaw: number;
    solSpent: number;
    currentPriceSol: number;
    entryPriceSol?: number;
    decimals?: number;
    peakPriceSol?: number;
    highestPnLPct?: number;
    slippageBps?: number;
    lastUpdateTimestamp?: number;
    staleThresholdMs?: number;
  }): PositionPnLMetrics {
    const {
      mint,
      amountRaw,
      solSpent,
      currentPriceSol,
      peakPriceSol,
      highestPnLPct,
      slippageBps = 250,
      lastUpdateTimestamp = Date.now(),
      staleThresholdMs = 5000,
    } = params;

    let decimals = params.decimals;
    if (decimals === undefined || typeof decimals !== 'number') {
      try {
        decimals = resolveTokenDecimals(mint);
      } catch {
        decimals = 6;
      }
    }

    const safeAmountRaw = Math.max(0, Math.floor(amountRaw || 0));
    const safeSolSpent = Math.max(0, solSpent || 0);
    const tokenQty = safeAmountRaw / Math.pow(10, decimals);

    let effectiveEntryPrice = params.entryPriceSol || 0;
    if (effectiveEntryPrice <= 0 && tokenQty > 0 && safeSolSpent > 0) {
      effectiveEntryPrice = safeSolSpent / tokenQty;
    }

    const grossPnlSol = (tokenQty * currentPriceSol) - safeSolSpent;
    const grossPnlPct = safeSolSpent > 0 ? (grossPnlSol / safeSolSpent) * 100 : (tokenQty * currentPriceSol > 0 ? 100 : 0);
    const netPnlSol = grossPnlSol;
    const netPnlPct = grossPnlPct;

    const effectivePeakPrice = Math.max(peakPriceSol || 0, currentPriceSol, effectiveEntryPrice);
    
    // Drawdown from peak calculation: ((peakPrice - currentPrice) / peakPrice) * 100
    let drawdownPct = 0;
    if (effectivePeakPrice > 0 && currentPriceSol < effectivePeakPrice) {
      drawdownPct = ((effectivePeakPrice - currentPriceSol) / effectivePeakPrice) * 100;
    }

    const effectiveHighestPnl = Math.max(highestPnLPct || 0, grossPnlPct);
    const isStale = Date.now() - lastUpdateTimestamp > staleThresholdMs;

    return {
      mint,
      amountRaw: safeAmountRaw,
      decimals,
      tokenQty,
      entryPriceSol: effectiveEntryPrice,
      solSpent: safeSolSpent,
      currentPriceSol,
      peakPriceSol: effectivePeakPrice,
      grossPnlSol,
      grossPnlPct,
      netPnlSol,
      netPnlPct,
      peakPnLPct: effectiveHighestPnl,
      drawdownPct,
      lastUpdateTimestamp,
      isStale,
    };
  }

  public calculateGrossPnLPct(entryPriceSol: number, currentPriceSol: number): number {
    if (entryPriceSol <= 0 || currentPriceSol <= 0) return 0;
    return ((currentPriceSol - entryPriceSol) / entryPriceSol) * 100;
  }
}

export const positionPnLEngine = PositionPnLEngine.getInstance();
