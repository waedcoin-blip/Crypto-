/**
 * LRU-based SWR (Stale-While-Revalidate) cache with request coalescing
 */
import { logger } from '../utils/logger.js';
import type { CacheEntry, CacheHit } from '../types/index.js';

interface InFlightEntry<T> { promise: Promise<T>; startedAt: number; }

export interface BypassCacheResult { bypassCache: true; data?: unknown; }

export interface SwrCacheOptions {
  softTtl: number; hardTtl: number; maxSize: number; name: string;
  backgroundTimeoutMs?: number;
}

export class SwrCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private inFlight = new Map<string, InFlightEntry<T>>();
  private readonly name: string;
  private readonly softTtl: number;
  private readonly hardTtl: number;
  private readonly maxSize: number;
  private readonly backgroundTimeoutMs: number;
  private hitCount = 0;
  private missCount = 0;

  constructor(options: SwrCacheOptions) {
    this.name = options.name;
    this.softTtl = options.softTtl;
    this.hardTtl = options.hardTtl;
    this.maxSize = options.maxSize;
    this.backgroundTimeoutMs = options.backgroundTimeoutMs || 10000;
  }

  get(key: string): CacheHit<T> | null {
    const item = this.cache.get(key);
    if (!item) { this.missCount++; return null; }
    const age = Date.now() - item.timestamp;
    if (age > this.hardTtl) { this.cache.delete(key); this.missCount++; return null; }
    // FIX: True LRU - move accessed item to end of Map (most recently used)
    this.cache.delete(key);
    this.cache.set(key, item);
    this.hitCount++;
    return { data: item.data, isStale: age > this.softTtl };
  }

  set(key: string, data: T): void {
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
        logger.debug({ cache: this.name, evicted: firstKey }, 'LRU eviction');
      }
    }
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  async fetch(key: string, fetchFn: () => Promise<T | BypassCacheResult>): Promise<T> {
    const cached = this.get(key);
    if (cached && !cached.isStale) return cached.data;
    if (cached?.isStale) { this.triggerBackgroundRevalidation(key, fetchFn); return cached.data; }
    const inFlightEntry = this.inFlight.get(key);
    if (inFlightEntry) { logger.debug({ cache: this.name, key }, 'Request coalescing'); return inFlightEntry.promise; }
    const promise = this.executeFetch(key, fetchFn);
    this.inFlight.set(key, { promise, startedAt: Date.now() });
    return promise;
  }

  private async executeFetch(key: string, fetchFn: () => Promise<T | BypassCacheResult>): Promise<T> {
    try {
      const result = await fetchFn();
      if (this.isBypassCache(result)) return result.data as T;
      this.set(key, result as T);
      return result as T;
    } catch (error) {
      logger.warn({ cache: this.name, key, errDetails: (error as Error).message }, 'Fetch failed');
      throw error;
    } finally {
      this.inFlight.delete(key);
    }
  }

  private triggerBackgroundRevalidation(key: string, fetchFn: () => Promise<T | BypassCacheResult>): void {
    if (this.inFlight.has(key)) return;
    // FIX: Timeout prevents infinite hanging promises in the inFlight map
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Background revalidation timeout')), this.backgroundTimeoutMs));
    const promise = Promise.race([fetchFn(), timeoutPromise])
      .then((result) => { if (this.isBypassCache(result)) return; this.set(key, result as T); })
      .catch((err) => { logger.warn({ cache: this.name, key, errDetails: (err as Error).message }, 'Background revalidation failed or timed out'); })
      .finally(() => { this.inFlight.delete(key); });
    this.inFlight.set(key, { promise: promise as Promise<T>, startedAt: Date.now() });
  }

  private isBypassCache(result: unknown): result is BypassCacheResult {
    return result !== null && typeof result === 'object' && 'bypassCache' in result && (result as { bypassCache: boolean }).bypassCache === true;
  }

  pruneExpired(): number {
    const now = Date.now(); let pruned = 0;
    for (const [key, item] of this.cache.entries()) {
      if (now - item.timestamp > this.hardTtl) { this.cache.delete(key); pruned++; }
    }
    if (pruned > 0) logger.debug({ cache: this.name, pruned }, 'Pruned expired entries');
    return pruned;
  }

  getStats() { return { hits: this.hitCount, misses: this.missCount, size: this.cache.size, inFlight: this.inFlight.size }; }

  clear(): void { this.cache.clear(); this.inFlight.clear(); logger.info({ cache: this.name }, 'Cache cleared'); }

  // NEW: Delete a single key (used for force-refresh)
  delete(key: string): boolean { return this.cache.delete(key); }
}