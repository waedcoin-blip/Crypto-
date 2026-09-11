// server/utils/cacheRegistry.ts
import { SwrCache } from '../cache/SwrCache.js';

export const cacheRegistry = {
  dexscreener: new SwrCache<any>({ name: 'dexscreener', softTtl: 5000, hardTtl: 30000, maxSize: 1000 }),
  jupiter: new SwrCache<any>({ name: 'jupiter', softTtl: 2000, hardTtl: 10000, maxSize: 500 }),
  candidateEnricher: new SwrCache<any>({ name: 'candidate-enricher', softTtl: 3000, hardTtl: 15000, maxSize: 1000 }),
};

export function getAllCacheStats() {
  const stats: Record<string, ReturnType<SwrCache<any>['getStats']>> = {};
  for (const [name, cache] of Object.entries(cacheRegistry)) {
    stats[name] = cache.getStats();
  }
  return stats;
}