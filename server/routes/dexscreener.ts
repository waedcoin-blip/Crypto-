/**
 * DEXScreener API proxy routes with caching and simulation fallback
 */
import { Router } from 'express';
import { SwrCache } from '../cache/SwrCache.js';
import { fetchWithRetry } from '../utils/fetch.js';
import { dexLogger } from '../utils/logger.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validateRequiredString } from '../utils/validation.js';
import {
  generateSimulatedPair,
  getDeterministicTokenInfo,
  TRENDING_MINTS,
} from '../services/simulation.js';
import type { DexTokenResponse, TokenProfile } from '../types/index.js';

const router = Router();

// ─── Cache Instances ───
const searchCache = new SwrCache<DexTokenResponse>({
  name: 'dex-search',
  softTtl: 3000,
  hardTtl: 30000,
  maxSize: 2000,
});

const tokenCache = new SwrCache<DexTokenResponse>({
  name: 'dex-token',
  softTtl: 2000,
  hardTtl: 30000,
  maxSize: 2000,
});

const pairsCache = new SwrCache<unknown>({
  name: 'dex-pairs',
  softTtl: 5000,
  hardTtl: 30000,
  maxSize: 2000,
});

const profilesCache = new SwrCache<TokenProfile[]>({
  name: 'dex-profiles',
  softTtl: 5000,
  hardTtl: 45000,
  maxSize: 10,
});

const trendingCache = new SwrCache<DexTokenResponse>({
  name: 'dex-trending',
  softTtl: 4000,
  hardTtl: 20000,
  maxSize: 100,
});

// ─── Helpers ───
function filterAndSortPairs(pairs: any[], query?: string): any[] {
  if (!Array.isArray(pairs)) return [];

  const exactQuery = query ? query.trim().toLowerCase() : '';
  const isExactAddress = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(exactQuery);

  // 1. Filter valid Solana pairs with real address & valid prices & liquidity > 0
  const validSolanaPairs = pairs.filter((p) => {
    if (!p || typeof p !== 'object') return false;

    // Chain check
    const chain = String(p.chainId || p.chainKb || '').toLowerCase();
    if (chain !== 'solana') return false;

    // Base token check
    const baseAddr = p.baseToken?.address;
    if (!baseAddr || typeof baseAddr !== 'string') return false;
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(baseAddr)) return false;

    // Price check
    const priceUsd = parseFloat(p.priceUsd || '0');
    const priceNative = parseFloat(p.priceNative || '0');
    if ((priceUsd <= 0 || !Number.isFinite(priceUsd)) && (priceNative <= 0 || !Number.isFinite(priceNative))) {
      return false;
    }

    // Liquidity check: require liquidityUsd > 0 (unless exact address search)
    const liqUsd = parseFloat(p.liquidity?.usd || '0');
    if (liqUsd <= 0 && !isExactAddress) return false;

    return true;
  });

  // 2. Deduplicate tokens by canonical mint address (`baseToken.address`)
  // Group pairs by baseToken.address and select the primary pair with highest liquidity USD
  const bestPairByMint = new Map<string, any>();

  for (const pair of validSolanaPairs) {
    const mint = pair.baseToken.address;
    const existing = bestPairByMint.get(mint);

    if (!existing) {
      bestPairByMint.set(mint, pair);
    } else {
      const existingLiq = parseFloat(existing.liquidity?.usd || '0');
      const currentLiq = parseFloat(pair.liquidity?.usd || '0');

      const existingVol = parseFloat(existing.volume?.h24 || '0');
      const currentVol = parseFloat(pair.volume?.h24 || '0');

      // Prefer pair with higher liquidity; tie-break by volume
      if (currentLiq > existingLiq || (currentLiq === existingLiq && currentVol > existingVol)) {
        bestPairByMint.set(mint, pair);
      }
    }
  }

  const deduplicatedPairs = Array.from(bestPairByMint.values());

  // 3. Smart Sort: exact match > liquidity + volume + recency
  deduplicatedPairs.sort((a: any, b: any) => {
    if (exactQuery) {
      const aSymbol = (a.baseToken?.symbol || '').toLowerCase();
      const aName = (a.baseToken?.name || '').toLowerCase();
      const aAddr = (a.baseToken?.address || '').toLowerCase();

      const bSymbol = (b.baseToken?.symbol || '').toLowerCase();
      const bName = (b.baseToken?.name || '').toLowerCase();
      const bAddr = (b.baseToken?.address || '').toLowerCase();

      const aExact = (aSymbol === exactQuery || aAddr === exactQuery) ? 2 : (aName === exactQuery ? 1 : 0);
      const bExact = (bSymbol === exactQuery || bAddr === exactQuery) ? 2 : (bName === exactQuery ? 1 : 0);

      if (aExact !== bExact) return bExact - aExact;
    }

    const aLiq = parseFloat(a.liquidity?.usd || '0');
    const bLiq = parseFloat(b.liquidity?.usd || '0');

    const aVol = parseFloat(a.volume?.h24 || '0');
    const bVol = parseFloat(b.volume?.h24 || '0');

    const aCreated = a.pairCreatedAt || 0;
    const bCreated = b.pairCreatedAt || 0;

    const aScore = aLiq * 0.4 + aVol * 0.4 + (aCreated > 0 ? (aCreated / 1e10) : 0);
    const bScore = bLiq * 0.4 + bVol * 0.4 + (bCreated > 0 ? (bCreated / 1e10) : 0);

    return bScore - aScore;
  });

  return deduplicatedPairs;
}

