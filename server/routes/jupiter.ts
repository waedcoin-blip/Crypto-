/**
 * Jupiter API proxy routes with caching and fallback
 */
import { Router } from 'express';
import { SwrCache } from '../cache/SwrCache.js';
import { fetchWithRetry, isNoRouteError, isUntradableError } from '../utils/fetch.js';
import { getJupiterApiKey, config } from '../config/index.js';
import { jupiterLogger } from '../utils/logger.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validateSolanaAddress, validateRequiredString } from '../utils/validation.js';
import { generateSimulatedPrice, generateSimulatedQuote } from '../services/simulation.js';
import { BadGatewayError } from '../utils/errors.js';
import type { JupiterPriceResponse } from '../types/index.js';

const router = Router();

// ─── Cache Instances ───
const priceCache = new SwrCache<JupiterPriceResponse>({
  name: 'jup-price',
  softTtl: 15000,   // 15s
  hardTtl: 60000,   // 60s
  maxSize: 3000,
});

const quoteCache = new SwrCache<{ status: number; text: string }>({
  name: 'jup-quote',
  softTtl: 3000,    // 3s
  hardTtl: 10000,   // 10s
  maxSize: 1000,
});

// ─── Helpers ───
function normalizeJupiterBase(base: string): string {
  let normalized = base.endsWith('/') ? base.slice(0, -1) : base;

  // Replace any jup.ag subdomain with api.jup.ag
  if (normalized.includes('jup.ag')) {
    normalized = normalized.replace(/^(https?:\/\/)?([a-zA-Z0-9-.]+\.)?jup\.ag/, (match, proto) => {
      return (proto || 'https://') + 'api.jup.ag';
    });
  }

  return normalized;
}

function buildJupiterQuoteUrl(
  base: string,
  inputMint: string,
  outputMint: string,
  amount: string,
  slippageBps: string
): string {
  const isUnified = base.includes('api.jup.ag');
  const pathVersion = isUnified ? '/swap/v1' : '/v6';

  if (!base.includes('/quote') && !base.includes('/swap')) {
    return `${base}${pathVersion}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}`;
  }

  // Handle full path normalization
  let url = base;
  if (isUnified && url.includes('/v6/')) {
    url = url.replace('/v6/', '/swap/v1/');
  }
  if (isUnified && !url.includes('/swap/v1/') && url.includes('/quote')) {
    url = url.replace('/quote', '/swap/v1/quote');
  }

  const urlObj = new URL(url);
  urlObj.searchParams.set('inputMint', inputMint);
  urlObj.searchParams.set('outputMint', outputMint);
  urlObj.searchParams.set('amount', amount);
  urlObj.searchParams.set('slippageBps', slippageBps);
  return urlObj.toString();
}

// ─── Routes ───

// GET /api/jup/price
router.get('/price', asyncHandler(async (req, res) => {
  const ids = validateRequiredString(req.query.ids, 'ids');
  const vsToken = req.query.vsToken as string | undefined;
  const apiKey = (req.headers['x-api-key'] as string) || undefined;
  const cacheKey = `${ids}-${vsToken || 'no-vs'}-${apiKey || 'no-key'}-${req.query.t || ''}`;

  const data = await priceCache.fetch(cacheKey, async () => {
    const idList = ids.split(',').map((id) => id.trim());
    const realIds = idList.filter((id) => !id.startsWith('sim'));
    const simIds = idList.filter((id) => id.startsWith('sim'));

    const result: JupiterPriceResponse = { data: {}, timeTaken: 0.001 };

    // Fetch real prices
    if (realIds.length > 0) {
      const fetchOpts: RequestInit = {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      };
      const resolvedKey = getJupiterApiKey(apiKey);
      if (resolvedKey) (fetchOpts.headers as Record<string, string>)['x-api-key'] = resolvedKey;

      let targetUrl = `https://api.jup.ag/price/v2?ids=${realIds.join(',')}`;
      if (vsToken) targetUrl += `&vsToken=${vsToken}`;

      const { text } = await fetchWithRetry(targetUrl, fetchOpts);
      if (text?.trim()) {
        try {
          const parsed = JSON.parse(text);
          Object.assign(result, parsed);
        } catch (e: any) {
          jupiterLogger.error({ error: e.message }, 'Jupiter Price Parse Error');
        }
      }
    }

    // Generate simulated prices
    if (simIds.length > 0) {
      if (!result.data) result.data = {};
      for (const simId of simIds) {
        result.data[simId] = generateSimulatedPrice(simId);
      }
    }

    return result;
  });

  res.json(data);
}));

