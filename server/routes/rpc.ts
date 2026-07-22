/**
 * RPC latency probe endpoint
 */
import { Router } from 'express';
import { fetchWithTimeout } from '../utils/fetch.js';
import { validateUrlArray } from '../utils/validation.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import type { RpcProbeResult } from '../types/index.js';

const router = Router();

router.post('/probe', asyncHandler(async (req, res) => {
  const urls = validateUrlArray(req.body.urls, 5);

  const results = await Promise.all(
    urls.map(async (url): Promise<RpcProbeResult> => {
      const start = Date.now();
      try {
        const response = await fetchWithTimeout(
          url,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSlot', params: [] }),
          },
          3000
        );
        const latency = Date.now() - start;
        const data = await response.json();
        return {
          url,
          latency,
          ok: !data.error,
          slot: data.result,
        };
      } catch (e: any) {
        return {
          url,
          latency: Date.now() - start,
          ok: false,
          error: e.message,
        };
      }
    })
  );

  res.json({ results });
}));

export default router;
