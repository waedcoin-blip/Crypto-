// server/repositories/TradeRepository.ts
import { JsonStore } from './JsonStore.js';

export interface TradeRecord {
  id: string;
  orderId?: string;
  positionId?: string;
  mintAddress: string;
  side: 'BUY' | 'SELL';
  network: string;
  wallet: string;
  amountRaw: string;
  amountTokens: number;
  solAmount: number;
  priceSOL: number;
  signature?: string;
  timestamp: number;
  status: 'PENDING' | 'CONFIRMED' | 'FAILED';
  pnlSol?: number;
  pnlPct?: number;
}

/**
 * TradeRepository: Authoritative persistence layer for completed trade history.
 * Features deduplication, input validation, and network isolation.
 */
export class TradeRepository {
  private static instance: TradeRepository;
  private store: JsonStore<TradeRecord[]>;
  private readonly MAX_TRADES = 2000;

  private constructor() {
    this.store = new JsonStore<TradeRecord[]>('trades.json', []);
  }

  public static getInstance(): TradeRepository {
    if (!TradeRepository.instance) {
      TradeRepository.instance = new TradeRepository();
    }
    return TradeRepository.instance;
  }

  /**
   * Record a new trade with deduplication and validation.
   */
  public recordTrade(trade: Omit<TradeRecord, 'id'> & { id?: string }): boolean {
    // Validate required fields
    if (!this.validateTrade(trade)) {
      console.warn('[TradeRepository] Invalid trade rejected:', trade.mintAddress);
      return false;
    }

    const all = this.store.read();

    // Deduplication check
    const isDuplicate = all.some(t => {
      if (trade.id && t.id === trade.id) return true;
      if (trade.signature && t.signature === trade.signature && trade.signature !== 'exit-tx') return true;
      if (trade.orderId && t.orderId && t.orderId === trade.orderId && t.side === trade.side) return true;
      return false;
    });

    if (isDuplicate) {
      // Upgrade PENDING → CONFIRMED if applicable
      const existingIdx = all.findIndex(t => {
        if (trade.id && t.id === trade.id) return true;
        if (trade.signature && t.signature === trade.signature) return true;
        if (trade.orderId && t.orderId && t.orderId === trade.orderId && t.side === trade.side) return true;
        return false;
      });
      if (existingIdx !== -1 && all[existingIdx].status === 'PENDING' && trade.status === 'CONFIRMED') {
        all[existingIdx] = { ...all[existingIdx], ...trade, status: 'CONFIRMED' };
        this.store.write(all);
      }
      return false;
    }

    // Add new trade
    const newTrade: TradeRecord = {
      ...trade,
      id: trade.id || `trade_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    };
    all.unshift(newTrade);

    // Cap at MAX_TRADES
    if (all.length > this.MAX_TRADES) {
      all.length = this.MAX_TRADES;
    }

    this.store.write(all);
    return true;
  }

  /**
   * Update an existing trade by ID or signature.
   */
  public updateTrade(idOrSignature: string, updates: Partial<TradeRecord>): boolean {
    const all = this.store.read();
    const idx = all.findIndex(t =>
      t.id === idOrSignature ||
      t.signature === idOrSignature ||
      (t.orderId && t.orderId === idOrSignature)
    );
    if (idx === -1) return false;

    // Validate updates
    if (updates.solAmount !== undefined && (typeof updates.solAmount !== 'number' || updates.solAmount < 0)) return false;
    if (updates.pnlSol !== undefined && (typeof updates.pnlSol !== 'number' || !Number.isFinite(updates.pnlSol))) return false;
    if (updates.pnlPct !== undefined && (typeof updates.pnlPct !== 'number' || !Number.isFinite(updates.pnlPct))) return false;

    all[idx] = { ...all[idx], ...updates };
    this.store.write(all);
    return true;
  }

  public getTrades(network?: string): TradeRecord[] {
    const all = this.store.read();
    if (network) return all.filter(t => t.network === network);
    return all;
  }

  private validateTrade(trade: any): boolean {
    if (!trade || typeof trade !== 'object') return false;
    if (!trade.mintAddress || typeof trade.mintAddress !== 'string') return false;
    if (trade.side !== 'BUY' && trade.side !== 'SELL') return false;
    if (typeof trade.solAmount !== 'number' || trade.solAmount < 0 || !Number.isFinite(trade.solAmount)) return false;
    if (typeof trade.priceSOL !== 'number' || trade.priceSOL < 0 || !Number.isFinite(trade.priceSOL)) return false;
    return true;
  }
}

export const tradeRepository = TradeRepository.getInstance();