// ─── Routes ───

// GET /api/dex/search
router.get('/search', asyncHandler(async (req, res) => {
  const q = validateRequiredString(req.query.q, 'q');

  try {
    const data = await searchCache.fetch(`search_${q}`, async () => {
      const isExactMint = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q.trim());
      
      const urls = [
        `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q.trim())}`
      ];
      if (isExactMint) {
        urls.push(`https://api.dexscreener.com/latest/dex/tokens/${q.trim()}`);
      }

      const allPairs: any[] = [];
      const responses = await Promise.allSettled(
        urls.map((u) => fetchWithRetry(u, { headers: { 'User-Agent': 'Mozilla/5.0' } }, 2))
      );

      for (const result of responses) {
        if (result.status === 'fulfilled' && result.value.response.ok) {
          try {
            const parsed = JSON.parse(result.value.text);
            if (Array.isArray(parsed?.pairs)) {
              allPairs.push(...parsed.pairs);
            }
          } catch (_) {}
        }
      }

      return { pairs: allPairs };
    });

    const filteredPairs = filterAndSortPairs(data?.pairs || [], q);

    res.json({ schemaVersion: '2.0.0', pairs: filteredPairs });
  } catch (error: any) {
    dexLogger.warn({ query: q, errDetails: error.message }, 'DEX search failed');
    res.status(500).json({ errDetails: error.message, pairs: [] });
  }
}));

// GET /api/dex/tokens/trending
// Real discovery feed — multi-source endpoints, pagination handling, mint deduplication.
router.get('/tokens/trending', asyncHandler(async (req, res) => {
  try {
    const data = await trendingCache.fetch('trending_tokens_v3', async () => {
      const discoveryEndpoints = [
        'https://api.dexscreener.com/token-profiles/latest/v1',
        'https://api.dexscreener.com/token-profiles/recent-updates/v1',
        'https://api.dexscreener.com/token-boosts/latest/v1',
        'https://api.dexscreener.com/token-boosts/top/v1',
        'https://api.dexscreener.com/latest/dex/search?q=solana',
        'https://api.dexscreener.com/latest/dex/search?q=pump',
      ];

      const discoveredMints = new Map<string, any>();

      // Fetch discovery feeds concurrently.
      const responses = await Promise.allSettled(
        discoveryEndpoints.map(async (url) => {
          const { response, text } = await fetchWithRetry(
            url,
            {
              headers: {
                'User-Agent': 'Mozilla/5.0',
                'Accept': 'application/json',
              },
            },
            2,
            500
          );

          if (!response.ok) {
            throw new Error(`${url}: HTTP ${response.status}`);
          }

          const json = JSON.parse(text);

          if (Array.isArray(json)) return json;
          if (Array.isArray(json?.data)) return json.data;
          if (Array.isArray(json?.pairs)) return json.pairs;

          return [];
        })
      );

      for (const result of responses) {
        if (result.status !== 'fulfilled') continue;

        for (const item of result.value) {
          if (!item || typeof item !== 'object') continue;

          // Handle pair objects directly returned by search
          if (item.baseToken?.address) {
            const chainId = String(item.chainId || 'solana').toLowerCase();
            if (chainId === 'solana' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(item.baseToken.address)) {
              discoveredMints.set(item.baseToken.address, item);
            }
            continue;
          }

          const chainId = String(item?.chainId || item?.chain || '').toLowerCase();
          if (chainId && chainId !== 'solana') continue;

          const address =
            item?.tokenAddress ||
            item?.address ||
            item?.mint;

          if (!address) continue;

          // Solana mint addresses are 32–44 chars.
          if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
            discoveredMints.set(address, { ...item, address });
          }
        }
      }

      const mints = Array.from(discoveredMints.keys());

      if (mints.length === 0) {
        return { schemaVersion: '2.0.0', pairs: [], discoveredAt: Date.now() };
      }

      // Query pair details for discovered mints in chunks of 30
      const pairs: any[] = [];

      for (let i = 0; i < mints.length; i += 30) {
        const chunk = mints.slice(i, i + 30);

        try {
          const { response, text } = await fetchWithRetry(
            `https://api.dexscreener.com/latest/dex/tokens/${chunk.join(',')}`,
            {
              headers: {
                'User-Agent': 'Mozilla/5.0',
                'Accept': 'application/json',
              },
            },
            2,
            500
          );

          if (!response.ok) continue;

          const parsed = JSON.parse(text);

          if (Array.isArray(parsed?.pairs)) {
            pairs.push(...parsed.pairs);
          }
        } catch (error) {
          dexLogger.warn({ error }, 'Discovery batch failed');
        }
      }

      // Sanitize, deduplicate by baseToken.address (canonical mint), and sort
      const sanitizedPairs = filterAndSortPairs(pairs);

      return {
        schemaVersion: '2.0.0',
        pairs: sanitizedPairs.slice(0, 100),
        discoveredAt: Date.now(),
      };
    });

    res.json(data);
  } catch (error: any) {
    dexLogger.error(
      { error: error.message },
      'Real token discovery failed'
    );

    res.status(503).json({
      schemaVersion: '2.0.0',
      pairs: [],
      error: 'DISCOVERY_UNAVAILABLE',
    });
  }
}));



