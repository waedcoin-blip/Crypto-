// server/repositories/TokenRepository.ts
import { readDataFile, writeDataFile } from '../db/jsonStore.js';

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
}

const FILE_NAME = 'tokens.json';

export class TokenRepository {
  private static instance: TokenRepository;
  private tokens: Map<string, TokenRecord> = new Map();

  private constructor() {
    this.load();
  }

  public static getInstance(): TokenRepository {
    if (!TokenRepository.instance) {
      TokenRepository.instance = new TokenRepository();
    }
    return TokenRepository.instance;
  }

  private load(): void {
    const list = readDataFile<TokenRecord[]>(FILE_NAME, []);
    for (const item of list) {
      if (item && item.mintAddress) {
        this.tokens.set(item.mintAddress, item);
      }
    }
  }

  private save(): void {
    const arr = Array.from(this.tokens.values()).slice(-200);
    writeDataFile(FILE_NAME, arr);
  }

  public getToken(mint: string): TokenRecord | undefined {
    return this.tokens.get(mint.trim());
  }

  public getTokens(): TokenRecord[] {
    return Array.from(this.tokens.values());
  }

  public upsertToken(record: TokenRecord): TokenRecord {
    const mint = record.mintAddress.trim();
    record.updatedAt = Date.now();
    this.tokens.set(mint, record);
    this.save();
    return record;
  }
}

export const tokenRepository = TokenRepository.getInstance();
