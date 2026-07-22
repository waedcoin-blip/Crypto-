/**
 * Deterministic token simulation for development/testing
 * ⚠️ Only enabled when ENABLE_SIMULATED_TOKENS=true
 */
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import type { DexPair, SimulatedTokenInfo } from '../types/index.js';

const TRENDING_MINTS = [
  '4NborgnPENJYf7U2ENHdmRvzsVftZhWo2Lan8Rv6pump',
  '32CdQdBUxbCsLy5AUHWmyidfwhgGUr9N573NBUrDpump',
  'CMWubDdEsHvcbEmUom8GZgFqXPYNBS9M9pyAaJMApump',
  '6P8ixuqGZpfyHAxyxbU4a31vsMiFiCQjBzVV58gPpump',
  '3JZLiZXirGdJj7HMokBKXWz8zSLWfC5gNDaNFVNRpump',
  'BrbTtwbR4e1DoGwt8VeBSmX7XAWW3bHeNtzH74whpump',
  '4XEtVrvHEnik8Gs4b3spWUuwZiJ1tc3fQxBYgvCrpump',
  'epaURqhoxEz1rxzusSf8JtT9Y4reZzGvhBpvCPipump',
  'B9rZz8cLVZETAW4K7Sn9bwqz1dD5uCCCZRWFsy5Epump',
];

const PREFIXES = ['Mega', 'Super', 'Safe', 'Baby', 'Golden', 'Shiba', 'Pepe', 'Chad', 'Moon', 'Doge', 'Pump', 'Alpha', 'Turbo', 'Hyper', 'Sol', 'Laser'];
const NOUNS = ['Cat', 'Dog', 'Frog', 'Elon', 'Inu', 'Mars', 'Rich', 'Gems', 'Norg', 'Screener', 'Snipe', 'Laser', 'Pulse', 'Wif', 'Pepe', 'Bull'];
const SUFFIXES = ['Coin', 'Token', 'AI', 'Chain', 'DAO', 'Classic', 'V2', 'Club', 'Fi', 'Pump'];
const IMAGES = [
  'https://images.unsplash.com/photo-1621761191319-c6fb62004040?w=128&q=80',
  'https://images.unsplash.com/photo-1639762681485-074b7f938ba0?w=128&q=80',
  'https://images.unsplash.com/photo-1622630998477-20aa696ecb05?w=128&q=80',
  'https://images.unsplash.com/photo-1642104704074-907c0698cbd9?w=128&q=80',
];

function djb2Hash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function getDeterministicTokenInfo(mint: string): SimulatedTokenInfo {
  const hash = djb2Hash(mint);

  const prefix = PREFIXES[hash % PREFIXES.length];
  const noun = NOUNS[(hash >> 2) % NOUNS.length];
  const suffix = SUFFIXES[(hash >> 4) % SUFFIXES.length];

  return {
    name: `${prefix} ${noun} ${suffix}`,
    symbol: `${prefix.slice(0, 2)}${noun.slice(0, 3)}`.toUpperCase(),
    imageUrl: IMAGES[hash % IMAGES.length],
  };
}