// GET /api/dex/tokens/:mint
// Query param `fresh=1` bypasses the soft-TTL for the listed mints so callers that
// need up-to-date pricing (active-position PnL sync, stop-loss/take-profit checks)
// don't silently serve a stale snapshot.
router.get('/tokens/:mint', asyncHandler(async (req, res) => {
  const mintParam = req.params.mint;
  const mintList = Array.from(new Set(mintParam.split(',').map((m) => m.trim()).filter(Boolean)));
  const forceFresh = req.query.fresh === '1' || req.query.fresh === 'true';

  if (mintList.length === 0) {
    return res.json({ schemaVersion: '1.0.0', pairs: [] });
  }

  const pairs: any[] = [];
  const missingMints: string[] = [];

  // Check cache for each mint
  for (const mint of mintList) {
    const cached = tokenCache.get(mint);
    if (cached && !cached.isStale && !forceFresh) {
      if (cached.data?.pairs) {
        pairs.push(...cached.data.pairs);
      }
    } else {
      missingMints.push(mint);
    }
  }

  // Fetch missing mints in chunks
  if (missingMints.length > 0) {
    for (let i = 0; i < missingMints.length; i += 30) {
      const chunk = missingMints.slice(i, i + 30);
      const ids = chunk.join(',');

      try {
        const { response, text } = await fetchWithRetry(
          `https://api.dexscreener.com/latest/dex/tokens/${ids}`,
          { headers: { 'User-Agent': 'Mozilla/5.0' } },
          3,
          2000
        );

        if (response.ok) {
          const parsed = JSON.parse(text);
          const returnedPairs = parsed?.pairs || [];
          pairs.push(...returnedPairs);

          // Cache individual mint results
          const pairsByMint: Record<string, any[]> = {};
          for (const p of returnedPairs) {
            const baseAddr = p.baseToken?.address;
            if (baseAddr) {
              if (!pairsByMint[baseAddr]) pairsByMint[baseAddr] = [];
              pairsByMint[baseAddr].push(p);
            }
          }

          // Cache every requested mint to prevent spamming for untracked/missing tokens
          for (const m of chunk) {
            const foundPairs = pairsByMint[m] || [];
            tokenCache.set(m, { schemaVersion: '1.0.0', pairs: foundPairs });
          }
        }
      } catch (chunkErr: any) {
        dexLogger.warn({ chunk: ids, errDetails: chunkErr.message }, 'Chunk fetch failed, using simulation');
        for (const m of chunk) {
          const fallback = generateSimulatedPair(m);
          pairs.push(fallback);
          tokenCache.set(m, { schemaVersion: '1.0.0', pairs: [fallback] });
        }
      }
    }
  }

  res.json({ schemaVersion: '1.0.0', pairs });
}));

