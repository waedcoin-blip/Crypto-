// server/routes/jupiter.ts
import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { getJupiterApiKey } from '../config/index.js';
import { fetchWithRetry } from '../utils/fetch.js';

const router = Router();

const JUPITER_BASE_URL = 'https://api.jup.ag/swap/v1';

/**
 * GET /api/jup/quote
 * Proxy for Jupiter quote API.
 */
router.get('/quote', asyncHandler(async (req: Request, res: Response) => {
  const { inputMint, outputMint, amount, slippageBps } = req.query;

  if (!inputMint || !outputMint || !amount) {
    return res.status(400).json({ status: 'error', error: 'inputMint, outputMint, and amount are required' });
  }

  const queryParams = new URLSearchParams({
    inputMint: String(inputMint),
    outputMint: String(outputMint),
    amount: String(amount),
    slippageBps: String(slippageBps || 250),
    swapMode: 'ExactIn',
  });

  const url = `${JUPITER_BASE_URL}/quote?${queryParams.toString()}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const apiKey = getJupiterApiKey();
  if (apiKey) headers['x-api-key'] = apiKey;

  try {
    const { response, text } = await fetchWithRetry(url, { method: 'GET', headers, timeoutMs: 8000 }, 2, 500);

    if (!response.ok) {
      return res.status(response.status).json({
        status: 'error',
        error: `Jupiter quote failed: HTTP ${response.status}`,
        details: text?.slice(0, 500),
      });
    }

    const quote = JSON.parse(text);
    res.json({ status: 'success', quote, timestamp: Date.now() });
  } catch (err: any) {
    res.status(500).json({
      status: 'error',
      error: `Jupiter quote exception: ${err?.message || String(err)}`,
    });
  }
}));

/**
 * GET /api/jup/indexed-route-map
 * Proxy for Jupiter indexed route map (for debugging).
 */
router.get('/indexed-route-map', asyncHandler(async (req: Request, res: Response) => {
  const url = `${JUPITER_BASE_URL}/indexed-route-map`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const apiKey = getJupiterApiKey();
  if (apiKey) headers['x-api-key'] = apiKey;

  try {
    const { response, text } = await fetchWithRetry(url, { method: 'GET', headers, timeoutMs: 10000 }, 1, 0);

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
