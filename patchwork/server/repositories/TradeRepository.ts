// server/repositories/TradeRepository.ts
import { readDataFile, writeDataFile } from '../db/jsonStore.js';

export interface HistoricalTradeRecord {
  id: string;
  orderId?: string;
  positionId?: string;
  mintAddress: string;
  symbol?: string;
  side: 'BUY' | 'SELL';
  network: string;
  wallet?: string;
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

const FILE_NAME = 'trades.json';

export class TradeRepository {
  private static instance: TradeRepository;
  private trades: HistoricalTradeRecord[] = [];

  private constructor() {
    this.load();
  }

  public static getInstance(): TradeRepository {
    if (!TradeRepository.instance) {
      TradeRepository.instance = new TradeRepository();
    }
    return TradeRepository.instance;
  }

  private load(): void {
    this.trades = readDataFile<HistoricalTradeRecord[]>(FILE_NAME, []);
  }

  private save(): void {
    writeDataFile(FILE_NAME, this.trades);
  }

  public getTrades(network?: string): HistoricalTradeRecord[] {
    if (network) {
      return this.trades.filter(t => t.network === network);
    }
    return this.trades;
  }

  public recordTrade(trade: HistoricalTradeRecord): boolean {
    const existingIdx = this.trades.findIndex(t => {
      if (t.id === trade.id) return true;
      if (trade.signature && trade.signature !== '' && trade.signature !== 'exit-tx' && t.signature === trade.signature) {
        return true;
      }
      return false;
    });

    if (existingIdx !== -1) {
      const existing = this.trades[existingIdx];
      if (existing.status === 'PENDING' && trade.status === 'CONFIRMED') {
        this.trades[existingIdx] = { ...existing, ...trade };
        this.save();
        return true;
      }
      return false;
    }

    this.trades.unshift(trade);

    this.save();
    return true;
  }

  public addTrade(trade: HistoricalTradeRecord): boolean {
    return this.recordTrade(trade);
  }

  public updateTrade(idOrSignature: string, updates: Partial<HistoricalTradeRecord>): boolean {
    const idx = this.trades.findIndex(
      t => t.id === idOrSignature || t.signature === idOrSignature
    );
    if (idx === -1) return false;

    this.trades[idx] = { ...this.trades[idx], ...updates };
    this.save();
    return true;
  }
}

export const tradeRepository = TradeRepository.getInstance();
