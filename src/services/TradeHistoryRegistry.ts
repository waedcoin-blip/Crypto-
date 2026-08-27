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

/**
 * TradeHistoryRegistry: The authoritative store for completed trades.
 * Decoupled from active open positions and active in-flight orders.
 */
export class TradeHistoryRegistry {
  private static instance: TradeHistoryRegistry;
  private trades: HistoricalTrade[] = [];
  private listeners: Set<TradeHistoryListener> = new Set();

  private constructor() {
    this.loadPersistedTrades();
  }

  public static getInstance(): TradeHistoryRegistry {
    if (!TradeHistoryRegistry.instance) {
      TradeHistoryRegistry.instance = new TradeHistoryRegistry();
    }
    return TradeHistoryRegistry.instance;
  }

  private loadPersistedTrades(): void {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem('app_trade_history_registry');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.trades = parsed;
        }
      }
    } catch (e) {
      console.warn('[TradeHistoryRegistry] Failed to load persisted trades:', e);
    }
  }

  private persist(): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem('app_trade_history_registry', JSON.stringify(this.trades.slice(-200)));
    } catch (e) {
      console.warn('[TradeHistoryRegistry] Failed to persist trades:', e);
    }
  }

  public recordTrade(trade: HistoricalTrade): void {
    this.trades.unshift(trade);
    if (this.trades.length > 200) {
      this.trades = this.trades.slice(0, 200);
    }
    this.persist();
    this.notify();
  }

  public updateTrade(idOrSignature: string, updates: Partial<HistoricalTrade>): void {
    const idx = this.trades.findIndex(t => t.id === idOrSignature || t.signature === idOrSignature || (t.orderId && t.orderId === idOrSignature));
    if (idx !== -1) {
      this.trades[idx] = { ...this.trades[idx], ...updates };
      this.persist();
      this.notify();
    }
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
