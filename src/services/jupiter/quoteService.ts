import { QuoteResponse } from '@jup-ag/api';
import { getJupiterQuote } from './jupiterService';

export interface JupiterQuoteInfo {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct: number;
  routePlan: string[];
  quote: QuoteResponse;
  timestamp: number;
}

const quoteCache: Map<string, { data: JupiterQuoteInfo; expiresAt: number }> = new Map();

export const fetchJupiterQuoteService = async (
  inputMint: string,
  outputMint: string,
  amountLamports: number | bigint,
  slippageBps: number = 100
): Promise<JupiterQuoteInfo | null> => {
  const cacheKey = `${inputMint}-${outputMint}-${amountLamports}-${slippageBps}`;
  const cached = quoteCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  const rawQuote = await getJupiterQuote(inputMint, outputMint, amountLamports, slippageBps);
  if (!rawQuote) return null;

  const routePlanNames = rawQuote.routePlan
    ? rawQuote.routePlan.map(r => r.swapInfo?.label || 'DEX')
    : [];

  const quoteInfo: JupiterQuoteInfo = {
    inputMint,
    outputMint,
    inAmount: rawQuote.inAmount,
    outAmount: rawQuote.outAmount,
    priceImpactPct: Number(rawQuote.priceImpactPct || 0),
    routePlan: routePlanNames,
    quote: rawQuote,
    timestamp: Date.now()
  };

  quoteCache.set(cacheKey, {
    data: quoteInfo,
    expiresAt: Date.now() + 5000 // 5 sec cache
  });

  return quoteInfo;
};

export const clearQuoteCache = () => {
  quoteCache.clear();
};