// GET /api/dex/token-profiles
router.get('/token-profiles', asyncHandler(async (req, res) => {
  try {
    const profiles = await profilesCache.fetch('global-token-profiles', async () => {
      dexLogger.info('Aggregating multi-source token feeds...');

      const endpoints = [
        'https://api.dexscreener.com/token-profiles/latest/v1',
        'https://api.dexscreener.com/token-profiles/recent-updates/v1',
        'https://api.dexscreener.com/community-takeovers/latest/v1',
        'https://api.dexscreener.com/ads/latest/v1',
        'https://api.dexscreener.com/token-boosts/latest/v1',
        'https://api.dexscreener.com/token-boosts/top/v1',
      ];

      const allItems: any[] = [];

      for (const url of endpoints) {
        try {
          const { response, text } = await fetchWithRetry(
            url,
            {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              },
            },
            3,
            2000
          );

          if (!response.ok) {
            dexLogger.warn({ url, status: response.status }, 'Endpoint returned error');
            continue;
          }

          const json = JSON.parse(text);
          let items: any[] = [];

          if (Array.isArray(json)) {
            items = json;
          } else if (json?.data && Array.isArray(json.data)) {
            items = json.data;
          } else if (json && typeof json === 'object') {
            for (const key of Object.keys(json)) {
              if (Array.isArray(json[key])) {
                items = json[key];
                break;
              }
            }
          }

          allItems.push(...items);
          await new Promise((resolve) => setTimeout(resolve, 1000)); // Rate limit delay
        } catch (err: any) {
          dexLogger.error({ url, errDetails: err.message }, 'Profile endpoint error');
        }
      }

      // Deduplicate by tokenAddress
      const seen = new Set<string>();
      const profilesList: TokenProfile[] = [];

      for (const item of allItems) {
        if (!item || typeof item !== 'object') continue;

        const tokenAddress = item.tokenAddress || item.mint || item.baseToken?.address;
        const chainId = item.chainId || 'solana';

        if (!tokenAddress) continue;

        const addrLower = String(tokenAddress).trim();
        if (seen.has(addrLower)) continue;

        seen.add(addrLower);
        profilesList.push({
          tokenAddress,
          chainId,
          url: item.url || '',
          icon: item.icon || item.imageUrl || '',
          header: item.header || '',
          description: item.description || '',
          links: item.links || [],
        });
      }

      dexLogger.info({ count: profilesList.length }, 'Profiles ingested');
      return profilesList;
    });

    res.json(profiles);
  } catch (error: any) {
    dexLogger.warn({ errDetails: error.message }, 'Profiles fetch failed');

    const cached = profilesCache.get('global-token-profiles');
    if (cached) return res.json(cached.data);

    // Simulation fallback
    const simulated = TRENDING_MINTS.map((m) => {
      const tok = getDeterministicTokenInfo(m);
      return {
        tokenAddress: m,
        chainId: 'solana',
        url: `https://dexscreener.com/solana/${m}`,
        icon: tok.imageUrl,
        header: `Discover ${tok.name}!`,
        description: `The ultimate memecoin of 2026. Join the ${tok.symbol} movement!`,
        links: [
          { type: 'website', label: 'Website', url: 'https://example.com' },
          { type: 'twitter', label: 'Twitter', url: 'https://twitter.com' },
        ],
      };
    });

    res.json(simulated);
  }
}));

// GET /api/dex/token-pairs/:mint
router.get('/token-pairs/:mint', asyncHandler(async (req, res) => {
  const { mint } = req.params;

  try {
    const data = await pairsCache.fetch(mint, async () => {
      const { response, text } = await fetchWithRetry(
        `https://api.dexscreener.com/token-pairs/v1/solana/${mint}`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } },
        3
      );

      if (!response.ok) {
        throw new Error(`API response status: ${response.status}`);
      }

      return JSON.parse(text);
    });

    res.json(data);
  } catch (error: any) {
    dexLogger.warn({ mint, errDetails: error.message }, 'Pairs fetch failed');

    const cached = pairsCache.get(mint);
    if (cached) return res.json(cached.data);

    const pairs = mint.split(',').map((m) => generateSimulatedPair(m.trim())).filter(Boolean);
    res.json({ schemaVersion: '1.0.0', pairs });
  }
}));

export default router;
