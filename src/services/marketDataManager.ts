// src/services/marketDataManager.ts
import { getSolPriceUsd } from '../utils/pnlCalculator';
/**
 * MarketDataManager
 * Centralized, deduplicated, batched market data service with tiered caching,
 * concurrency limits, 429 backoff, circuit breaker, and subscriber management.
 */

export interface TokenPrice {
  mint: string;
  priceUsd: number | null;
  priceNative?: number | null;
  priceChange24h?: number;
  priceChange5m?: number;
  volume24h?: number;
  liquidityUsd?: number;
  marketCapUsd?: number;
  symbol?: string;
  name?: string;
  pairAddress?: string;
  dexId?: string;
  updatedAt: number;
  source?: 'dexscreener' | 'jupiter' | 'simulation' | 'failed' | 'rpc_ws' | 'price_tracker';
  isStale?: boolean;
  error?: string;
  rawPair?: any;
}

export interface PriceCacheEntry {
  price: TokenPrice;
  fetchedAt: number;
  expiresAt: number;
}

export interface MarketDataStats {
  requests: number;
  cacheHits: number;
  cacheMisses: number;
  deduplicated: number;
  batched: number;
  rateLimited: number;
  retries: number;
  fallbacks: number;
  averageLatencyMs: number;
  activeTokens: number;
  circuitBreakerState: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
}

export type PriorityTier = 'trading' | 'activePosition' | 'wallet' | 'discovery' | 'ui';

export const MARKET_DATA_POLICY: Record<PriorityTier, { ttlMs: number; maxAgeMs: number }> = {
  trading: { ttlMs: 500, maxAgeMs: 1500 },
  activePosition: { ttlMs: 250, maxAgeMs: 500 },
  wallet: { ttlMs: 5000, maxAgeMs: 15000 },
  discovery: { ttlMs: 15000, maxAgeMs: 60000 },
  ui: { ttlMs: 5000, maxAgeMs: 30000 },
};

type SubscriberCallback = (prices: Map<string, TokenPrice>) => void;

interface SubscriptionRecord {
  id: string;
  mints: Set<string>;
  callback: SubscriberCallback;
  tier: PriorityTier;
}

export class MarketDataManager {
  private cache = new Map<string, PriceCacheEntry>();
  private inFlight = new Map<string, Promise<TokenPrice | null>>();
  private subscriptions = new Map<string, SubscriptionRecord>();
  private subCounter = 0;

  // Circuit breaker state
  private cbState: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private cbConsecutiveFailures = 0;
  private cbOpenUntil = 0;
  private readonly CB_FAILURE_THRESHOLD = 3;
  private readonly CB_COOLDOWN_MS = 10000;

  // Stats tracking
  private stats: MarketDataStats = {
    requests: 0,
    cacheHits: 0,
    cacheMisses: 0,
    deduplicated: 0,
    batched: 0,
    rateLimited: 0,
    retries: 0,
    fallbacks: 0,
    averageLatencyMs: 0,
    activeTokens: 0,
    circuitBreakerState: 'CLOSED',
  };
  private totalLatencyMs = 0;
  private totalFetchCount = 0;