export function generateSimulatedPair(mint: string): DexPair {
  // Special case: Wrapped SOL
  if (mint === 'So11111111111111111111111111111111111111112') {
    return {
      chainId: 'solana',
      dexId: 'raydium',
      url: 'https://dexscreener.com/solana/58oebuf67fckstllqqfkoeceb3lswgndtfvnrpump',
      pairAddress: '58oebuf67fckstllqqfkoeceb3lswgndtfvnrpump',
      baseToken: {
        address: 'So11111111111111111111111111111111111111112',
        name: 'Wrapped SOL',
        symbol: 'SOL',
      },
      quoteToken: {
        address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        symbol: 'USDC',
      },
      priceNative: '150.00',
      priceUsd: '150.00',
      txns: {
        m5: { buys: 120, sells: 80 },
        h1: { buys: 1450, sells: 1200 },
        h6: { buys: 8900, sells: 7500 },
        h24: { buys: 35000, sells: 31000 },
      },
      volume: { h24: 12500000, h6: 3400000, h1: 650000, m5: 55000 },
      priceChange: { m5: 0.12, h1: -0.45, h6: 1.2, h24: 3.4 },
      liquidity: { usd: 45000000, base: 300000, quote: 22500000 },
      fdv: 85000000000,
      marketCap: 85000000000,
      info: {
        imageUrl: IMAGES[0],
        websites: [],
        socials: [],
      },
    };
  }

  const hash = djb2Hash(mint);
  const { name, symbol, imageUrl } = getDeterministicTokenInfo(mint);
  const isPump = mint.toLowerCase().endsWith('pump');

  const basePrice = 0.00001 + (hash % 1000) * 0.00001;
  const priceUsd = basePrice.toFixed(8);
  const priceNative = (basePrice / 150.0).toFixed(12);
  const marketCap = 25000 + (hash % 180000);
  const liquidityUsd = 8000 + (hash % 35000);
  const volh24 = 5000 + (hash % 150000);
  const buys24h = 100 + (hash % 2000);
  const sells24h = 50 + (hash % 1200);

  return {
    chainId: 'solana',
    dexId: isPump ? 'pump-fun' : 'raydium',
    url: `https://dexscreener.com/solana/${mint}`,
    pairAddress: `${mint.slice(0, 8)}pair${mint.slice(-4)}`,
    baseToken: { address: mint, name, symbol },
    quoteToken: { address: 'So11111111111111111111111111111111111111112', symbol: 'SOL' },
    priceNative,
    priceUsd,
    txns: {
      m5: { buys: Math.max(1, Math.floor(buys24h * 0.005)), sells: Math.max(1, Math.floor(sells24h * 0.005)) },
      h1: { buys: Math.max(2, Math.floor(buys24h * 0.05)), sells: Math.max(1, Math.floor(sells24h * 0.05)) },
      h6: { buys: Math.max(5, Math.floor(buys24h * 0.25)), sells: Math.max(3, Math.floor(sells24h * 0.25)) },
      h24: { buys: buys24h, sells: sells24h },
    },
    volume: {
      h24: volh24,
      h6: volh24 * 0.35,
      h1: volh24 * 0.08,
      m5: volh24 * 0.08 * 0.12,
    },
    priceChange: {
      m5: -5 + (hash % 15),
      h1: -15 + (hash % 45),
      h6: -25 + (hash % 90),
      h24: -50 + (hash % 250),
    },
    liquidity: {
      usd: liquidityUsd,
      base: liquidityUsd / (basePrice || 1),
      quote: liquidityUsd / 150.0,
    },
    fdv: marketCap,
    marketCap,
    info: { imageUrl, websites: [], socials: [] },
  };
}

export function generateSimulatedPrice(mint: string): { id: string; type: string; price: string } {
  const hash = djb2Hash(mint);
  const basePrice = 0.00015 + (hash % 100) * 0.000003;
  const fluctuation = Math.sin(Date.now() / 15000 + hash) * 0.1 * basePrice;

  return {
    id: mint,
    type: 'derived',
    price: (basePrice + fluctuation).toFixed(8),
  };
}

export function generateSimulatedQuote(
  inputMint: string,
  outputMint: string,
  amount: string,
  slippageBps: string
): Record<string, unknown> {
  if (!config.ENABLE_SIMULATED_TOKENS) {
    logger.warn('Simulated tokens requested but disabled');
    throw new Error('Simulated tokens are disabled');
  }

  const inAmt = Number(amount || 100000000);
  const slipBps = Number(slippageBps || 100);

  let outAmtVal = 0;
  if (inputMint.startsWith('sim')) {
    outAmtVal = Math.floor(inAmt * 150);
  } else {
    outAmtVal = Math.floor(inAmt / 150);
  }

  if (outAmtVal <= 0) outAmtVal = 1;
  const otherAmountThreshold = Math.floor(outAmtVal * (1 - slipBps / 10000));

  return {
    inputMint,
    inAmount: String(inAmt),
    outputMint,
    outAmount: String(outAmtVal),
    otherAmountThreshold: String(otherAmountThreshold),
    swapMode: 'ExactIn',
    slippageBps: slipBps,
    platformFee: null,
    priceImpactPct: '0.001',
    routePlan: [],
    contextSlot: 2341234,
  };
}

export { TRENDING_MINTS };
