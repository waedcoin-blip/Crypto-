import { Connection, PublicKey, Transaction, VersionedTransaction, TransactionMessage, SystemProgram } from '@solana/web3.js';
import { createJupiterApiClient, QuoteResponse } from '@jup-ag/api';
import { useAppStore } from '../store/appStore';

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
      return ms;
    } catch {
      const ep = this.endpoints.get(url);
      if (ep) { ep.failCount++; ep.healthy = ep.failCount < 3; ep.lastChecked = Date.now(); }
      return 9999;
    }
  }

  getBestEndpoint(): string {
    const healthy = [...this.endpoints.values()].filter(e => e.healthy);
    if (!healthy.length) return [...this.endpoints.values()][0]?.url || 'https://api.mainnet-beta.solana.com';
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
  const customApiKey = localStorage.getItem('juipter_auto_apiKey') || '';
  if (customApiKey && customApiKey.startsWith('http')) {
    return createJupiterApiClient({ basePath: customApiKey });
  }
  return createJupiterApiClient();
};

export const FALLBACK_RPCS = [
  'https://winter-methodical-river.solana-mainnet.quiknode.pro/4b240281eaf3b0b4e4c527bc69c2f9e1a6e7b439/',
  'https://api.mainnet-beta.solana.com'
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

export const executeTxWithRPCFallback = async (
  tx: VersionedTransaction,
  connection: Connection
): Promise<string> => {
  const isSenderEnabled = localStorage.getItem('hd_sender_enabled') === 'true';

  if (isSenderEnabled) {
    const senderEndpoint = localStorage.getItem('hd_sender_endpoint') || 'https://sender.helius-rpc.com/fast';
    const isSwqos = localStorage.getItem('hd_sender_swqos') === 'true';
    const senderApiKey = localStorage.getItem('hd_sender_apiKey') || '';

    let url = senderEndpoint;
    const params = new URLSearchParams();
    if (isSwqos) params.append("swqos_only", "true");
    if (senderApiKey) params.append("api-key", senderApiKey);
    const paramStr = params.toString();
    if (paramStr) url += (url.includes("?") ? "&" : "?") + paramStr;

    try {
      const serializedTx = Buffer.from(tx.serialize()).toString('base64');
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: Date.now().toString(), method: 'sendTransaction',
          params: [serializedTx, { encoding: 'base64', skipPreflight: true, maxRetries: 0 }]
        })
      });
      const json = await response.json();
      if (json.error) throw new Error(`Helius Sender Error: ${json.error.message}`);
      const signatureResult = json.result;
      const latestBlockhash = await connection.getLatestBlockhash('confirmed');
      const confirmation = await connection.confirmTransaction({
        signature: signatureResult,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
      }, 'confirmed');
      if (confirmation.value.err) throw new Error(`Sender tx failed: ${JSON.stringify(confirmation.value.err)}`);
      return signatureResult;
    } catch (e: any) {
      console.error('Helius Sender failed, falling back:', e.message);
    }
  }

  const signature = bs58.encode(tx.signatures[0]);
  const serializedTx = Buffer.from(tx.serialize()).toString('base64');

  const jitoEndpoints = [
    "https://mainnet.block-engine.jito.wtf/api/v1/transactions",
    "https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/transactions",
    "https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/transactions",
    "https://tokyo.mainnet.block-engine.jito.wtf/api/v1/transactions",
    "https://ny.mainnet.block-engine.jito.wtf/api/v1/transactions"
  ];

  let sentViaJito = false;
  try {
    await Promise.any(
      jitoEndpoints.map(endpoint =>
        fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transactions: [serializedTx] })
        }).then(res => { if (res.ok) return endpoint; throw new Error("Jito failed"); })
      )
    );
    sentViaJito = true;
  } catch (e) {}

  const rpcsToTry = sentViaJito
    ? [connection.rpcEndpoint]
    : [connection.rpcEndpoint, ...FALLBACK_RPCS.filter(r => r !== connection.rpcEndpoint)];

  try {
    return await Promise.any(rpcsToTry.map(async rpc => {
      const conn = new Connection(rpc, 'confirmed');
      if (!sentViaJito) {
        await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 });
      }
      const deadline = Date.now() + 30000;
      const latestBlockhash = await conn.getLatestBlockhash('confirmed');
      while (Date.now() < deadline) {
        const confirmation = await conn.confirmTransaction({
          signature,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
        }, 'confirmed');
        if (!confirmation.value.err) return signature;
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }
      throw new Error('Confirmation timeout');
    }));
  } catch (err: any) {
    throw new Error(`Failed to confirm transaction: ${err?.message || ''}`);
  }
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

