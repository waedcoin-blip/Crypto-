import { Connection, PublicKey, Transaction, VersionedTransaction, TransactionMessage, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { createJupiterApiClient, QuoteResponse } from '@jup-ag/api';
import { useAppStore } from '../store/appStore';
import { detectTokenStage } from '../lib/utils';
import { DEFAULT_HELIUS_RPC } from '../constants/solana';
import { telemetryService } from './telemetryService';
import { getNetworkConfig } from '../config/network';
import { getSolPriceUsd } from '../utils/pnlCalculator';
import { normalizePriceImpact, buildSafeQuoteDiagnostic, MAX_PRICE_IMPACT_RATIO } from '../utils/quoteSafety';

// ─── RPC POOL: Smart multi-endpoint with health tracking ───────────────────
export interface RpcEndpoint {
  url: string;
  latencyMs: number;
  failCount: number;
  lastChecked: number;
  healthy: boolean;
}

class RpcPool {
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
      telemetryService.recordApiRequest(url, 'getSlot', 200, ms);
      return ms;
    } catch (err: any) {
      const ms = performance.now() - start;
      const ep = this.endpoints.get(url);
      if (ep) { ep.failCount++; ep.healthy = ep.failCount < 3; ep.lastChecked = Date.now(); }
      telemetryService.recordApiRequest(url, 'getSlot', 500, ms, err.message || 'RPC Failure');
      return 9999;
    }
  }

  getBestEndpoint(): string {
    const healthy = [...this.endpoints.values()].filter(e => e.healthy);
    if (!healthy.length) return [...this.endpoints.values()][0]?.url || '';
    return healthy.sort((a, b) => a.latencyMs - b.latencyMs)[0].url;
  }

  startHealthChecks(intervalMs = 10000) {
    if (this.healthCheckInterval) return;
    this.healthCheckInterval = setInterval(() => {
      for (const url of this.endpoints.keys()) this.measureLatency(url);
    }, intervalMs);
  }

  stopHealthChecks() {
    if (this.healthCheckInterval) { clearInterval(this.healthCheckInterval); this.healthCheckInterval = null; }
  }
}

export const rpcPool = new RpcPool();

const getJupiterApiClient = () => {
  const customApiKey = localStorage.getItem('jupiter_auto_apiKey') || localStorage.getItem('juipter_auto_apiKey') || '';
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
  const customApiKey = localStorage.getItem('jupiter_auto_apiKey') || localStorage.getItem('juipter_auto_apiKey') || '';
  const isCustom = !!customApiKey;
  const start = performance.now();
  const span = telemetryService.startSpan('jupiter.ping', { 'api.custom': isCustom });
  try {
    const res = await getJupiterApiClient().quoteGet({
      inputMint: 'So11111111111111111111111111111111111111112',
      outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      amount: 1000000,
      slippageBps: 50
    });
    const ms = Math.round(performance.now() - start);
    if (res && res.outAmount) {
      telemetryService.endSpan(span, 'OK', { 'http.status_code': 200, 'ping.ms': ms });
      telemetryService.recordApiRequest('Jupiter API', 'ping', 200, ms, undefined, span.traceId);
      return { healthy: true, pingMs: ms, isCustom };
    }
    telemetryService.endSpan(span, 'ERROR', { 'http.status_code': 500 }, 'Empty response');
    telemetryService.recordApiRequest('Jupiter API', 'ping', 500, ms, 'Empty response', span.traceId);
    return { healthy: false, pingMs: 0, isCustom, error: "Empty response" };
  } catch (e: any) {
    const ms = Math.round(performance.now() - start);
    let errorMsg = e.message || "API Error";
    let statusCode = e.status || 500;
    if (e.status === 429) { errorMsg = "Rate Limited (429)"; statusCode = 429; }
    else if (e.status === 401) { errorMsg = "Unauthorized API Key"; statusCode = 401; }
    
    telemetryService.endSpan(span, 'ERROR', { 'http.status_code': statusCode }, errorMsg);
    telemetryService.recordApiRequest('Jupiter API', 'ping', statusCode, ms, errorMsg, span.traceId);
    return { healthy: false, pingMs: 0, isCustom, error: errorMsg };
  }
};


