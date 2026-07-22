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
  softTtl: 15000,
  hardTtl: 60000,
  maxSize: 2000,
});

const tokenCache = new SwrCache<DexTokenResponse>({
  name: 'dex-token',
  softTtl: 15000,
  hardTtl: 60000,
  maxSize: 2000,
});

const pairsCache = new SwrCache<unknown>({
  name: 'dex-pairs',
  softTtl: 15000,
  hardTtl: 60000,
  maxSize: 2000,
});

const profilesCache = new SwrCache<TokenProfile[]>({
  name: 'dex-profiles',
  softTtl: 15000,
  hardTtl: 90000,
  maxSize: 10,
});

const trendingCache = new SwrCache<DexTokenResponse>({
  name: 'dex-trending',
  softTtl: 15000,
  hardTtl: 60000,
  maxSize: 100,
});

// ─── Helpers ───
function filterAndSortPairs(pairs: any[], query: string): any[] {
  const exactQuery = query.toLowerCase();
  const isExactAddress = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(query);

  // Filter Solana pairs
  let solPairs = pairs.filter((p) => p.chainId === 'solana');

  // Remove low-liquidity scams (unless exact address query)
  if (!isExactAddress) {
    solPairs = solPairs.filter((p) => {
      const liquidity = p.liquidity?.usd || 0;
      const volume = p.volume?.h24 || 0;
      return liquidity >= 1000 || volume >= 500;
    });
  }

  // Smart sort: exact match > score
  solPairs.sort((a: any, b: any) => {
    const aExact =
      (a.baseToken?.symbol?.toLowerCase() === exactQuery ||
        a.baseToken?.address?.toLowerCase() === exactQuery)
        ? 1
        : 0;
    const bExact =
      (b.baseToken?.symbol?.toLowerCase() === exactQuery ||
        b.baseToken?.address?.toLowerCase() === exactQuery)
        ? 1
        : 0;

    if (aExact !== bExact) return bExact - aExact;

    const aScore = (a.liquidity?.usd || 0) * 0.5 + (a.volume?.h24 || 0) * 0.5;
    const bScore = (b.liquidity?.usd || 0) * 0.5 + (b.volume?.h24 || 0) * 0.5;
    return bScore - aScore;
  });

  return solPairs;
}

// ─── Routes ───

// GET /api/dex/search
router.get('/search', asyncHandler(async (req, res) => {
  const q = validateRequiredString(req.query.q, 'q');

  try {
    const data = await searchCache.fetch(`search_${q}`, async () => {
      const { response, text } = await fetchWithRetry(
        `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } },
        2
      );

      if (!response.ok) {
        throw new Error(`DexScreener API status: ${response.status}`);
      }

      return JSON.parse(text);
    });

    if (data?.pairs) {
      data.pairs = filterAndSortPairs(data.pairs, q);
    }

    res.json(data);
  } catch (error: any) {
    dexLogger.warn({ query: q, error: error.message }, 'DEX search failed');
    res.status(500).json({ error: error.message, pairs: [] });
  }
}));

// GET /api/dex/tokens/:mint
router.get('/tokens/:mint', asyncHandler(async (req, res) => {
  const mintParam = req.params.mint;
  const mintList = Array.from(new Set(mintParam.split(',').map((m) => m.trim()).filter(Boolean)));

  if (mintList.length === 0) {
    return res.json({ schemaVersion: '1.0.0', pairs: [] });
  }

  const pairs: any[] = [];
  const missingMints: string[] = [];

  // Check cache for each mint
  for (const mint of mintList) {
    const cached = tokenCache.get(mint);
    if (cached && !cached.isStale) {
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
          if (parsed?.pairs) {
            pairs.push(...parsed.pairs);

            // Cache individual mint results
            const pairsByMint: Record<string, any[]> = {};
            for (const p of parsed.pairs) {
              const baseAddr = p.baseToken?.address;
              if (baseAddr) {
                if (!pairsByMint[baseAddr]) pairsByMint[baseAddr] = [];
                pairsByMint[baseAddr].push(p);
              }
            }
            for (const [m, p] of Object.entries(pairsByMint)) {
              tokenCache.set(m, { schemaVersion: '1.0.0', pairs: p });
            }
          }
        }
      } catch (chunkErr: any) {
        dexLogger.warn({ chunk: ids, error: chunkErr.message }, 'Chunk fetch failed, using simulation');
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

// GET /api/dex/tokens/trending
router.get('/tokens/trending', asyncHandler(async (req, res) => {
  try {
    const data = await trendingCache.fetch('trending_tokens', async () => {
      const ids = TRENDING_MINTS.join(',');
      const { response, text } = await fetchWithRetry(
        `https://api.dexscreener.com/latest/dex/tokens/${ids}`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } },
        3,
        2000
      );

      if (!response.ok) {
        throw new Error(`DexScreener API status: ${response.status}`);
      }

      const parsed = JSON.parse(text);
      if (!parsed?.pairs?.length) {
        throw new Error('Empty pairs from DexScreener');
      }

      return parsed;
    });

    res.json(data);
  } catch (e: any) {
    dexLogger.warn({ error: e.message }, 'Trending fetch failed, using simulation');
    const pairs = TRENDING_MINTS.map((m) => generateSimulatedPair(m));
    res.json({ pairs });
  }
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
          dexLogger.error({ url, error: err.message }, 'Profile endpoint error');
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
    dexLogger.warn({ error: error.message }, 'Profiles fetch failed');

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
    dexLogger.warn({ mint, error: error.message }, 'Pairs fetch failed');

    const cached = pairsCache.get(mint);
    if (cached) return res.json(cached.data);

    const pairs = mint.split(',').map((m) => generateSimulatedPair(m.trim())).filter(Boolean);
    res.json({ schemaVersion: '1.0.0', pairs });
  }
}));

export default router;
