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

  const isInternal = (url: string) => {
    try {
      const u = new URL(url);
      const h = u.hostname;
      return h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h === '::1' ||
             h.startsWith('192.168.') || h.startsWith('10.') || h.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./) ||
             h.includes('metadata.google.internal') || h.includes('169.254.169.254');
    } catch {
      return true; // fail safe
    }
  };

  const results = await Promise.all(
    urls.map(async (url): Promise<RpcProbeResult> => {
      if (isInternal(url)) {
         return { url, latency: 0, ok: false, error: 'Prohibited internal network access' };
      }
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
