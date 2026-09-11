// server/routes/dexscreener.ts
import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { fetchWithRetry } from '../utils/fetch.js';
import { cacheRegistry } from '../utils/cacheRegistry.js';

const router = Router();

const DEXSCREENER_BASE_URL = 'https://api.dexscreener.com/latest/dex';

/**
 * GET /api/dex/tokens/:mint
 * Get token pairs from DexScreener by mint address.
 */
router.get('/tokens/:mint', asyncHandler(async (req: Request, res: Response) => {
  const { mint } = req.params;
  if (!mint) {
    return res.status(400).json({ status: 'error', error: 'Mint address is required' });
  }

  // Use SWR cache to avoid rate limiting
  const cached = await cacheRegistry.dexscreener.fetch(`tokens:${mint}`, async () => {
    const url = `${DEXSCREENER_BASE_URL}/tokens/${mint}`;
    const { response, text } = await fetchWithRetry(url, { timeoutMs: 8000 }, 2, 500);

    if (!response.ok) {
      throw new Error(`DexScreener HTTP ${response.status}`);
    }

    return JSON.parse(text);
  });

  res.json({ status: 'success', data: cached, timestamp: Date.now() });
}));

/**
 * GET /api/dex/pairs/:pairAddress
 * Get pair data by pair address.
 */
router.get('/pairs/:pairAddress', asyncHandler(async (req: Request, res: Response) => {
  const { pairAddress } = req.params;
  if (!pairAddress) {
    return res.status(400).json({ status: 'error', error: 'Pair address is required' });
  }

  const cached = await cacheRegistry.dexscreener.fetch(`pairs:${pairAddress}`, async () => {
    const url = `${DEXSCREENER_BASE_URL}/pairs/solana/${pairAddress}`;
    const { response, text } = await fetchWithRetry(url, { timeoutMs: 8000 }, 2, 500);

    if (!response.ok) {
      throw new Error(`DexScreener HTTP ${response.status}`);
    }

    return JSON.parse(text);
  });

  res.json({ status: 'success', data: cached, timestamp: Date.now() });
}));

/**
 * GET /api/dex/search/:query
 * Search DexScreener by token symbol or name.
 */
router.get('/search/:query', asyncHandler(async (req: Request, res: Response) => {
  const { query } = req.params;
  if (!query) {
    return res.status(400).json({ status: 'error', error: 'Search query is required' });
  }

  try {
    const url = `${DEXSCREENER_BASE_URL}/search?q=${encodeURIComponent(query)}`;
    const { response, text } = await fetchWithRetry(url, { timeoutMs: 8000 }, 2, 500);

    if (!response.ok) {
      return res.status(response.status).json({ status: 'error', error: `HTTP ${response.status}` });
    }

    const data = JSON.parse(text);
    res.json({ status: 'success', data, timestamp: Date.now() });
  } catch (err: any) {
    res.status(500).json({ status: 'error', error: err?.message || String(err) });
  }
}));

export default router;
