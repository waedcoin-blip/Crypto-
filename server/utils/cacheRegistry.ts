import { SwrCache } from '../cache/SwrCache.js';

export const cacheRegistry = {
  dexscreener: new SwrCache<any>({
    name: 'dexscreener',
    softTtl: 5000,   // 5s
    hardTtl: 30000,  // 30s
    maxSize: 1000,
  }),
  jupiter: new SwrCache<any>({
    name: 'jupiter',
    softTtl: 2000,   // 2s
    hardTtl: 10000,  // 10s
    maxSize: 500,
  }),
};

export function getAllCacheStats() {
  const stats: Record<string, ReturnType<SwrCache<any>['getStats']>> = {};
  for (const [name, cache] of Object.entries(cacheRegistry)) {
    stats[name] = cache.getStats();
  }
  return stats;
}