// ─── SIMULATION PRICE ENGINE: Realistic market dynamics ──────────────────
interface SimPriceState {
  basePrice: number;
  lastPrice: number;
  lastTick: number;
  volatility: number;
  trend: number;
  trendExpiry: number;
}

const simPriceCache = new Map<string, SimPriceState>();

export function getSimulatedPrice(simMint: string, externalPriceNative?: number): number {
  const now = Date.now();
  let state = simPriceCache.get(simMint);

  if (!state) {
    const seed = simMint.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    const basePrice = externalPriceNative || (0.00008 + (seed % 200) * 0.000002);
    state = {
      basePrice,
      lastPrice: basePrice,
      lastTick: now,
      volatility: 0.015 + (seed % 30) * 0.001,
      trend: (seed % 3 === 0) ? 0.3 : (seed % 3 === 1) ? -0.2 : 0.1,
      trendExpiry: now + 8000 + (seed % 12000)
    };
    simPriceCache.set(simMint, state);
  }

  const elapsed = now - state.lastTick;
  if (elapsed > 400) {
    if (now > state.trendExpiry) {
      const trends = [0.45, -0.35, 0.2, -0.25, 0.6, -0.5, 0.12, -0.18];
      state.trend = trends[Math.floor(Math.random() * trends.length)];
      state.trendExpiry = now + 5000 + Math.random() * 20000;
    }

    const ticks = Math.min(Math.floor(elapsed / 400), 15);
    for (let i = 0; i < ticks; i++) {
      const shock = (Math.random() - 0.5) * 2 * state.volatility;
      const trendPush = state.trend * 0.004;
      const pctChange = shock + trendPush;
      state.lastPrice = Math.max(state.lastPrice * (1 + pctChange), state.basePrice * 0.03);
    }
    state.lastTick = now;
  }

  return state.lastPrice;
}

export function updateSimPrice(simMint: string, priceNative: number) {
  const state = simPriceCache.get(simMint);
  if (state && priceNative > 0) {
    state.lastPrice = state.lastPrice * 0.7 + priceNative * 0.3;
    state.basePrice = priceNative;
  }
}