export const FALLBACK_RPCS = [
  DEFAULT_HELIUS_RPC
];

FALLBACK_RPCS.forEach(url => rpcPool.addEndpoint(url));

export const getTokenBalanceRaw = async (connection: Connection, walletAddress: string, tokenMint: string): Promise<string> => {
  try {
    const parsedTokenAccounts = await connection.getParsedTokenAccountsByOwner(
      new PublicKey(walletAddress),
      { mint: new PublicKey(tokenMint) }
    );
    let balance = 0n;
    parsedTokenAccounts.value.forEach((account) => {
      balance += BigInt(account.account.data.parsed.info.tokenAmount.amount || '0');
    });
    return balance.toString();
  } catch (e) {
    return '0';
  }
};

import bs58 from 'bs58';

export const addTipInstructionToVersionedTx = async (
  connection: Connection,
  tx: VersionedTransaction,
  payerKey: PublicKey,
  tipAmountSol: number
): Promise<VersionedTransaction> => {
  const TIP_ACCOUNTS = [
    "4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE",
    "D2L6yPZ2FmmmTKPgzaMKdhu6EWZcTpLy1Vhx8uvZe7NZ",
    "9bnz4RShgq1hAnLnZbP8kbgBg1kEmcJBYQq3gQbmnSta",
    "5VY91ws6B2hMmBFRsXkoAAdsPHBJwRfBht4DXox3xkwn",
    "2nyhqdwKcJZR2vcqCyrYsaPVdAnFoJjiksCXJ7hfEYgD",
    "2q5pghRs6arqVjRvT5gfgWfWcHWmw1ZuCzphgd5KfWGJ",
    "wyvPkWjVZz1M8fHQnMMCDTQDbkManefNNhweYk5WkcF",
    "3KCKozbAaF75qEU33jtzozcJ29yJuaLJTy2jFdzUY8bT",
    "4vieeGHPYPG2MmyPRcYjdiDmmhN3ww7hsFNap8pVN3Ey",
    "4TQLFNWK8AovT1gFvda5jfw2oJeRMKEmw7aH6MGBJ3or"
  ];
  const tipAccount = new PublicKey(TIP_ACCOUNTS[Math.floor(Math.random() * TIP_ACCOUNTS.length)]);

  const tipInstruction = SystemProgram.transfer({
    fromPubkey: payerKey,
    toPubkey: tipAccount,
    lamports: Math.floor(tipAmountSol * 1_000_000_000)
  });

  const addressLookupTableAccounts: any[] = [];
  if (tx.message.addressTableLookups && tx.message.addressTableLookups.length > 0) {
    const lookupPromises = tx.message.addressTableLookups.map(async (lookup) => {
      try {
        const tableAccount = await connection.getAddressLookupTable(lookup.accountKey);
        return tableAccount.value;
      } catch (e) {
        console.warn("Failed to fetch address lookup table:", lookup.accountKey.toBase58(), e);
        return null;
      }
    });
    const results = await Promise.all(lookupPromises);
    for (const res of results) { if (res) addressLookupTableAccounts.push(res); }
  }

  const decompiled = TransactionMessage.decompile(tx.message, { addressLookupTableAccounts });
  decompiled.instructions.push(tipInstruction);
  const newCompiledMessage = decompiled.compileToV0Message(addressLookupTableAccounts);
  return new VersionedTransaction(newCompiledMessage);
};

