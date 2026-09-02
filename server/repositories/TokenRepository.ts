// server/repositories/TokenRepository.ts
import { readDataFile, updateDataFileAtomic } from '../db/jsonStore.js';

export interface TokenRecord {
  mintAddress: string;
  symbol?: string;
  name?: string;
  decimals?: number;
  network: string;
  priceSOL?: number;
  priceUSD?: number;
  liquidity?: number;
  marketCap?: number;
  volume24h?: number;
  discoveredAt: number;
  updatedAt: number;
  signal?: string;
  signalConfidence?: number;
  executionState?: string;
  positionId?: string;
  metadata?: Record<string, any>;
  version?: number;
}

const FILE_NAME = 'tokens.json';

export class TokenRepository {
  private static instance: TokenRepository;

  private constructor() {}

  public static getInstance(): TokenRepository {
    if (!TokenRepository.instance) {
      TokenRepository.instance = new TokenRepository();
    }
    return TokenRepository.instance;
  }

  private readAll(): TokenRecord[] {
    return readDataFile<TokenRecord[]>(FILE_NAME, []);
  }

  public getToken(mint: string): TokenRecord | undefined {
    const cleanMint = mint.trim();
    return this.readAll().find(t => t.mintAddress.trim() === cleanMint);
  }

  public getTokens(): TokenRecord[] {
    return this.readAll();
  }

  public upsertToken(record: TokenRecord): TokenRecord {
    const mint = record.mintAddress.trim();
    let result = record;

    updateDataFileAtomic<TokenRecord[]>(FILE_NAME, [], (current) => {
      const idx = current.findIndex(t => t.mintAddress.trim() === mint);
      const now = Date.now();
      if (idx !== -1) {
        const existing = current[idx];
        const merged: TokenRecord = {
          ...existing,
          ...record,
          version: (existing.version || 1) + 1,
          updatedAt: now,
        };
        current[idx] = merged;
        result = merged;
      } else {
        const newRecord: TokenRecord = {
          ...record,
          version: 1,
          discoveredAt: record.discoveredAt || now,
          updatedAt: now,
        };
        current.push(newRecord);
        result = newRecord;
      }
      return current;
    });

    return result;
  }
}

export const tokenRepository = TokenRepository.getInstance();
