/**
 * LRU-based SWR (Stale-While-Revalidate) cache with request coalescing
 */
import { logger } from '../utils/logger.js';
import type { CacheEntry, CacheHit } from '../types/index.js';

interface InFlightEntry<T> {
  promise: Promise<T>;
  startedAt: number;
}

export interface SwrCacheOptions {
  softTtl: number;      // Revalidate in background after this
  hardTtl: number;      // Evict after this
  maxSize: number;      // LRU capacity
  name: string;         // For logging
}

export class SwrCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private inFlight = new Map<string, InFlightEntry<T>>();
  private readonly name: string;
  private readonly softTtl: number;
  private readonly hardTtl: number;
  private readonly maxSize: number;
  private hitCount = 0;
  private missCount = 0;

  constructor(options: SwrCacheOptions) {
    this.name = options.name;
    this.softTtl = options.softTtl;
    this.hardTtl = options.hardTtl;
    this.maxSize = options.maxSize;
  }

  get(key: string): CacheHit<T> | null {
    const item = this.cache.get(key);
    if (!item) {
      this.missCount++;
      return null;
    }

    const age = Date.now() - item.timestamp;
    if (age > this.hardTtl) {
      this.cache.delete(key);
      this.missCount++;
      return null;
    }

    this.hitCount++;
    return {
      data: item.data,
      isStale: age > this.softTtl,
    };
  }

  set(key: string, data: T): void {
    // LRU eviction: remove oldest entry if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
      logger.debug({ cache: this.name, evicted: firstKey }, 'LRU eviction');
    }

    this.cache.set(key, { data, timestamp: Date.now() });
  }

  async fetch(
    key: string,
    fetchFn: () => Promise<T | { bypassCache: true; [key: string]: unknown }>
  ): Promise<T> {
    const cached = this.get(key);

    // Return fresh cache hit immediately
    if (cached && !cached.isStale) {
      return cached.data;
    }

    // Stale cache hit: return immediately, revalidate in background
    if (cached?.isStale) {
      this.triggerBackgroundRevalidation(key, fetchFn);
      return cached.data;
    }

    // Cache miss: coalesce concurrent requests
    const inFlightEntry = this.inFlight.get(key);
    if (inFlightEntry) {
      logger.debug({ cache: this.name, key }, 'Request coalescing');
      return inFlightEntry.promise;
    }

    const promise = this.executeFetch(key, fetchFn);
    this.inFlight.set(key, { promise, startedAt: Date.now() });
    return promise;
  }

  private async executeFetch(
    key: string,
    fetchFn: () => Promise<T | { bypassCache: true; [key: string]: unknown }>
  ): Promise<T> {
    try {
      const result = await fetchFn();

      // Check if fetch result requests cache bypass
      if (
        result &&
        typeof result === 'object' &&
        'bypassCache' in result &&
        (result as { bypassCache: boolean }).bypassCache
      ) {
        return result as T;
      }

      this.set(key, result as T);
      return result as T;
    } catch (error) {
      logger.warn({ cache: this.name, key, error: (error as Error).message }, 'Background revalidation failed');
      throw error;
    } finally {
      this.inFlight.delete(key);
    }
  }

  private triggerBackgroundRevalidation(
    key: string,
    fetchFn: () => Promise<T | { bypassCache: true; [key: string]: unknown }>
  ): void {
    if (this.inFlight.has(key)) return;

    const promise = fetchFn()
      .then((result) => {
        if (
          result &&
          typeof result === 'object' &&
          'bypassCache' in result &&
          (result as { bypassCache: boolean }).bypassCache
        ) {
          return;
        }
        this.set(key, result as T);
      })
      .catch((err) => {
        logger.warn({ cache: this.name, key, error: err.message }, 'Background revalidation failed');
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, { promise: promise as Promise<T>, startedAt: Date.now() });
  }

  pruneExpired(): number {
    const now = Date.now();
    let pruned = 0;

    for (const [key, item] of this.cache.entries()) {
      if (now - item.timestamp > this.hardTtl) {
        this.cache.delete(key);
        pruned++;
      }
    }

    if (pruned > 0) {
      logger.debug({ cache: this.name, pruned }, 'Pruned expired entries');
    }

    return pruned;
  }

  getStats(): { hits: number; misses: number; size: number; inFlight: number } {
    return {
      hits: this.hitCount,
      misses: this.missCount,
      size: this.cache.size,
      inFlight: this.inFlight.size,
    };
  }

  clear(): void {
    this.cache.clear();
    this.inFlight.clear();
    logger.info({ cache: this.name }, 'Cache cleared');
  }
}
