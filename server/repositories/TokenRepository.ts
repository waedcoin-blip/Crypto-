// server/repositories/TokenRepository.ts
import { JsonStore } from './JsonStore.js';

export type TokenExecutionState =
  | 'NONE'
  | 'DISCOVERED'
  | 'EVALUATING'
  | 'BUYING'
  | 'HELD'
  | 'SELLING'
  | 'SOLD'
  | 'FAILED';

export interface TokenRecord {
  mint: string;
  mintAddress?: string;
  symbol: string;
  name?: string;
  network: string;
  decimals: number;
  executionState: TokenExecutionState;
  positionId?: string;
  discoveredAt: number;
  updatedAt: number;
  metadata?: any;
  priceUsd?: number;
  priceNative?: number;
}

/**
 * TokenRepository: Tracks all known tokens and their execution state.
 * Provides a global view of the token lifecycle.
 */
export class TokenRepository {
  private static instance: TokenRepository;
  private store: JsonStore<Record<string, TokenRecord>>;
  private readonly MAX_TOKENS = 10000;

  private constructor() {
    this.store = new JsonStore<Record<string, TokenRecord>>('tokens.json', {});
  }

  public static getInstance(): TokenRepository {
    if (!TokenRepository.instance) {
      TokenRepository.instance = new TokenRepository();
    }
    return TokenRepository.instance;
  }

  /**
   * Register or update a token.
   */
  public upsertToken(params: {
    mint?: string;
    mintAddress?: string;
    symbol?: string;
    name?: string;
    network: string;
    decimals?: number;
    metadata?: any;
    discoveredAt?: number;
    updatedAt?: number;
    signal?: string;
  }): void {
    const mint = (params.mint || params.mintAddress || '').trim();
    if (!mint) return;
    const all = this.store.read();
    const key = `${params.network}:${mint}`;

    // Enforce capacity limit
    if (Object.keys(all).length >= this.MAX_TOKENS && !all[key]) {
      this.evictOldest(all);
    }

    const existing = all[key];
    all[key] = {
      mint,
      mintAddress: mint,
      symbol: params.symbol || existing?.symbol || mint.slice(0, 6).toUpperCase(),
      name: params.name || existing?.name,
      network: params.network,
      decimals: params.decimals ?? params.metadata?.decimals ?? existing?.decimals ?? 6,
      executionState: existing?.executionState || 'DISCOVERED',
      positionId: existing?.positionId,
      discoveredAt: params.discoveredAt || existing?.discoveredAt || Date.now(),
      updatedAt: params.updatedAt || Date.now(),
      metadata: params.metadata || existing?.metadata,
      priceUsd: params.metadata?.priceUsd ?? existing?.priceUsd,
      priceNative: params.metadata?.priceNative ?? existing?.priceNative,
    };

    this.store.write(all);
  }

  /**
   * Set the execution state for a token.
   */
  public setExecutionState(mint: string, state: TokenExecutionState, positionId?: string): void {
    const all = this.store.read();
    // Find by mint (any network)
    for (const [key, record] of Object.entries(all)) {
      if (record.mint === mint) {
        record.executionState = state;
        record.updatedAt = Date.now();
        if (positionId) record.positionId = positionId;
        break;
      }
    }
    this.store.write(all);
  }

  /**
   * Get a token by mint address.
   */
  public getByMint(mint: string): (TokenRecord & { priceNative?: number; priceUsd?: number }) | undefined {
    const all = this.store.read();
    for (const record of Object.values(all)) {
      if (record.mint === mint) return record;
    }
    return undefined;
  }

  public getToken(mint: string): (TokenRecord & { priceNative?: number; priceUsd?: number }) | undefined {
    return this.getByMint(mint);
  }

  /**
   * Get all tokens.
   */
  public getAll(): TokenRecord[] {
    return Object.values(this.store.read());
  }

  /**
   * Get tokens by network.
   */
  public getByNetwork(network: string): TokenRecord[] {
    return this.getAll().filter(t => t.network === network);
  }

  /**
   * Check if a token exists.
   */
  public has(mint: string): boolean {
    const all = this.store.read();
    return Object.values(all).some(t => t.mint === mint);
  }

  private evictOldest(all: Record<string, TokenRecord>): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [key, record] of Object.entries(all)) {
      if (record.discoveredAt < oldestTime) {
        oldestTime = record.discoveredAt;
        oldestKey = key;
      }
    }
    if (oldestKey) delete all[oldestKey];
  }
}

export const tokenRepository = TokenRepository.getInstance();
