/**
 * Health check endpoint
 */
import { Router } from 'express';
import { fetchWithTimeout } from '../utils/fetch.js';
import { getJupiterApiKey, getHeliusApiKey } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import type { HealthCheck } from '../types/index.js';

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const checks: Record<string, string> = {};

  // Check Jupiter Quote API
  try {
    const jupKey = getJupiterApiKey();
    const testUrl = 
      'https://api.jup.ag/swap/v1/quote' +
      '?inputMint=So11111111111111111111111111111111111111112' +
      '&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' +
      '&amount=1000000&slippageBps=50' +
      '&restrictIntermediateTokens=true';

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (jupKey) headers['x-api-key'] = jupKey;

    const resp = await fetchWithTimeout(testUrl, { headers }, 5000);
    checks.jupiter = resp.ok ? 'OK' : `Error ${resp.status}`;
  } catch (err: any) {
    checks.jupiter = `Failed: ${err.message}`;
  }

  // Check DEXScreener
  try {
    const resp = await fetchWithTimeout(
      'https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112',
      {},
      5000
    );
    checks.dexscreener = resp.ok ? 'OK' : `Error ${resp.status}`;
  } catch (err: any) {
    checks.dexscreener = `Failed: ${err.message}`;
  }

  // Check Helius
  const heliusKey = getHeliusApiKey();
  if (heliusKey) {
    try {
      const resp = await fetchWithTimeout(
        `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
        },
        5000
      );
      checks.helius = resp.ok ? 'OK' : `Error ${resp.status}`;
    } catch (err: any) {
      checks.helius = `Failed: ${err.message}`;
    }
  } else {
    checks.helius = 'No API key configured';
  }

  const allOk = Object.entries(checks).every(([k, v]) => {
    if (k === 'helius' && v.startsWith('No API key')) return true;
    return v === 'OK';
  });

  const result: HealthCheck = {
    status: allOk ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    checks,
  };

  res.status(allOk ? 200 : 503).json(result);
}));

export default router;
