// server/repositories/TradeRepository.ts
import { readDataFile, updateDataFileAtomic } from '../db/jsonStore.js';

export interface HistoricalTradeRecord {
  id: string;
  orderId?: string;
  positionId?: string;
  mintAddress: string;
  symbol?: string;
  side: 'BUY' | 'SELL';
  network: string;
  wallet?: string;
  amountRaw: string | number;
  amountTokens: number;
  solAmount: number;
  priceSOL: number;
  pnlSol?: number;
  pnlPct?: number;
  signature: string;
  timestamp: number;
  status: 'PENDING' | 'CONFIRMED' | 'FAILED';
  metadata?: Record<string, any>;
  version?: number;
}

const FILE_NAME = 'trades.json';

export class TradeRepository {
  private static instance: TradeRepository;

  private constructor() {}

  public static getInstance(): TradeRepository {
    if (!TradeRepository.instance) {
      TradeRepository.instance = new TradeRepository();
    }
    return TradeRepository.instance;
  }

  private readAll(): HistoricalTradeRecord[] {
    return readDataFile<HistoricalTradeRecord[]>(FILE_NAME, []);
  }

  public getTrades(network?: string): HistoricalTradeRecord[] {
    const all = this.readAll();
    if (network) {
      return all.filter(t => t.network === network);
    }
    return all;
  }

  public recordTrade(trade: HistoricalTradeRecord): boolean {
    let success = false;

    updateDataFileAtomic<HistoricalTradeRecord[]>(FILE_NAME, [], (current) => {
      const existingIdx = current.findIndex(t => {
        if (t.id === trade.id) return true;
        if (trade.signature && trade.signature !== '' && trade.signature !== 'exit-tx' && t.signature === trade.signature) {
          return true;
        }
        return false;
      });

      if (existingIdx !== -1) {
        const existing = current[existingIdx];
        if (existing.status === 'PENDING' && trade.status === 'CONFIRMED') {
          current[existingIdx] = {
            ...existing,
            ...trade,
            version: (existing.version || 1) + 1,
          };
          success = true;
          return current;
        }
        success = false;
        return current;
      }

      current.unshift({
        ...trade,
        version: 1,
      });
      success = true;
      return current;
    });

    return success;
  }

  public addTrade(trade: HistoricalTradeRecord): boolean {
    return this.recordTrade(trade);
  }

  public updateTrade(idOrSignature: string, updates: Partial<HistoricalTradeRecord>): boolean {
    let success = false;

    updateDataFileAtomic<HistoricalTradeRecord[]>(FILE_NAME, [], (current) => {
      const idx = current.findIndex(
        t => t.id === idOrSignature || (t.signature && t.signature === idOrSignature)
      );
      if (idx === -1) {
        success = false;
        return current;
      }

      const existing = current[idx];
      current[idx] = {
        ...existing,
        ...updates,
        version: (existing.version || 1) + 1,
      };
      success = true;
      return current;
    });

    return success;
  }
}

export const tradeRepository = TradeRepository.getInstance();
