// src/services/TradeHistoryRegistry.ts
import { TradingNetwork } from '../config/network';

export interface HistoricalTrade {
  id: string;
  orderId?: string;
  positionId?: string;
  mintAddress: string;
  symbol?: string;
  side: 'BUY' | 'SELL';
  network: TradingNetwork;
  amountRaw: number;
  amountTokens: number;
  solAmount: number;
  priceSOL: number;
  pnlSol?: number;
  pnlPct?: number;
  signature: string;
  timestamp: number;
  status: 'PENDING' | 'CONFIRMED' | 'FAILED';
  metadata?: Record<string, any>;
}

export type TradeHistoryListener = (trades: HistoricalTrade[]) => void;

function isValidTrade(trade: Partial<HistoricalTrade>): boolean {
  if (!trade || typeof trade !== 'object') return false;
  if (!trade.id || typeof trade.id !== 'string') return false;
  if (!trade.mintAddress || typeof trade.mintAddress !== 'string') return false;
  if (trade.side !== 'BUY' && trade.side !== 'SELL') return false;
  if (typeof trade.amountRaw !== 'number' || trade.amountRaw < 0 || !Number.isFinite(trade.amountRaw)) return false;
  if (typeof trade.amountTokens !== 'number' || trade.amountTokens < 0 || !Number.isFinite(trade.amountTokens)) return false;
  if (typeof trade.solAmount !== 'number' || trade.solAmount < 0 || !Number.isFinite(trade.solAmount)) return false;
  if (typeof trade.priceSOL !== 'number' || trade.priceSOL < 0 || !Number.isFinite(trade.priceSOL)) return false;
  if (trade.pnlSol !== undefined && (typeof trade.pnlSol !== 'number' || !Number.isFinite(trade.pnlSol))) return false;
  if (trade.pnlPct !== undefined && (typeof trade.pnlPct !== 'number' || !Number.isFinite(trade.pnlPct))) return false;
  if (typeof trade.timestamp !== 'number' || trade.timestamp <= 0 || !Number.isFinite(trade.timestamp)) return false;
  return true;
}

/**
 * TradeHistoryRegistry: The authoritative store for completed trades.
 * Decoupled from active open positions and active in-flight orders.
 * Features deduplication, input validation, and network isolation.
 */
export class TradeHistoryRegistry {
  private static instance: TradeHistoryRegistry;
  private trades: HistoricalTrade[] = [];
  private listeners: Set<TradeHistoryListener> = new Set();

  private constructor() {
    this.loadTrades();
  }

  public static getInstance(): TradeHistoryRegistry {
    if (!TradeHistoryRegistry.instance) {
      TradeHistoryRegistry.instance = new TradeHistoryRegistry();
    }
    return TradeHistoryRegistry.instance;
  }

  private loadTrades(): void {
    if (typeof localStorage !== 'undefined') {
      try {
        const data = localStorage.getItem('app_trade_history_trades');
        if (data) {
          const list = JSON.parse(data);
          this.trades = list.filter(isValidTrade);
        }
      } catch (e) {
        console.warn('[TradeHistoryRegistry] Failed to load trades from localStorage:', e);
      }
    }
  }

  private syncServer(trade: HistoricalTrade): void {
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('app_trade_history_trades', JSON.stringify(this.trades));
      } catch (e) {
        console.warn('[TradeHistoryRegistry] Failed to sync trades to localStorage:', e);
      }
    }
  }

  public recordTrade(trade: HistoricalTrade): boolean {
    if (!isValidTrade(trade)) {
      console.warn('[TradeHistoryRegistry] Rejected invalid trade:', trade);
      return false;
    }

    // Deduplication by ID or non-empty signature or matching orderId + side
    const existingIdx = this.trades.findIndex(t => {
      if (t.id === trade.id) return true;
      if (trade.signature && trade.signature !== '' && trade.signature !== 'exit-tx' && t.signature === trade.signature) {
        return true;
      }
      if (trade.orderId && t.orderId && t.orderId === trade.orderId && t.side === trade.side) {
        return true;
      }
      return false;
    });

    if (existingIdx !== -1) {
      const existing = this.trades[existingIdx];
      // If existing was PENDING and incoming is CONFIRMED, upgrade it
      if (existing.status === 'PENDING' && trade.status === 'CONFIRMED') {
        this.trades[existingIdx] = { ...existing, ...trade };
        this.syncServer(this.trades[existingIdx]);
        this.notify();
        return true;
      }
      console.log(`[TradeHistoryRegistry] Duplicate trade ignored (id: ${trade.id}, sig: ${trade.signature})`);
      return false;
    }

    this.trades.unshift(trade);
    if (this.trades.length > 500) {
      this.trades = this.trades.slice(0, 500);
    }
    this.syncServer(trade);
    this.notify();
    return true;
  }

  public updateTrade(idOrSignature: string, updates: Partial<HistoricalTrade>): boolean {
    if (!idOrSignature) return false;
    const idx = this.trades.findIndex(
      t => t.id === idOrSignature || t.signature === idOrSignature || (t.orderId && t.orderId === idOrSignature)
    );
    if (idx === -1) return false;

    // Validate updates
    if (updates.amountRaw !== undefined && (typeof updates.amountRaw !== 'number' || updates.amountRaw < 0 || !Number.isFinite(updates.amountRaw))) return false;
    if (updates.solAmount !== undefined && (typeof updates.solAmount !== 'number' || updates.solAmount < 0 || !Number.isFinite(updates.solAmount))) return false;
    if (updates.pnlSol !== undefined && (typeof updates.pnlSol !== 'number' || !Number.isFinite(updates.pnlSol))) return false;
    if (updates.pnlPct !== undefined && (typeof updates.pnlPct !== 'number' || !Number.isFinite(updates.pnlPct))) return false;
    if (updates.side !== undefined && updates.side !== 'BUY' && updates.side !== 'SELL') return false;

    this.trades[idx] = { ...this.trades[idx], ...updates };
    this.syncServer(this.trades[idx]);
    this.notify();
    return true;
  }

  public getTrades(network?: TradingNetwork): HistoricalTrade[] {
    if (network) {
      return this.trades.filter(t => t.network === network);
    }
    return this.trades;
  }

  public getTradesByMint(mintAddress: string): HistoricalTrade[] {
    return this.trades.filter(t => t.mintAddress === mintAddress);
  }

  public subscribe(listener: TradeHistoryListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.trades);
      } catch (err) {
        console.error('[TradeHistoryRegistry] Error in listener:', err);
      }
    }
  }
}

export const tradeHistoryRegistry = TradeHistoryRegistry.getInstance();