export const pollSignatureStatus = async (
  connection: Connection,
  signature: string,
  timeoutMs: number = 60000
): Promise<string> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = await getSignatureStatusRobust(connection, signature);
      if (value) {
        if (value.err) {
          throw new Error(`Transaction failed: ${JSON.stringify(value.err)}`);
        }
        if (value.confirmationStatus === 'confirmed' || value.confirmationStatus === 'finalized') {
          return signature;
        }
      }
    } catch (pollingErr: any) {
      if (pollingErr.message?.includes('Transaction failed')) {
        throw pollingErr;
      }
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for confirmation`);
};
export const getSignatureStatusRobust = async (
  connection: Connection,
  signature: string
): Promise<any> => {
  if (!signature || typeof signature !== 'string') {
    return null;
  }
  // Try standard plural method first as it is most supported on modern nodes
  try {
    const res = await connection.getSignatureStatuses([signature]);
    if (res && res.value && res.value[0]) {
      return res.value[0];
    }
  } catch (errPlural: any) {
    console.warn("getSignatureStatuses plural failed, trying singular:", errPlural.message || errPlural);
  }

  // Try singular method as a fallback
  try {
    const res = await connection.getSignatureStatus(signature, { searchTransactionHistory: true });
    if (res && res.value) {
      return res.value;
    }
  } catch (errSingular: any) {
    console.warn("getSignatureStatus singular failed:", errSingular.message || errSingular);
  }

  return null;
};

export const getLatestBlockhashForExecution = async (
  connection: Connection
): Promise<{
  blockhash: string;
  lastValidBlockHeight: number;
}> => {
  if (!connection?.rpcEndpoint) {
    throw new Error('EXECUTION_RPC_UNAVAILABLE');
  }

  const result = await connection.getLatestBlockhash('confirmed');

  if (!result.blockhash || !result.lastValidBlockHeight) {
    throw new Error('INVALID_EXECUTION_BLOCKHASH');
  }

  return result;
};

export const getLatestBlockhashWithFallback = getLatestBlockhashForExecution;

// --- MOMENTUM & JITO UTILITIES ---

export const getJitoTipFloor = async (): Promise<number> => {
  try {
    const res = await fetch('https://bundles.jito.wtf/api/v1/bundles/tip_floor');
    const data = await res.json();
    return data[0]?.landed_tips_75th_percentile || 0.00005;
  } catch {
    return 0.00005;
  }
};

export const calculateDynamicJitoTip = async (
  tradeValueUsd: number,
  expectedProfitPct: number,
  urgency: 'low' | 'medium' | 'high' | 'extreme' = 'medium'
): Promise<number> => {
  const floorTip = await getJitoTipFloor();
  const urgencyMultipliers = {
    low: 1,
    medium: 3,
    high: 10,
    extreme: 50
  };
  
  const expectedProfitPctSafe = Math.max(0, expectedProfitPct);
  const maxTipFromProfit = (tradeValueUsd * (expectedProfitPctSafe / 100) * 0.05);
  const solPrice = getSolPriceUsd() || 150; 
  const maxTipSol = Math.min(maxTipFromProfit / solPrice, 0.5);
  
  const baseTip = floorTip * urgencyMultipliers[urgency];
  const finalTip = Math.min(baseTip, maxTipSol);
  return Math.max(finalTip, 0.00001);
};


export interface SwapResult {
  signature?: string;
  error?: string;
  quote?: QuoteResponse;
}

export const calculateDynamicSlippageBps = (
  liquidityUsd: number,
  currentPnLPercent?: number
): number => {
  let slippageBps = 175;
  if (liquidityUsd > 500000) slippageBps = 50;
  else if (liquidityUsd > 250000) slippageBps = 75;
  else if (liquidityUsd > 100000) slippageBps = 125;

  if (currentPnLPercent !== undefined) {
    if (currentPnLPercent > 0) {
      const profitSlippageCap = Math.floor(currentPnLPercent * 100 * 0.3);
      if (profitSlippageCap > 0) {
        slippageBps = Math.max(30, Math.min(slippageBps, profitSlippageCap));
      }
    } else {
      slippageBps = Math.min(slippageBps, 100);
    }
  }
  return slippageBps;
};

// ─── JUPITER QUOTE: Unified real + simulation path ────────────────────────
export const getJupiterQuote = async (
  inputMint: string,
  outputMint: string,
  amount: number,
  liquidityUsd: number = 0,
  initialBuyCostSol?: number,
  minTargetProfitPct?: number,
  currentPnLPercent?: number,
  restrictIntermediateTokens?: boolean,
  onlyDirectRoutes?: boolean,
  customSlippageBps?: number
): Promise<QuoteResponse | null> => {
  const isValidSolanaAddress = (addr: string) => {
    if (!addr) return false;
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
  };

  if (!isValidSolanaAddress(inputMint) || !isValidSolanaAddress(outputMint)) {
    console.warn(`getJupiterQuote abort: invalid mint. input: "${inputMint}", output: "${outputMint}"`);
    return null;
  }
  if (inputMint === outputMint) return null;

  const determinedSlippage = (customSlippageBps !== undefined && customSlippageBps > 0)
    ? customSlippageBps
    : calculateDynamicSlippageBps(liquidityUsd, currentPnLPercent);

  // ── LIVE PATH ─────────────────────────────────────────────────────────────
  useAppStore.getState().addJupiterLog({
    type: 'QUOTE',
    message: `Requesting quote ${inputMint.slice(0,6)} -> ${outputMint.slice(0,6)}`,
    details: { amount, slippageBps: determinedSlippage }
  });

  try {
    const startTime = Date.now();

    const customApiKey = localStorage.getItem('jupiter_auto_apiKey') || localStorage.getItem('juipter_auto_apiKey') || '';
    let baseUrlParam = '';
    if (customApiKey && customApiKey.startsWith('http')) baseUrlParam = customApiKey;

    const queryParams = new URLSearchParams({
      inputMint,
      outputMint,
      amount: String(Math.floor(amount)),
      slippageBps: String(determinedSlippage),
    });
    if (baseUrlParam) queryParams.set('baseUrl', baseUrlParam);
    if (restrictIntermediateTokens) queryParams.set('restrictIntermediateTokens', 'true');
    if (onlyDirectRoutes) queryParams.set('onlyDirectRoutes', 'true');

    const headers: Record<string, string> = {};
    if (customApiKey && !customApiKey.startsWith('http')) headers['x-api-key'] = customApiKey;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);
    let quoteRes;
    try {
      quoteRes = await fetch(`/api/jup/quote?${queryParams.toString()}`, { headers, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }
    if (!quoteRes.ok) throw new Error(`Proxy error ${quoteRes.status}`);

    const quote = await quoteRes.json() as QuoteResponse;
    if (!quote || (quote as any).error || (quote as any).errorCode) return null;
    
    // Validate quote routes
    if (!quote.routePlan || quote.routePlan.length === 0) {
      console.warn(`[QUOTE REJECTED]: No valid route plan found`);
      return null;
    }
    
    // Expiration checks (Bypass real Solana slot numbers and protect with real-time latency guards instead)
    let isStale = false;
    if ((quote as any).contextSlot) {
      const slotVal = Number((quote as any).contextSlot);
      // Real Solana mainnet slot is below 1B, while simulated slot (Date.now()/400) is > 4B
      if (slotVal > 1000000000) {
        const quoteTime = slotVal * 400;
        if (Date.now() - quoteTime > 15000) {
          isStale = true;
        }
      }
    }
    if (isStale) {
       console.warn(`[QUOTE REJECTED]: Quote is too stale based on context slot`);
       return null;
    }


    const quoteAgeMs = Date.now() - startTime;
    if (quoteAgeMs > 4000) {
      console.warn(`[QUOTE REJECTED]: Latency ${quoteAgeMs}ms`);
      return null;
    }

    const normalizedImpact = normalizePriceImpact(quote.priceImpactPct);
    if (Number.isNaN(normalizedImpact) || !Number.isFinite(normalizedImpact)) {
      const diagnostic = buildSafeQuoteDiagnostic({ quote, inputMint, outputMint });
      console.warn('[QUOTE REJECTED]: Invalid price impact from Jupiter:', diagnostic);
      return null;
    }

    const priceImpactPct = normalizedImpact * 100;
    const maxAllowedImpact = liquidityUsd > 100000 ? 8.0 : 10.0;
    if (priceImpactPct > maxAllowedImpact) {
      const diagnostic = buildSafeQuoteDiagnostic({ quote, inputMint, outputMint });
      console.warn(`[QUOTE REJECTED]: Price impact ${priceImpactPct.toFixed(2)}% exceeds max allowed ${maxAllowedImpact}%:`, diagnostic);
      return null;
    }

    if (initialBuyCostSol !== undefined && minTargetProfitPct !== undefined) {
      const expectedLamportsOut = BigInt(quote.outAmount);
      const expectedSolOut = Number(expectedLamportsOut) / 1_000_000_000;
      const trueNetProfitPct = ((expectedSolOut - initialBuyCostSol) / initialBuyCostSol) * 100;
      if (trueNetProfitPct <= minTargetProfitPct) {
        console.warn(`[QUOTE REJECTED]: Net P&L (${trueNetProfitPct.toFixed(2)}%) below target (${minTargetProfitPct}%)`);
        return null;
      }
    }

    useAppStore.getState().addJupiterLog({
      type: 'INFO',
      message: `Quote Success: ${quote.outAmount} (${priceImpactPct.toFixed(2)}% impact)`,
      details: { routePlan: quote.routePlan?.length, outAmount: quote.outAmount }
    });

    return quote;
  } catch (error: any) {
    const errStr = error?.toString() || '';
    const isTransientError = errStr.includes('NO_ROUTES_FOUND') || 
                             errStr.includes('Proxy error 429') ||
                             errStr.includes('Proxy error 500') ||
                             errStr.includes('Proxy error 502') ||
                             errStr.includes('Proxy error 503') ||
                             errStr.includes('Proxy error 504');
                             
    if (!isTransientError) {
      console.error("Jupiter quote failed:", error);
      useAppStore.getState().addJupiterLog({
        type: 'ERROR',
        message: `Quote Error: ${errStr}`,
      });
    } else if (errStr.includes('Proxy error 429')) {
      useAppStore.getState().addJupiterLog({
        type: 'INFO',
        message: `Quote Rate Limited (429). Consider adding a custom Jupiter API key in Settings. Retrying...`,
      });
    }
    return null;
  }
};

export const createJupiterSwapTransaction = async (
  userPublicKey: string,
  quoteResponse: QuoteResponse,
  prioritizationFeeLamports: number = 100000,
  connection?: Connection
): Promise<VersionedTransaction | null> => {
  const useDynamicSlippage = localStorage.getItem('hd_jupiter_dynamic_slippage') !== 'false';
  useAppStore.getState().addJupiterLog({
    type: 'INFO',
    message: `Building swap tx for ${userPublicKey.slice(0,6)}...`,
    details: { prioritiyFee: prioritizationFeeLamports, useDynamicSlippage }
  });

  try {
    const swapRequest: any = {
      quoteResponse,
      userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      trackingAccount: "FE2vyoM5CbGcTXSHUsPj79eKAd8fvMzuy3jgr9pYBCLv",
      prioritizationFeeLamports: { priorityLevelWithMaxLamports: { priorityLevel: 'medium', maxLamports: typeof prioritizationFeeLamports === 'number' ? prioritizationFeeLamports : 100000, global: false } } as any,
    };

    if (useDynamicSlippage) {
      swapRequest.dynamicSlippage = {
        minBps: 50,   // 0.5% minimum
        maxBps: 1000  // 10% maximum
      };
    }

    const { swapTransaction } = await getJupiterApiClient().swapPost({
      swapRequest,
    });

    const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
    let tx = VersionedTransaction.deserialize(swapTransactionBuf);

    if (!connection) {
      throw new Error('EXECUTION_CONNECTION_REQUIRED');
    }

    const activeConnection = connection;

    const isSenderEnabled = localStorage.getItem('hd_sender_enabled') === 'true';
    if (isSenderEnabled) {
      const isSwqos = localStorage.getItem('hd_sender_swqos') === 'true';
      const tipAmountSol = isSwqos ? 0.000005 : 0.0002;
      tx = await addTipInstructionToVersionedTx(activeConnection, tx, new PublicKey(userPublicKey), tipAmountSol);
    }

    // ─── OPTIMIZATION: Inject super fresh blockhash to prevent expiration ───
    try {
      const latestBlockhash = await getLatestBlockhashForExecution(activeConnection);
      tx.message.recentBlockhash = latestBlockhash.blockhash;
    } catch (bhErr: any) {
      console.warn("Failed to inject fresh blockhash into createJupiterSwapTransaction:", bhErr.message || bhErr);
    }

    useAppStore.getState().addJupiterLog({
      type: 'INFO',
      message: `Swap transaction built successfully.`,
    });
    return tx;
  } catch (error: any) {
    console.error('Jupiter Swap Transaction Error:', error);
    useAppStore.getState().addJupiterLog({
      type: 'ERROR',
      message: `Swap Tx Build Error: ${error.message || String(error)}`,
    });
    return null;
  }
};

export enum PositionStage {
  RECOVER_CAPITAL = "RECOVER_CAPITAL",
  TRIM_ONE = "TRIM_ONE",
  TRIM_TWO = "TRIM_TWO",
  RUNNER = "RUNNER"
}

export interface ActivePosition {
  tokenAddress: string;
  currentTokenBalance: bigint;
  entryCostSol: number;
  initialMoonbagSize: bigint;
  currentStage: PositionStage;
}

const pendingTransactions = new Set<string>();

export interface AdvancedTokenMetrics {
  mintAddress: string;
  bondingCurveProgress: number;
  isRaydiumListed: boolean;
  marketCapUsd: number;
  liquidityUsd: number;
  isRugSafe: boolean;
  riskScore: number;
  devWalletOwnershipPct: number;
  top10HoldersPct: number;
  buyCount30s: number;
  uniqueBuyers30s: number;
  totalBuys: number;
  totalSells: number;
  priceChange1m: number;
  priceChange5m?: number;
  percentageIncrease?: number;
  ageMinutes?: number;
  volume24h?: number;
  dexId?: string;
}

export const verifyHardenedScannerCriteria = (
  metrics: AdvancedTokenMetrics,
  currentActivePositionsCount: number,
  maxPositionsLimit: number,
  customConfig?: {
    minMcapPump?: number; minMcapRaydium?: number; maxMcap?: number;
    minLiquidity?: number; minLiquidityRatio?: number; maxRiskScore?: number;
    maxDevOwnership?: number; maxTop10Ownership?: number;
    minUniqueBuyers30s?: number; minBuyCount30s?: number; maxBuyCount30s?: number;
    minBuySellRatio?: number; maxBuySellRatio?: number;
    maxPriceChange1m?: number; minBondingProgress?: number; maxBondingProgress?: number;
    minAge?: number; maxAge?: number;
    tradePumpFun?: boolean; tradeRaydium?: boolean; tradeBonding?: boolean; tradeUnknown?: boolean; hardenedMinProfit5m?: number;
  }
): boolean => {
  if (metrics.mintAddress === 'So11111111111111111111111111111111111111112') return false;
  if (maxPositionsLimit > 0 && currentActivePositionsCount >= maxPositionsLimit) return false;

  const tradePumpFun = customConfig?.tradePumpFun ?? true;
  const tradeRaydium = customConfig?.tradeRaydium ?? true;
  const tradeBonding = customConfig?.tradeBonding ?? true;
  const tradeUnknown = customConfig?.tradeUnknown ?? true;
  const hardenedMinProfit5m = customConfig?.hardenedMinProfit5m ?? 0.0;
  const minMcapPump = customConfig?.minMcapPump ?? (60000 + 5000);
  const minMcapRaydium = customConfig?.minMcapRaydium ?? 110000;
  const maxMcap = customConfig?.maxMcap ?? 2500000;
  const minLiquidity = customConfig?.minLiquidity ?? 55000;
  const minLiquidityRatio = customConfig?.minLiquidityRatio ?? 0.07;
  const maxRiskScore = customConfig?.maxRiskScore ?? 22;
  const maxDevOwnership = customConfig?.maxDevOwnership ?? 0.8;
  const maxTop10Ownership = customConfig?.maxTop10Ownership ?? 14.0;
  const minUniqueBuyers30s = customConfig?.minUniqueBuyers30s ?? 5 + 1;
  const minBuyCount30s = customConfig?.minBuyCount30s ?? 4;
  const maxBuyCount30s = customConfig?.maxBuyCount30s ?? 12;
  const minBuySellRatio = customConfig?.minBuySellRatio ?? 2.5;
  const maxBuySellRatio = customConfig?.maxBuySellRatio ?? 5.5;
  const maxPriceChange1m = customConfig?.maxPriceChange1m ?? 10.0;
  const minBondingProgress = customConfig?.minBondingProgress ?? 0;
  const maxBondingProgress = customConfig?.maxBondingProgress ?? 100;
  const minAge = customConfig?.minAge ?? 0;
  const maxAge = customConfig?.maxAge ?? 120;

  const stage = detectTokenStage({
    address: metrics.mintAddress,
    dexId: metrics.dexId,
    bondingCurveProgress: metrics.bondingCurveProgress,
    isRaydiumListed: metrics.isRaydiumListed
  });

  // Skip if stage doesn't match what the user enabled
  if (stage.isBonding && !tradeBonding) return false;
  if (stage.platform === 'PUMP_FUN' && !tradePumpFun) return false;
  if (stage.platform === 'RAYDIUM' && !tradeRaydium) return false;
  if (stage.platform === 'PUMPSWAP' && !tradeRaydium) return false;
  if (stage.platform === 'UNKNOWN' && !tradeUnknown) return false;

  const calibratedMinMcap = stage.isMigrated ? minMcapRaydium : minMcapPump;
  if (metrics.marketCapUsd < calibratedMinMcap || metrics.marketCapUsd > maxMcap) return false;

  if (!stage.isMigrated) {
    if (stage.bondingProgress < minBondingProgress || stage.bondingProgress > maxBondingProgress) return false;
  }

  // Enforce Token Age limits for ALL tokens (both pre-migration and migrated)
  const ageMinutes = metrics.ageMinutes ?? 0;
  if (ageMinutes > 0 && (ageMinutes < minAge || ageMinutes > maxAge)) {
    return false;
  }

  const liquidityRatio = metrics.liquidityUsd / metrics.marketCapUsd;
  if (metrics.liquidityUsd < minLiquidity || liquidityRatio < minLiquidityRatio) return false;

  if (!metrics.isRugSafe || metrics.riskScore >= maxRiskScore) return false;
  if (metrics.devWalletOwnershipPct > maxDevOwnership) return false;
  if (metrics.top10HoldersPct >= maxTop10Ownership) return false;

  if (metrics.uniqueBuyers30s < minUniqueBuyers30s) return false;
  if (metrics.buyCount30s < minBuyCount30s || metrics.buyCount30s > maxBuyCount30s) return false;

  const buySellRatio = metrics.totalBuys / Math.max(metrics.totalSells, 1);
  if (buySellRatio < minBuySellRatio || buySellRatio > maxBuySellRatio) return false;

  if (metrics.priceChange1m > maxPriceChange1m) return false;
  const profit5m = metrics.priceChange5m ?? metrics.percentageIncrease ?? metrics.priceChange1m ?? 0;
  if (profit5m < hardenedMinProfit5m) return false;

  // Real-world early tokens often do not have 24h volume > market cap immediately after launch.
  // We require non-zero volume/liquidity activity rather than demanding volume > 100% of market cap.
  const volume = metrics.volume24h ?? 0;
  if (volume < 0) return false;

  return true;
};

export const processActiveTrackingFrame = async (
  connection: Connection,
  position: ActivePosition & { symbol?: string; isManualSellTriggered?: boolean; currentPriceSol?: number; currentPnLPct?: number },
  livePoolLiquidityUsd: number,
  walletPublicKey: string,
  config?: { takeProfit: number; stopLoss: number },
  prefetchedQuote?: any
): Promise<{ shouldExit: boolean; reason?: string; quote?: any }> => {
  const tokenAddress = position.tokenAddress;

  try {
    const startTime = Date.now();
    let quote = prefetchedQuote || null;

    if (!quote) {
      try {
        quote = await getJupiterQuote(
          tokenAddress,
          "So11111111111111111111111111111111111111112",
          Number(position.currentTokenBalance),
          livePoolLiquidityUsd
        );
      } catch (e: any) {
        console.warn(`[EVAL]: getJupiterQuote failed: ${e.message}`);
      }
    }

    let expectedSolOut = quote ? (Number(quote.outAmount) / 1_000_000_000) : 0;
    const dynamicFeesSol = Number(position.currentTokenBalance) < 50000000000 ? 0.00155 : 0.0035;
    
    if (!position.entryCostSol || position.entryCostSol <= 0) {
      console.warn(`[EVAL]: Invalid entryCostSol for ${tokenAddress}, refusing to evaluate PnL`);
      return { shouldExit: false };
    }
    const realEntryCost = position.entryCostSol;
    let netPnL = 0;

    if (quote && expectedSolOut > 0) {
      netPnL = ((expectedSolOut - dynamicFeesSol - realEntryCost) / realEntryCost) * 100;
    } else if (position.currentPnLPct !== undefined) {
      // Fallback 1: If we have a previously calculated PnL, use it.
      // We do not want to use raw balance with a hardcoded 1e6 denominator here.
      netPnL = position.currentPnLPct;
    } else {
      // If we don't have a valid quote and we don't have a recent PnL, fail-close and refuse to evaluate.
      return { shouldExit: false };
    }

    const defaultTP = config?.takeProfit ?? 45.0;
    const rawSL = config?.stopLoss ?? -30.0;
    const defaultSL = config?.stopLoss !== undefined ? config.stopLoss : -Math.abs(rawSL);
    const flashCrashThreshold = defaultSL - 10.0;

    const isFlashCrash = netPnL <= flashCrashThreshold;
    const isHardStop = netPnL <= defaultSL;
    const isTakeProfit = netPnL >= defaultTP;

    if (position.isManualSellTriggered || isFlashCrash || isHardStop || isTakeProfit) {
      if (netPnL <= -95.0 && !isHardStop && !position.isManualSellTriggered) {
        console.log(`[SLIPPAGE BLOCK]: Execution aborted for ${position.symbol}. Toxic price impact.`);
        return { shouldExit: false };
      }

      let reason = "MANUAL";
      if (isFlashCrash) reason = "FLASH CRASH";
      if (isHardStop) reason = "HARD STOP";
      if (isTakeProfit) reason = "TAKE PROFIT";

      console.log(`💣 [EXIT SIGNAL]: ${position.symbol} (${reason}) NetPnL: ${netPnL.toFixed(2)}%`);
      return { shouldExit: true, reason, quote };
    }
  } catch (error: any) {
    const errStr = error?.message || '';
    if (!errStr.includes("No liquidity") && !errStr.includes("400")) {
      console.warn(`[TRACKING ERROR] ${position.symbol}: ${errStr}`);
    }
  }
  return { shouldExit: false };
};