// GET /api/jup/quote
router.get('/quote', asyncHandler(async (req, res) => {
  const inputMint = validateSolanaAddress(req.query.inputMint, 'inputMint');
  const outputMint = validateSolanaAddress(req.query.outputMint, 'outputMint');
  const amount = validateRequiredString(req.query.amount, 'amount');
  const slippageBps = validateRequiredString(req.query.slippageBps, 'slippageBps');
  const baseUrl = (req.query.baseUrl as string) || 'https://api.jup.ag';

  if (inputMint === outputMint) {
    return res.status(400).json({ error: 'Input and output mints cannot be the same' });
  }

  // Handle simulated tokens
  const isSimulated = inputMint.startsWith('sim') || outputMint.startsWith('sim');
  if (isSimulated) {
    if (!config.ENABLE_SIMULATED_TOKENS) {
      return res.status(400).json({ error: 'Simulated tokens are disabled' });
    }
    const mockQuote = generateSimulatedQuote(inputMint, outputMint, amount, slippageBps);
    return res.json(mockQuote);
  }

  const cacheKey = `${inputMint}-${outputMint}-${amount}-${slippageBps}-${baseUrl}-${req.query.t || ''}`;

  const quoteResult = await quoteCache.fetch(cacheKey, async () => {
    jupiterLogger.debug({ inputMint, outputMint, amount }, 'Jupiter Quote Proxy Request');

    const base = normalizeJupiterBase(baseUrl);
    const jupUrl = buildJupiterQuoteUrl(base, inputMint, outputMint, amount, slippageBps);

    const fetchOpts: RequestInit = {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0' },
    };
    const resolvedKey = getJupiterApiKey(req.headers['x-api-key'] as string);
    if (resolvedKey) (fetchOpts.headers as Record<string, string>)['x-api-key'] = resolvedKey;

    // Fallback URLs
    const fallbacks = [
      jupUrl,
      jupUrl.replace('api.jup.ag/swap/v1', 'quote-api.jup.ag/v6'),
      jupUrl.replace('api.jup.ag/swap/v1', 'api.jup.ag/v6'),
    ];

    let lastResult: { status: number; text: string } | null = null;

    for (const urlToTry of fallbacks) {
      try {
        const { response, text } = await fetchWithRetry(urlToTry, fetchOpts, 2, 50);
        lastResult = { status: response.status, text };

        if (response.ok || response.status !== 429) {
          break;
        }
      } catch (e) {
        jupiterLogger.warn({ url: urlToTry, error: (e as Error).message }, 'Fallback fetch failed');
      }
    }

    if (!lastResult) {
      throw new BadGatewayError('All Jupiter fallback endpoints failed');
    }

    // Parse error responses for cache decisions
    if (lastResult.status >= 400) {
      try {
        const body = JSON.parse(lastResult.text);
        const isTemporaryNoRoute = isNoRouteError(body);
        const shouldHide = isNoRouteError(body) || isUntradableError(body) || lastResult.status === 429;

        if (!shouldHide) {
          jupiterLogger.error({ status: lastResult.status, url: jupUrl.slice(0, 100) }, 'Jupiter API Error');
        }

        return { status: lastResult.status, text: lastResult.text };
      } catch {
        return { status: lastResult.status, text: lastResult.text };
      }
    }

    return { status: lastResult.status, text: lastResult.text };
  });

  res.status(quoteResult.status).send(quoteResult.text);
}));

// POST /api/jup/swap
router.post('/swap', asyncHandler(async (req, res) => {
  const baseUrl = (req.query.baseUrl as string) || 'https://api.jup.ag';
  const resolvedKey = getJupiterApiKey(req.headers['x-api-key'] as string);

  const base = normalizeJupiterBase(baseUrl);
  const isUnified = base.includes('api.jup.ag');
  const pathVersion = isUnified ? '/swap/v1' : '/v6';

  let jupUrl: string;
  if (!base.includes('/swap')) {
    jupUrl = `${base}${pathVersion}/swap`;
  } else {
    let url = base;
    if (isUnified && url.includes('/v6/')) {
      url = url.replace('/v6/', '/swap/v1/');
    }
    if (isUnified && !url.includes('/swap/v1/')) {
      url = url.replace('/swap', '/swap/v1/swap');
    }
    jupUrl = url;
  }

  jupiterLogger.debug({ url: jupUrl }, 'Jupiter Swap Proxy');

  const fetchOpts: RequestInit = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0',
    },
    body: JSON.stringify(req.body),
  };
  if (resolvedKey) (fetchOpts.headers as Record<string, string>)['x-api-key'] = resolvedKey;

  const { response, text } = await fetchWithRetry(jupUrl, fetchOpts);

  if (!response.ok) {
    try {
      const body = JSON.parse(text);
      const shouldHide = isNoRouteError(body) || isUntradableError(body) || response.status === 429;
      if (!shouldHide) {
        jupiterLogger.error({ status: response.status }, 'Jupiter Swap API Error');
      }
    } catch {
      jupiterLogger.error({ status: response.status, text: text.slice(0, 500) }, 'Jupiter Swap API Error');
    }
  }

  res.status(response.status).send(text);
}));

export default router;
