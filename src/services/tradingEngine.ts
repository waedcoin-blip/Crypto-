// src/services/tradingEngine.ts
// Unified Trading Engine for ARINA X-RAY
// Client-side API wrapper delegating execution strictly to backend /api/trading/buy and /api/trading/sell.

import { apiClient } from './apiClient';
import { useTradingEnvironmentStore } from '../store/tradingEnvironmentStore';

export interface BuyRequest {
  mint: string;
  amountSol: number;
  slippageBps?: number;
  label?: string;
  network?: string;
  wallet?: string;
}

export interface SellRequest {
  mint: string;
  percent?: number;
  rawAmount?: bigint | string;
  reason?: string;
  slippageBps?: number;
  network?: string;
  wallet?: string;
}

class TradingEngine {
  /**
   * Execute a Buy order via backend endpoint /api/trading/buy.
   */
  public async buy(request: BuyRequest): Promise<any> {
    const network = request.network || useTradingEnvironmentStore.getState().network || 'paper';
    const wallet = request.wallet || 'default';
    const res = await apiClient.post('/api/trading/buy', {
      network,
      wallet,
      mint: request.mint,
      amountSol: request.amountSol,
      slippageBps: request.slippageBps || 100,
      label: request.label || 'entry',
    });
    if (!res || !res.success) {
      throw new Error(res?.error || 'Buy trade failed');
    }
    return res;
  }

  /**
   * Execute a Sell order via backend endpoint /api/trading/sell.
   */
  public async sell(request: SellRequest): Promise<any> {
    const network = request.network || useTradingEnvironmentStore.getState().network || 'paper';
    const wallet = request.wallet || 'default';
    const res = await apiClient.post('/api/trading/sell', {
      network,
      wallet,
      mint: request.mint,
      amountRaw: request.rawAmount ? request.rawAmount.toString() : undefined,
      percent: request.percent,
      slippageBps: request.slippageBps || 150,
      reason: request.reason || 'MANUAL',
    });
    if (!res || !res.success) {
      throw new Error(res?.error || 'Sell trade failed');
    }
    return res;
  }

  /**
   * Partial sell helper (sell X% of current holdings).
   */
  public async partialSell(mint: string, percent: number, reason: string = 'PARTIAL_TRIM'): Promise<any> {
    return this.sell({ mint, percent, reason });
  }

  /**
   * Full sell helper (sell 100% of current holdings).
   */
  public async fullSell(mint: string, reason: string = 'FULL_EXIT'): Promise<any> {
    return this.sell({ mint, percent: 100, reason });
  }
}

export const tradingEngine = new TradingEngine();
