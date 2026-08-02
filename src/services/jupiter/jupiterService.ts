import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { createJupiterApiClient, QuoteResponse } from '@jup-ag/api';
import { DEFAULT_HELIUS_RPC } from '../../constants/solana';

export interface RpcEndpoint {
  url: string;
  latencyMs: number;
  failCount: number;
  lastChecked: number;
  healthy: boolean;
}

class JupiterRpcPool {
  private endpoints: Map<string, RpcEndpoint> = new Map();
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;

  addEndpoint(url: string) {
    if (!this.endpoints.has(url)) {
      this.endpoints.set(url, { url, latencyMs: 999, failCount: 0, lastChecked: 0, healthy: true });
    }
  }

  async measureLatency(url: string): Promise<number> {
    const start = performance.now();
    try {
      const conn = new Connection(url, 'confirmed');
      await conn.getSlot('confirmed');
      const ms = performance.now() - start;
      const ep = this.endpoints.get(url);
      if (ep) { ep.latencyMs = ms; ep.healthy = true; ep.failCount = 0; ep.lastChecked = Date.now(); }
      return ms;
    } catch {
      const ep = this.endpoints.get(url);
      if (ep) { ep.failCount++; ep.healthy = ep.failCount < 3; ep.lastChecked = Date.now(); }
      return 9999;
    }
  }

  getBestEndpoint(): string {
    const healthy = [...this.endpoints.values()].filter(e => e.healthy);
    if (!healthy.length) return [...this.endpoints.values()][0]?.url || DEFAULT_HELIUS_RPC;
    return healthy.sort((a, b) => a.latencyMs - b.latencyMs)[0].url;
  }
}

export const jupiterRpcPool = new JupiterRpcPool();

const getJupiterApiClient = () => {
  const customApiKey = localStorage.getItem('jupiter_standalone_apiKey') || '';
  if (customApiKey) {
    if (customApiKey.startsWith('http')) {
      return createJupiterApiClient({ basePath: customApiKey });
    } else {
      return createJupiterApiClient({ apiKey: customApiKey });
    }
  }
  return createJupiterApiClient();
};

export const pingJupiterApi = async (): Promise<{ healthy: boolean; pingMs: number; error?: string; isCustom: boolean }> => {
  const customApiKey = localStorage.getItem('jupiter_standalone_apiKey') || '';
  const isCustom = !!customApiKey;
  const start = performance.now();
  try {
    const res = await getJupiterApiClient().quoteGet({
      inputMint: 'So11111111111111111111111111111111111111112',
      outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      amount: 1000000,
      slippageBps: 50
    });
    if (res && res.outAmount) {
      return { healthy: true, pingMs: Math.round(performance.now() - start), isCustom };
    }
    return { healthy: false, pingMs: 0, isCustom, error: "Empty response" };
  } catch (e: any) {
    let errorMsg = e.message || "API Error";
    if (e.status === 429) errorMsg = "Rate Limited (429)";
    else if (e.status === 401) errorMsg = "Unauthorized API Key";
    return { healthy: false, pingMs: 0, isCustom, error: errorMsg };
  }
};

const simPriceMap: Record<string, number> = {};

export function getSimulatedPrice(simMint: string, externalPriceNative?: number): number {
  if (simPriceMap[simMint] !== undefined) {
    return simPriceMap[simMint];
  }
  if (externalPriceNative && externalPriceNative > 0) {
    simPriceMap[simMint] = externalPriceNative;
    return externalPriceNative;
  }
  const defaultPrice = 0.000001;
  simPriceMap[simMint] = defaultPrice;
  return defaultPrice;
}

export function updateSimPrice(simMint: string, newPrice: number) {
  if (newPrice > 0) {
    simPriceMap[simMint] = newPrice;
  }
}

export function clearSimPriceCache() {
  Object.keys(simPriceMap).forEach(key => delete simPriceMap[key]);
}

export const getJupiterQuote = async (
  inputMint: string,
  outputMint: string,
  amount: number | bigint,
  slippageBps: number = 100
): Promise<QuoteResponse | null> => {
  try {
    const client = getJupiterApiClient();
    const res = await client.quoteGet({
      inputMint,
      outputMint,
      amount: Number(amount),
      slippageBps
    });
    return res || null;
  } catch (e: any) {
    console.warn('[JupiterStandaloneQuote]: Quote fetch failed:', e?.message || e);
    return null;
  }
};

export const createJupiterSwapTransaction = async (
  quote: QuoteResponse,
  userPublicKey: string
): Promise<string | null> => {
  try {
    const client = getJupiterApiClient();
    const swapRes = await client.swapPost({
      swapRequest: {
        quoteResponse: quote,
        userPublicKey,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 'auto'
      }
    });
    return swapRes.swapTransaction || null;
  } catch (e: any) {
    console.warn('[JupiterStandaloneSwap]: Swap tx creation failed:', e?.message || e);
    return null;
  }
};

export const executeTxWithRPCFallback = async (
  rawTx: string | VersionedTransaction,
  userConn?: Connection
): Promise<{ success: boolean; signature?: string; error?: string }> => {
  try {
    const conn = userConn || new Connection(jupiterRpcPool.getBestEndpoint(), 'confirmed');
    let versionedTx: VersionedTransaction;
    if (typeof rawTx === 'string') {
      const buffer = Buffer.from(rawTx, 'base64');
      versionedTx = VersionedTransaction.deserialize(buffer);
    } else {
      versionedTx = rawTx;
    }

    const txSignature = await conn.sendTransaction(versionedTx, {
      skipPreflight: true,
      maxRetries: 3
    });

    const confirmation = await conn.confirmTransaction(txSignature, 'confirmed');
    if (confirmation.value.err) {
      return { success: false, signature: txSignature, error: 'Transaction failed on chain' };
    }
    return { success: true, signature: txSignature };
  } catch (e: any) {
    return { success: false, error: e?.message || 'Transaction submission failed' };
  }
};

export const getTokenBalanceRaw = async (
  mint: string,
  walletPublicKey: string,
  rpcUrl?: string
): Promise<bigint> => {
  try {
    const conn = new Connection(rpcUrl || jupiterRpcPool.getBestEndpoint(), 'confirmed');
    const pubkey = new PublicKey(walletPublicKey);
    const tokenAccounts = await conn.getParsedTokenAccountsByOwner(pubkey, {
      mint: new PublicKey(mint)
    });
    if (!tokenAccounts.value.length) return 0n;
    const amountStr = tokenAccounts.value[0].account.data.parsed.info.tokenAmount.amount;
    return BigInt(amountStr);
  } catch {
    return 0n;
  }
};
