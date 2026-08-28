// src/services/TokenRegistry.ts
import { TradingNetwork } from '../config/network';

export type TokenSignal = 'MOMENTUM' | 'VOLUME_SPIKE' | 'WHALE_BUY' | 'TRENDING' | 'MANUAL' | 'NONE';

export type TokenExecutionState = 
  | 'DISCOVERED'
  | 'VALIDATING'
  | 'EVALUATING'
  | 'ORDER_PENDING'
  | 'POSITION_OPEN'
  | 'EXIT_PENDING'
  | 'CLOSED'
  | 'BLACKLISTED';

export interface TokenRecord {
  mintAddress: string; // Canonical identifier
  symbol?: string;
  name?: string;
  decimals?: number;

  network: TradingNetwork;

  priceSOL?: number;
  priceUSD?: number;
  liquidity?: number;
  marketCap?: number;
  volume24h?: number;

  discoveredAt: number;
  updatedAt: number;

  signal?: TokenSignal;
  signalConfidence?: number;
  executionState?: TokenExecutionState;

  positionId?: string;
  metadata?: Record<string, any>;
}

export type TokenRegistryListener = (token: TokenRecord) => void;

/**
 * TokenRegistry: The SINGLE authoritative token registry for the entire application.
 * Identifies tokens strictly by Solana mint address.
 */
export class TokenRegistry {
  private static instance: TokenRegistry;
  private tokens: Map<string, TokenRecord> = new Map();
  private listeners: Set<TokenRegistryListener> = new Set();

  private constructor() {
    this.loadPersistedTokens();
  }

  public static getInstance(): TokenRegistry {
    if (!TokenRegistry.instance) {
      TokenRegistry.instance = new TokenRegistry();
    }
    return TokenRegistry.instance;
  }

  private loadPersistedTokens(): void {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem('app_token_registry');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item && item.mintAddress) {
              this.tokens.set(item.mintAddress, item);
            }
          }
        }
      }
    } catch (e) {
      console.warn('[TokenRegistry] Failed to load persisted registry:', e);
    }
  }

  private persist(): void {
    if (typeof window === 'undefined') return;
    try {
      const arr = Array.from(this.tokens.values()).slice(-200); // Keep last 200 discovered tokens
      localStorage.setItem('app_token_registry', JSON.stringify(arr));
    } catch (e) {
      console.warn('[TokenRegistry] Failed to persist registry:', e);
    }
  }

  public registerOrUpdate(params: {
    mintAddress: string;
    network?: TradingNetwork;
    symbol?: string;
    name?: string;
    decimals?: number;
    priceSOL?: number;
    priceUSD?: number;
    liquidity?: number;
    marketCap?: number;
    volume24h?: number;
    signal?: TokenSignal;
    signalConfidence?: number;
    executionState?: TokenExecutionState;
    positionId?: string;
    metadata?: Record<string, any>;
  }): TokenRecord {
    const mint = params.mintAddress.trim();
    if (!mint) throw new Error('TokenRegistry: mintAddress is required');

    const now = Date.now();
    const existing = this.tokens.get(mint);

    const record: TokenRecord = {
      mintAddress: mint,
      network: params.network || existing?.network || 'paper',
      symbol: params.symbol || existing?.symbol || 'UNKNOWN',
      name: params.name || existing?.name || existing?.symbol || 'Unknown Token',
      decimals: params.decimals !== undefined ? params.decimals : (existing?.decimals ?? 6),
      priceSOL: params.priceSOL !== undefined ? params.priceSOL : existing?.priceSOL,
      priceUSD: params.priceUSD !== undefined ? params.priceUSD : existing?.priceUSD,
      liquidity: params.liquidity !== undefined ? params.liquidity : existing?.liquidity,
      marketCap: params.marketCap !== undefined ? params.marketCap : existing?.marketCap,
      volume24h: params.volume24h !== undefined ? params.volume24h : existing?.volume24h,
      discoveredAt: existing ? existing.discoveredAt : now,
      updatedAt: now,
      signal: params.signal !== undefined ? params.signal : (existing?.signal || 'NONE'),
      signalConfidence: params.signalConfidence !== undefined ? params.signalConfidence : existing?.signalConfidence,
      executionState: params.executionState !== undefined ? params.executionState : (existing?.executionState || 'DISCOVERED'),
      positionId: params.positionId !== undefined ? params.positionId : existing?.positionId,
      metadata: { ...existing?.metadata, ...params.metadata },
    };

    this.tokens.set(mint, record);
    this.persist();
    this.notify(record);
    return record;
  }

  public get(mintAddress: string): TokenRecord | undefined {
    return this.tokens.get(mintAddress.trim());
  }

  public getToken(mintAddress: string): TokenRecord | undefined {
    return this.get(mintAddress);
  }

  public has(mintAddress: string): boolean {
    return this.tokens.has(mintAddress.trim());
  }

  public getAll(): TokenRecord[] {
    return Array.from(this.tokens.values());
  }

  public getByNetwork(network: TradingNetwork): TokenRecord[] {
    return Array.from(this.tokens.values()).filter(t => t.network === network);
  }

  public setExecutionState(mintAddress: string, state: TokenExecutionState, positionId?: string): void {
    const record = this.tokens.get(mintAddress.trim());
    if (record) {
      record.executionState = state;
      record.updatedAt = Date.now();
      if (positionId !== undefined) {
        record.positionId = positionId;
      }
      this.persist();
      this.notify(record);
    }
  }

  public updatePrice(mintAddress: string, priceSOL: number, priceUSD?: number): void {
    const record = this.tokens.get(mintAddress.trim());
    if (record) {
      record.priceSOL = priceSOL;
      if (priceUSD !== undefined) record.priceUSD = priceUSD;
      record.updatedAt = Date.now();
      this.persist();
      this.notify(record);
    }
  }

  public subscribe(listener: TokenRegistryListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(token: TokenRecord): void {
    for (const listener of this.listeners) {
      try {
        listener(token);
      } catch (err) {
        console.error('[TokenRegistry] Error in listener:', err);
      }
    }
  }
}

export const tokenRegistry = TokenRegistry.getInstance();
