/**
 * RPC latency probe endpoint
 */
import { Router } from 'express';
import { fetchWithTimeout } from '../utils/fetch.js';
import { validateUrlArray } from '../utils/validation.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import type { RpcProbeResult } from '../types/index.js';

const router = Router();

const ALLOWED_RPC_DOMAINS = [
  'solana.com',
  'helius-rpc.com',
  'helius.xyz',
  'quicknode.pro',
  'quiknode.pro',
  'tatum.io',
  'ankr.com',
  'alchemy.com',
  'triton.one',
  'rpcpool.com',
  'genesysgo.net',
  'extrnode.com',
  'run.app',
];

function isSafeRpcUrl(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    
    // Strict HTTPS only
    if (u.protocol !== 'https:') {
      return false;
    }

    const host = u.hostname.toLowerCase();

    // Block IP addresses (IPv4 & IPv6 literals)
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(':') || host.startsWith('[') || host.endsWith(']')) {
      return false;
    }

    // Block localhost, internal, metadata endpoints
    if (
      host === 'localhost' ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      host.endsWith('.corp') ||
      host.includes('metadata')
    ) {
      return false;
    }

    // Must match approved RPC domain list or subdomains
    const isApprovedDomain = ALLOWED_RPC_DOMAINS.some(
      (dom) => host === dom || host.endsWith(`.${dom}`)
    );

    return isApprovedDomain;
  } catch {
    return false;
  }
}

router.post('/probe', asyncHandler(async (req, res) => {
  const urls = validateUrlArray(req.body.urls, 5);

  const results = await Promise.all(
    urls.map(async (url): Promise<RpcProbeResult> => {
      if (!isSafeRpcUrl(url)) {
        return {
          url,
          latency: 0,
          ok: false,
          error: 'Forbidden: RPC endpoint must be a secure HTTPS URL from an approved Solana provider',
        };
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