// ─── JUPITER QUOTE: Unified real + simulation path ────────────────────────
export const getJupiterQuote = async (
  inputMint: string,
  outputMint: string,
  amount: number,
  liquidityUsd: number = 0,
  initialBuyCostSol?: number,
  minTargetProfitPct?: number,
  currentPnLPercent?: number
): Promise<QuoteResponse | null> => {
  const isValidSolanaAddress = (addr: string) => {
    if (!addr) return false;
    if (addr.startsWith('sim')) return true;
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
  };

  if (!isValidSolanaAddress(inputMint) || !isValidSolanaAddress(outputMint)) {
    console.warn(`getJupiterQuote abort: invalid mint. input: "${inputMint}", output: "${outputMint}"`);
    return null;
  }
  if (inputMint === outputMint) return null;

  const determinedSlippage = calculateDynamicSlippageBps(liquidityUsd, currentPnLPercent);

  // ── SIMULATION PATH ────────────────────────────────────────────────────────
  if (inputMint.startsWith('sim') || outputMint.startsWith('sim')) {
    const isBuy = outputMint.startsWith('sim');
    const simMint = isBuy ? outputMint : inputMint;

    let priceNative = 0.0001;
    try {
      const state = useAppStore.getState();
      const m = state?.tokenMetrics?.[simMint];
      if (m?.priceNative) priceNative = m.priceNative;
      else if (m?.priceUsd) priceNative = m.priceUsd / 145;
    } catch (e) {}

    const simulatedPrice = getSimulatedPrice(simMint, priceNative > 0 ? priceNative : undefined);

    // Market impact: larger trades vs smaller pools = more slippage
    const tradeSizeUsd = (amount / 1_000_000_000) * 145;
    const effectiveLiquidityUsd = liquidityUsd || 10000;
    const marketImpactPct = Math.min(tradeSizeUsd / effectiveLiquidityUsd * 0.5, 0.15);

    const priceWithImpact = isBuy
      ? simulatedPrice * (1 + marketImpactPct)
      : simulatedPrice * (1 - marketImpactPct);

    let outAmountVal = 0n;
    if (isBuy) {
      const inputSol = Number(amount) / 1_000_000_000;
      const tokensOut = inputSol / Math.max(priceWithImpact, 0.000000001);
      outAmountVal = BigInt(Math.floor(tokensOut * 1_000_000));
    } else {
      const inputTokens = Number(amount) / 1_000_000;
      const solOut = inputTokens * Math.max(priceWithImpact, 0.000000001);
      outAmountVal = BigInt(Math.floor(solOut * 1_000_000_000));
    }

    if (outAmountVal <= 0n) outAmountVal = 1n;

    const slippageFactor = 1 - (determinedSlippage / 10000);
    const otherAmountThresholdVal = BigInt(Math.floor(Number(outAmountVal) * slippageFactor));

    const mockQuote: QuoteResponse = {
      inputMint,
      inAmount: String(amount),
      outputMint,
      outAmount: String(outAmountVal),
      otherAmountThreshold: String(otherAmountThresholdVal),
      swapMode: "ExactIn",
      slippageBps: determinedSlippage,
      platformFee: null,
      priceImpactPct: (marketImpactPct * 100).toFixed(3),
      routePlan: [],
      contextSlot: Math.floor(Date.now() / 400)
    } as any;

    return mockQuote;
  }

  // ── LIVE PATH ─────────────────────────────────────────────────────────────
  try {
    const startTime = Date.now();

    const customApiKey = localStorage.getItem('juipter_auto_apiKey') || '';
    let baseUrlParam = '';
    if (customApiKey && customApiKey.startsWith('http')) baseUrlParam = customApiKey;

    const queryParams = new URLSearchParams({
      inputMint,
      outputMint,
      amount: String(Math.floor(amount)),
      slippageBps: String(determinedSlippage),
      t: String(Date.now())
    });
    if (baseUrlParam) queryParams.set('baseUrl', baseUrlParam);

    const headers: Record<string, string> = {};
    if (customApiKey && !customApiKey.startsWith('http')) headers['x-api-key'] = customApiKey;

    const quoteRes = await fetch(`/api/jup/quote?${queryParams.toString()}`, { headers });
    if (!quoteRes.ok) throw new Error(`Proxy error ${quoteRes.status}`);

    const quote = await quoteRes.json() as QuoteResponse;
    if (!quote || (quote as any).error || (quote as any).errorCode) return null;

    const quoteAgeMs = Date.now() - startTime;
    if (quoteAgeMs > 2000) {
      console.warn(`[QUOTE REJECTED]: Latency ${quoteAgeMs}ms`);
      return null;
    }

    const priceImpactPct = parseFloat(quote.priceImpactPct as any) * 100;
    const maxAllowedImpact = liquidityUsd > 100000 ? 8.0 : 10.0;
    if (priceImpactPct > maxAllowedImpact) {
      console.warn(`[QUOTE REJECTED]: Price impact ${priceImpactPct.toFixed(2)}%`);
      return null;
    }

    if (initialBuyCostSol !== undefined && minTargetProfitPct !== undefined) {
      const guaranteedLamportsOut = BigInt(quote.otherAmountThreshold);
      const guaranteedSolOut = Number(guaranteedLamportsOut) / 1_000_000_000;
      const estimatedFeesSol = 0.002;
      const cleanReturn = guaranteedSolOut - estimatedFeesSol;
      const trueNetProfitPct = ((cleanReturn - initialBuyCostSol) / initialBuyCostSol) * 100;
      if (trueNetProfitPct <= minTargetProfitPct) {
        console.warn(`[QUOTE REJECTED]: Net P&L (${trueNetProfitPct.toFixed(2)}%) below target (${minTargetProfitPct}%)`);
        return null;
      }
    }

    return quote;
  } catch (error: any) {
    const errStr = error?.toString() || '';
    if (!errStr.includes('NO_ROUTES_FOUND')) console.error("Jupiter quote failed:", error);
    return null;
  }
};