  // Scheduler for background subscriber refresh
  private backgroundRefreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.startBackgroundRefresh();
  }

  /**
   * Get cached price without making network requests
   */
  public getCachedPrice(mint: string): TokenPrice | null {
    const entry = this.cache.get(mint);
    if (!entry) return null;
    return entry.price;
  }

  /**
   * Get map of cached prices for a list of mints
   */
  public getCachedPrices(mints: string[]): Map<string, TokenPrice> {
    const result = new Map<string, TokenPrice>();
    for (const mint of mints) {
      const entry = this.cache.get(mint);
      if (entry) {
        result.set(mint, entry.price);
      }
    }
    return result;
  }

  /**
   * Get single price, utilizing cache & deduplication
   */
  public async getPrice(
    mint: string,
    tier: PriorityTier = 'ui',
    forceFresh = false
  ): Promise<TokenPrice | null> {
    const prices = await this.getPrices([mint], tier, forceFresh);
    return prices.get(mint) || null;
  }

  /**
   * Main entry point to get prices for multiple mints
   */
  public async getPrices(
    mints: string[],
    tier: PriorityTier = 'ui',
    forceFresh = false
  ): Promise<Map<string, TokenPrice>> {
    const uniqueMints = Array.from(new Set(mints.filter(Boolean)));
    const result = new Map<string, TokenPrice>();
    if (uniqueMints.length === 0) return result;

    const policy = MARKET_DATA_POLICY[tier];
    const now = Date.now();
    const neededFromNetwork: string[] = [];

    // 1. Check cache
    for (const mint of uniqueMints) {
      const entry = this.cache.get(mint);
      if (!forceFresh && entry && entry.expiresAt > now) {
        this.stats.cacheHits++;
        result.set(mint, entry.price);
      } else {
        this.stats.cacheMisses++;
        neededFromNetwork.push(mint);
      }
    }

    if (neededFromNetwork.length === 0) {
      return result;
    }

    // 2. Fetch missing mints via deduplicated/batched network calls
    const fetched = await this.fetchMintsDeduplicated(neededFromNetwork, tier, forceFresh);
    for (const [mint, price] of fetched.entries()) {
      result.set(mint, price);
    }

    this.stats.activeTokens = this.cache.size;
    return result;
  }

  /**
   * Deduplicate in-flight requests and batch remaining mints
   */
  private async fetchMintsDeduplicated(
    mints: string[],
    tier: PriorityTier,
    forceFresh: boolean
  ): Promise<Map<string, TokenPrice>> {
    const result = new Map<string, TokenPrice>();
    const toFetch: string[] = [];
    const inFlightPromises: Promise<TokenPrice | null>[] = [];
    const inFlightMints: string[] = [];

    for (const mint of mints) {
      const existing = this.inFlight.get(mint);
      if (existing) {
        this.stats.deduplicated++;
        inFlightPromises.push(existing);
        inFlightMints.push(mint);
      } else {
        toFetch.push(mint);
      }
    }

    // Process newly queued mints in chunks
    if (toFetch.length > 0) {
      const batchPromise = this.executeBatchFetch(toFetch, tier, forceFresh);

      // Register inFlight entries for all toFetch mints
      for (const mint of toFetch) {
        const singlePromise = batchPromise.then((map) => map.get(mint) || null);
        this.inFlight.set(mint, singlePromise);
        inFlightPromises.push(singlePromise);
        inFlightMints.push(mint);
      }

      // Ensure inFlight entries are cleaned up upon completion
      batchPromise.finally(() => {
        for (const mint of toFetch) {
          this.inFlight.delete(mint);
        }
      });
    }

    // Await all in-flight promises
    const resolved = await Promise.allSettled(inFlightPromises);
    resolved.forEach((res, index) => {
      const mint = inFlightMints[index];
      if (res.status === 'fulfilled' && res.value) {
        result.set(mint, res.value);
      }
    });

    return result;
  }

  /**
   * Chunk mints into batches of max 30 and query the DEX API
   */
  private async executeBatchFetch(
    mints: string[],
    tier: PriorityTier,
    forceFresh: boolean
  ): Promise<Map<string, TokenPrice>> {
    const result = new Map<string, TokenPrice>();
    const policy = MARKET_DATA_POLICY[tier];
    const now = Date.now();

    // Check circuit breaker
    if (this.cbState === 'OPEN') {
      if (now < this.cbOpenUntil) {
        // Circuit breaker open: serve stale cache or simulation fallback
        return this.getFallbackPrices(mints);
      }
      // Cooldown expired: test in HALF_OPEN
      this.cbState = 'HALF_OPEN';
      this.stats.circuitBreakerState = 'HALF_OPEN';
    }

    const BATCH_SIZE = 30;
    const chunks: string[][] = [];
    for (let i = 0; i < mints.length; i += BATCH_SIZE) {
      chunks.push(mints.slice(i, i + BATCH_SIZE));
    }

    this.stats.batched += chunks.length;

    // Concurrency limit: run max 3 chunk requests concurrently
    const CONCURRENCY = 3;
    for (let i = 0; i < chunks.length; i += CONCURRENCY) {
      const currentChunks = chunks.slice(i, i + CONCURRENCY);
      const chunkPromises = currentChunks.map((chunk) =>
        this.fetchChunkWithRetry(chunk, forceFresh)
      );
      const chunkResults = await Promise.allSettled(chunkPromises);

      chunkResults.forEach((res, cIndex) => {
        const chunkMints = currentChunks[cIndex];
        if (res.status === 'fulfilled' && res.value) {
          const map = res.value;
          for (const [mint, price] of map.entries()) {
            result.set(mint, price);
            this.cache.set(mint, {
              price,
              fetchedAt: now,
              expiresAt: now + policy.ttlMs,
            });
          }
          // Mark missing chunk mints with empty unavailable entries so we don't serve old cached prices
          for (const m of chunkMints) {
            if (!result.has(m)) {
              result.set(m, {
                mint: m,
                priceUsd: null,
                priceNative: null,
                priceChange24h: 0,
                updatedAt: 0,
                source: 'failed',
                isStale: true,
                error: 'Market data unavailable',
              });
            }
          }
        } else {
          // Chunk failed completely, use fallbacks
          const fallbackMap = this.getFallbackPrices(chunkMints);
          for (const [m, p] of fallbackMap.entries()) {
            result.set(m, p);
          }
        }
      });
    }

    // Reset circuit breaker on success if HALF_OPEN
    if (this.cbState === 'HALF_OPEN') {
      this.cbState = 'CLOSED';
      this.cbConsecutiveFailures = 0;
      this.stats.circuitBreakerState = 'CLOSED';
    }

    // Notify subscribers
    this.notifySubscribers(result);

    return result;
  }

  /**
   * Fetch a single 30-mint chunk with exponential backoff & 429 handling
   */
  private async fetchChunkWithRetry(
    chunkMints: string[],
    forceFresh: boolean,
    maxRetries = 2
  ): Promise<Map<string, TokenPrice>> {
    const result = new Map<string, TokenPrice>();
    const mintsParam = chunkMints.join(',');
    const url = `/api/dex/tokens/${mintsParam}${forceFresh ? '?fresh=1' : ''}`;

    let attempt = 0;
    let delay = 1000;

    while (attempt <= maxRetries) {
      attempt++;
      this.stats.requests++;
      const start = performance.now();

      try {
        const res = await fetch(url);
        const latency = performance.now() - start;
        this.recordLatency(latency);

        if (res.status === 429) {
          this.stats.rateLimited++;
          this.stats.retries++;
          this.handleFailure(true);

          if (attempt > maxRetries) {
            throw new Error('429 Rate limited');
          }

          // Respect Retry-After header if present
          const retryAfterHeader = res.headers.get('Retry-After');
          const retryDelay = retryAfterHeader
            ? parseInt(retryAfterHeader, 10) * 1000
            : delay + Math.random() * 500;

          await new Promise((resolve) => setTimeout(resolve, retryDelay));
          delay *= 2;
          continue;
        }

        if (!res.ok) {
          throw new Error(`HTTP error ${res.status}`);
        }

        const data = await res.json();
        const pairs: any[] = data.pairs || [];

        // Group pairs by baseToken.address
        const pairsByMint = new Map<string, any[]>();
        for (const pair of pairs) {
          const baseAddr = pair.baseToken?.address;
          if (baseAddr) {
            if (!pairsByMint.has(baseAddr)) pairsByMint.set(baseAddr, []);
            pairsByMint.get(baseAddr)!.push(pair);
          }
        }

        // Parse best pair for each mint
        const now = Date.now();
        for (const mint of chunkMints) {
          const mintPairs = pairsByMint.get(mint);
          if (mintPairs && mintPairs.length > 0) {
            // Sort by liquidity USD descending
            mintPairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
            const bestPair = mintPairs[0];

            const priceUsd = parseFloat(bestPair.priceUsd || '0');
            const priceNative = parseFloat(bestPair.priceNative || '0');

            const tokenPrice: TokenPrice = {
              mint,
              priceUsd,
              priceNative: priceNative > 0 ? priceNative : (priceUsd / (getSolPriceUsd() || 150)),
              priceChange24h: parseFloat(bestPair.priceChange?.h24 || '0'),
              priceChange5m: parseFloat(bestPair.priceChange?.m5 || '0'),
              volume24h: parseFloat(bestPair.volume?.h24 || '0'),
              liquidityUsd: parseFloat(bestPair.liquidity?.usd || '0'),
              marketCapUsd: parseFloat(bestPair.fdv || bestPair.marketCap || '0'),
              symbol: bestPair.baseToken?.symbol || 'UNKNOWN',
              name: bestPair.baseToken?.name || 'Unknown Token',
              pairAddress: bestPair.pairAddress,
              dexId: bestPair.dexId,
              updatedAt: now,
              source: 'dexscreener',
              rawPair: bestPair,
            };

            result.set(mint, tokenPrice);
          }
        }

        // Request succeeded, reset consecutive failure count
        this.cbConsecutiveFailures = 0;
        return result;
      } catch (err: any) {
        if (attempt > maxRetries) {
          this.handleFailure(false);
          throw err;
        }
        this.stats.retries++;
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
      }
    }

    return result;
  }

  /**
   * Handle failure for circuit breaker tracking
   */
  private handleFailure(is429: boolean) {
    this.cbConsecutiveFailures++;
    if (this.cbConsecutiveFailures >= this.CB_FAILURE_THRESHOLD) {
      this.cbState = 'OPEN';
      this.cbOpenUntil = Date.now() + this.CB_COOLDOWN_MS;
      this.stats.circuitBreakerState = 'OPEN';
    }
  }

  /**
   * Fallback generation when requests fail or circuit breaker is open
   */
  private getFallbackPrices(mints: string[]): Map<string, TokenPrice> {
    this.stats.fallbacks++;
    const result = new Map<string, TokenPrice>();

    for (const mint of mints) {
      const fallbackPrice: TokenPrice = {
        mint,
        priceUsd: null,
        priceNative: null,
        priceChange24h: 0,
        updatedAt: 0,
        source: 'failed',
        isStale: true,
        error: 'Market data unavailable',
      };
      result.set(mint, fallbackPrice);
    }
    return result;
  }

  /**
   * Subscribe to price updates for a set of mints
   */
  public subscribe(
    mints: string[],
    callback: SubscriberCallback,
    tier: PriorityTier = 'ui'
  ): () => void {
    const id = `sub_${++this.subCounter}`;
    const mintSet = new Set(mints.filter(Boolean));

    this.subscriptions.set(id, {
      id,
      mints: mintSet,
      callback,
      tier,
    });

    // Perform immediate initial fetch / cache resolution
    if (mintSet.size > 0) {
      this.getPrices(Array.from(mintSet), tier).then((prices) => {
        if (prices.size > 0) {
          callback(prices);
        }
      });
    }

    // Unsubscribe function
    return () => {
      this.subscriptions.delete(id);
    };
  }

  /**
   * Manually refresh prices for a list of mints
   */
  public async refresh(mints: string[], tier: PriorityTier = 'ui'): Promise<Map<string, TokenPrice>> {
    return this.getPrices(mints, tier, true);
  }

  /**
   * Invalidate cache for specified mints (or all if omitted)
   */
  public invalidate(mints?: string[]): void {
    if (!mints) {
      this.cache.clear();
      return;
    }
    for (const mint of mints) {
      this.cache.delete(mint);
    }
  }

  /**
   * Get diagnostics and traffic stats
   */
  public getStats(): MarketDataStats {
    return {
      ...this.stats,
      activeTokens: this.cache.size,
      circuitBreakerState: this.cbState,
    };
  }

  private recordLatency(latencyMs: number) {
    this.totalLatencyMs += latencyMs;
    this.totalFetchCount++;
    this.stats.averageLatencyMs = Math.round(this.totalLatencyMs / this.totalFetchCount);
  }

  private notifySubscribers(updatedPrices: Map<string, TokenPrice>) {
    if (updatedPrices.size === 0) return;

    for (const sub of this.subscriptions.values()) {
      const subPrices = new Map<string, TokenPrice>();
      for (const mint of sub.mints) {
        if (updatedPrices.has(mint)) {
          subPrices.set(mint, updatedPrices.get(mint)!);
        }
      }
      if (subPrices.size > 0) {
        try {
          sub.callback(subPrices);
        } catch (err) {
          console.error('[MarketDataManager] Subscriber callback error:', err);
        }
      }
    }
  }

  /**
   * Background loop to refresh subscribed tokens according to their tier TTL
   */
  private startBackgroundRefresh() {
    if (this.backgroundRefreshTimer) return;

    this.backgroundRefreshTimer = setInterval(() => {
      const now = Date.now();
      const mintsToRefreshByTier = new Map<PriorityTier, Set<string>>();

      // Collect subscribed mints whose cache entries are expired
      for (const sub of this.subscriptions.values()) {
        const policy = MARKET_DATA_POLICY[sub.tier];
        for (const mint of sub.mints) {
          const entry = this.cache.get(mint);
          if (!entry || entry.expiresAt <= now) {
            if (!mintsToRefreshByTier.has(sub.tier)) {
              mintsToRefreshByTier.set(sub.tier, new Set());
            }
            mintsToRefreshByTier.get(sub.tier)!.add(mint);
          }
        }
      }

      // Refresh per tier
      for (const [tier, mintSet] of mintsToRefreshByTier.entries()) {
        if (mintSet.size > 0) {
          this.getPrices(Array.from(mintSet), tier).catch(() => {});
        }
      }
    }, 500); // Check every 500ms for expired subscribed tokens
  }
}

export const marketDataManager = new MarketDataManager();