export const createJupiterSwapTransaction = async (
  userPublicKey: string,
  quoteResponse: QuoteResponse,
  prioritizationFeeLamports: number = 100000,
  connection?: Connection
): Promise<VersionedTransaction | null> => {
  try {
    const { swapTransaction } = await getJupiterApiClient().swapPost({
      swapRequest: {
        quoteResponse,
        userPublicKey,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        trackingAccount: "FE2vyoM5CbGcTXSHUsPj79eKAd8fvMzuy3jgr9pYBCLv",
        prioritizationFeeLamports: prioritizationFeeLamports as any,
      },
    });

    const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
    let tx = VersionedTransaction.deserialize(swapTransactionBuf);

    const isSenderEnabled = localStorage.getItem('hd_sender_enabled') === 'true';
    if (isSenderEnabled) {
      const activeConnection = connection || new Connection(
        localStorage.getItem('juipter_auto_rpcUrl') || 'https://api.mainnet-beta.solana.com',
        'confirmed'
      );
      const isSwqos = localStorage.getItem('hd_sender_swqos') === 'true';
      const tipAmountSol = isSwqos ? 0.000005 : 0.0002;
      tx = await addTipInstructionToVersionedTx(activeConnection, tx, new PublicKey(userPublicKey), tipAmountSol);
    }

    return tx;
  } catch (error) {
    console.error('Jupiter Swap Transaction Error:', error);
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
  ageMinutes?: number;
  volume24h?: number;
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
    tradePumpFun?: boolean; tradeRaydium?: boolean; hardenedMinProfit5m?: number;
  }
): boolean => {
  if (metrics.mintAddress === 'So11111111111111111111111111111111111111112') return false;
  if (maxPositionsLimit > 0 && currentActivePositionsCount >= maxPositionsLimit) return false;

  const tradePumpFun = customConfig?.tradePumpFun ?? true;
  const tradeRaydium = customConfig?.tradeRaydium ?? true;
  const hardenedMinProfit5m = customConfig?.hardenedMinProfit5m ?? 0.0;
  const minMcapPump = customConfig?.minMcapPump ?? 65000;
  const minMcapRaydium = customConfig?.minMcapRaydium ?? 110000;
  const maxMcap = customConfig?.maxMcap ?? 2500000;
  const minLiquidity = customConfig?.minLiquidity ?? 55000;
  const minLiquidityRatio = customConfig?.minLiquidityRatio ?? 0.07;
  const maxRiskScore = customConfig?.maxRiskScore ?? 22;
  const maxDevOwnership = customConfig?.maxDevOwnership ?? 0.8;
  const maxTop10Ownership = customConfig?.maxTop10Ownership ?? 14.0;
  const minUniqueBuyers30s = customConfig?.minUniqueBuyers30s ?? 6;
  const minBuyCount30s = customConfig?.minBuyCount30s ?? 4;
  const maxBuyCount30s = customConfig?.maxBuyCount30s ?? 12;
  const minBuySellRatio = customConfig?.minBuySellRatio ?? 2.5;
  const maxBuySellRatio = customConfig?.maxBuySellRatio ?? 5.5;
  const maxPriceChange1m = customConfig?.maxPriceChange1m ?? 10.0;
  const minBondingProgress = customConfig?.minBondingProgress ?? 0;
  const maxBondingProgress = customConfig?.maxBondingProgress ?? 100;
  const minAge = customConfig?.minAge ?? 0;
  const maxAge = customConfig?.maxAge ?? 120;

  const isFreshGraduation = metrics.bondingCurveProgress >= 99.5 || metrics.isRaydiumListed;
  if (!tradePumpFun && !isFreshGraduation) return false;
  if (!tradeRaydium && isFreshGraduation) return false;

  const calibratedMinMcap = isFreshGraduation ? minMcapRaydium : minMcapPump;
  if (metrics.marketCapUsd < calibratedMinMcap || metrics.marketCapUsd > maxMcap) return false;

  if (!isFreshGraduation) {
    if (metrics.bondingCurveProgress < minBondingProgress || metrics.bondingCurveProgress > maxBondingProgress) return false;
    const ageMinutes = metrics.ageMinutes ?? 0;
    if (ageMinutes < minAge || ageMinutes > maxAge) return false;
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
  if (metrics.priceChange1m < hardenedMinProfit5m) return false;

  const volume = metrics.volume24h ?? 0;
  if (volume <= metrics.marketCapUsd) return false;

  return true;
};

export const processActiveTrackingFrame = async (
  connection: Connection,
  position: ActivePosition & { symbol?: string; isManualSellTriggered?: boolean },
  livePoolLiquidityUsd: number,
  walletPublicKey: string,
  config?: { takeProfit: number; stopLoss: number }
): Promise<{ shouldExit: boolean; reason?: string; quote?: any }> => {
  const tokenAddress = position.tokenAddress;

  try {
    const startTime = Date.now();
    let quote = null;

    if (tokenAddress.startsWith('sim')) {
      quote = await getJupiterQuote(
        tokenAddress,
        "So11111111111111111111111111111111111111112",
        Number(position.currentTokenBalance),
        livePoolLiquidityUsd
      );
    } else {
      const quoteParams = {
        inputMint: tokenAddress,
        outputMint: "So11111111111111111111111111111111111111112",
        amount: position.currentTokenBalance.toString() as any,
        slippageBps: 2000,
        maxAccounts: 20
      };

      try {
        quote = await getJupiterApiClient().quoteGet({ ...quoteParams, onlyDirectRoutes: true });
      } catch (e: any) {
        console.warn(`[EVAL]: Direct route check failed: ${e.message}`);
      }

      if (!quote) {
        try {
          quote = await getJupiterApiClient().quoteGet({ ...quoteParams, onlyDirectRoutes: false });
        } catch (e: any) {
          console.warn(`[EVAL]: Multi-hop fallback failed: ${e.message}`);
        }
      }
    }

    if (!quote || Date.now() - startTime > 1500) return { shouldExit: false };

    const guaranteedSolOut = Number(BigInt(quote.otherAmountThreshold)) / 1_000_000_000;
    const dynamicFeesSol = Number(position.currentTokenBalance) < 50000000000 ? 0.00155 : 0.0035;
    const netPnL = ((guaranteedSolOut - dynamicFeesSol - position.entryCostSol) / position.entryCostSol) * 100;

    const defaultTP = config?.takeProfit ?? 45.0;
    const defaultSL = config?.stopLoss ?? -30.0;
    const flashCrashThreshold = Math.min(-37.5, defaultSL - 7.5);

    const isFlashCrash = netPnL <= flashCrashThreshold;
    const isHardStop = netPnL <= -85.0 || netPnL <= defaultSL;
    const isTakeProfit = netPnL >= defaultTP;

    if (position.isManualSellTriggered || isFlashCrash || isHardStop || isTakeProfit) {
      if (netPnL <= -95.0 && !isHardStop) {
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

const executeTxViaJitoWithFallback = async (tx: VersionedTransaction): Promise<string | null> => {
  const isSenderEnabled = localStorage.getItem('hd_sender_enabled') === 'true';
  if (isSenderEnabled) {
    const url = localStorage.getItem('hd_sender_endpoint') || 'https://sender.helius-rpc.com/fast';
    try {
      const serializedTx = Buffer.from(tx.serialize()).toString('base64');
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: Date.now().toString(), method: 'sendTransaction',
          params: [serializedTx, { encoding: 'base64', skipPreflight: true, maxRetries: 0 }]
        })
      });
      const json = await response.json();
      if (!json.error && json.result) return json.result;
    } catch (e) {
      console.error('Private exit via Helius Sender failed:', e);
    }
  }

  const jitoEndpoints = [
    "https://mainnet.block-engine.jito.wtf/api/v1/bundles",
    "https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles",
    "https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/bundles",
    "https://tokyo.mainnet.block-engine.jito.wtf/api/v1/bundles",
    "https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles"
  ];
  const base64Tx = Buffer.from(tx.serialize()).toString('base64');
  const payload = { jsonrpc: "2.0", id: 1, method: "sendBundle", params: [[base64Tx]] };

  try {
    return await Promise.any(
      jitoEndpoints.map(url =>
        fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
          .then(async r => {
            if (r.ok) { const d = await r.json(); if (d.result) return d.result; }
            throw new Error("Failed");
          })
      )
    );
  } catch {
    return null;
  }
};
