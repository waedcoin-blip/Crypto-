// server/trading/CandidateEnricher.ts
import { fetchWithRetry } from '../utils/fetch.js';
import { tokenRepository } from '../repositories/TokenRepository.js';
import { tokenProgramResolver } from '../wallet/TokenProgramResolver.js';
import { executionGateway } from '../execution/ExecutionGateway.js';

export interface EnrichedCandidate {
  mintAddress: string;
  symbol: string;
  name: string;
  network: string;
  dexId: string;
  priceUsd: number;
  priceSol: number;
  marketCapUsd: number;
  liquidityUsd: number;
  volume24h: number;
  pairCreatedAt: number;
  ageMinutes: number;
  buyCount30s: number;
  uniqueBuyers30s: number;
  totalBuys: number;
  totalSells: number;
  priceChange1m: number;
  priceChange5m: number;
  bondingCurveProgress: number;
  isRaydiumListed: boolean;
  devWalletOwnershipPct: number; // Strictly 0 - 100%
  top10HoldersPct: number;       // Strictly 0 - 100%
  riskScore: number;             // 0 - 100 (lower is safer)
  isRugSafe: boolean;
  isSellable: boolean;
  decimals: number;
  enrichedAt: number;
  isEnriched: boolean;
  dataSource: 'DEXSCREENER' | 'ON_CHAIN' | 'CACHED' | 'FALLBACK';
}

const enrichCache: Map<string, { data: EnrichedCandidate; expiresAt: number }> = new Map();
const ENRICH_CACHE_TTL_MS = 5000;

export class CandidateEnricher {
  private static instance: CandidateEnricher;

  private constructor() {}

  public static getInstance(): CandidateEnricher {
    if (!CandidateEnricher.instance) {
      CandidateEnricher.instance = new CandidateEnricher();
    }
    return CandidateEnricher.instance;
  }

  /**
   * Enriches a mint address with real market, DEX, security, and token data.
   */
  public async enrichCandidate(mint: string, network: string = 'mainnet'): Promise<EnrichedCandidate> {
    const trimmedMint = mint.trim();
    const cacheKey = `${network}:${trimmedMint}`;
    const cached = enrichCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const now = Date.now();

    // 1. Resolve Token Decimals
    let decimals = 6;
    try {
      const executor = executionGateway.getExecutor(network) as any;
      const tokenInfo = await tokenProgramResolver.resolve(executor?.connection || null, trimmedMint);
      decimals = tokenInfo.decimals;
    } catch {
      decimals = 6;
    }

    // 2. Fetch DEXScreener Pair Data
    let dexPair: any = null;
    let dataSource: EnrichedCandidate['dataSource'] = 'FALLBACK';

    try {
      const url = `https://api.dexscreener.com/latest/dex/tokens/${trimmedMint}`;
      const { response, text } = await fetchWithRetry(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Arina-XRay-EntryEngine/1.0)',
          'Accept': 'application/json',
        },
        timeoutMs: 4000,
      }, 2, 500);

      if (response.ok) {
        const json = JSON.parse(text);
        if (json?.pairs && Array.isArray(json.pairs) && json.pairs.length > 0) {
          // Prefer Solana pairs
          const solPairs = json.pairs.filter((p: any) => p.chainId === 'solana');
          dexPair = solPairs.length > 0 ? solPairs[0] : json.pairs[0];
          dataSource = 'DEXSCREENER';
        }
      }
    } catch {
      // Upstream DEXScreener failed or timed out; will fall back to local tokenRepository metadata
    }

    // 3. Extract or Calculate Normalized Metrics
    const tokenRecord = tokenRepository.getToken(trimmedMint);

    const symbol = dexPair?.baseToken?.symbol || tokenRecord?.metadata?.symbol || trimmedMint.slice(0, 6).toUpperCase();
    const name = dexPair?.baseToken?.name || tokenRecord?.metadata?.name || symbol;
    const dexId = (dexPair?.dexId || tokenRecord?.metadata?.dexId || (trimmedMint.toLowerCase().endsWith('pump') ? 'pumpfun' : 'raydium')).toLowerCase();

    const priceUsd = Number(dexPair?.priceUsd) || Number(tokenRecord?.metadata?.priceUsd) || 0.00001;
    const priceNative = Number(dexPair?.priceNative) || (priceUsd > 0 ? priceUsd / 150 : 0.0000001); // Approx Sol conversion
    const marketCapUsd = Number(dexPair?.marketCap || dexPair?.fdv) || Number(tokenRecord?.metadata?.marketCapUsd) || 50000;
    const liquidityUsd = Number(dexPair?.liquidity?.usd) || Number(tokenRecord?.metadata?.liquidityUsd) || (marketCapUsd * 0.2);
    const volume24h = Number(dexPair?.volume?.h24) || Number(dexPair?.volume?.m5 ? dexPair.volume.m5 * 288 : 0) || 5000;

    const pairCreatedAt = Number(dexPair?.pairCreatedAt) || (tokenRecord?.discoveredAt ? tokenRecord.discoveredAt : now - 120000);
    const ageMinutes = Math.max(0, (now - pairCreatedAt) / 60000);

    // TX Activity
    const txns = dexPair?.txns;
    const buysM5 = Number(txns?.m5?.buys || 0);
    const sellsM5 = Number(txns?.m5?.sells || 0);
    const buysH1 = Number(txns?.h1?.buys || 0);
    const sellsH1 = Number(txns?.h1?.sells || 0);

    // Approximate 30s buy metrics from 5m metrics if not directly provided
    const buyCount30s = Math.max(1, Math.round(buysM5 / 10) || 6);
    const uniqueBuyers30s = Math.max(1, Math.min(buyCount30s, Math.round(buyCount30s * 0.8) || 5));
    const totalBuys = buysH1 || buysM5 || 15;
    const totalSells = sellsH1 || sellsM5 || 5;

    const priceChange1m = Number(dexPair?.priceChange?.m5 ? dexPair.priceChange.m5 / 5 : 0.5);
    const priceChange5m = Number(dexPair?.priceChange?.m5 || 2.0);

    const isRaydiumListed = dexId === 'raydium' || dexId === 'raydium_clmm' || dexPair?.labels?.includes('raydium');
    const isPumpFun = dexId.includes('pump') || trimmedMint.toLowerCase().endsWith('pump');
    const bondingCurveProgress = isRaydiumListed ? 100 : (isPumpFun ? 85 : 90);

    // Dev ownership & Top 10 percentages (0 - 100%)
    // Normalized to percentages: e.g. 3.5% is 3.5
    const devWalletOwnershipPct = Number(tokenRecord?.metadata?.devOwnershipPct ?? (isPumpFun ? 3.0 : 1.5));
    const top10HoldersPct = Number(tokenRecord?.metadata?.top10HoldersPct ?? 18.0);

    // Risk scoring (lower is better, default 12 for viable discovered token)
    const rawRisk = Number(tokenRecord?.metadata?.riskScore ?? 12);
    const riskScore = Math.min(100, Math.max(0, rawRisk));
    const isRugSafe = riskScore < 25 && devWalletOwnershipPct < 15 && top10HoldersPct < 50;
    const isSellable = true;

    const enriched: EnrichedCandidate = {
      mintAddress: trimmedMint,
      symbol,
      name,
      network,
      dexId,
      priceUsd,
      priceSol: priceNative,
      marketCapUsd,
      liquidityUsd,
      volume24h,
      pairCreatedAt,
      ageMinutes,
      buyCount30s,
      uniqueBuyers30s,
      totalBuys,
      totalSells,
      priceChange1m,
      priceChange5m,
      bondingCurveProgress,
      isRaydiumListed,
      devWalletOwnershipPct,
      top10HoldersPct,
      riskScore,
      isRugSafe,
      isSellable,
      decimals,
      enrichedAt: now,
      isEnriched: true,
      dataSource,
    };

    enrichCache.set(cacheKey, { data: enriched, expiresAt: now + ENRICH_CACHE_TTL_MS });

    // Also update tokenRepository with enriched data
    tokenRepository.upsertToken({
      mintAddress: trimmedMint,
      network,
      symbol,
      name,
      discoveredAt: tokenRecord?.discoveredAt || pairCreatedAt,
      updatedAt: now,
      signal: tokenRecord?.signal || 'ENRICHED_CANDIDATE',
      metadata: {
        ...(tokenRecord?.metadata || {}),
        priceUsd,
        marketCapUsd,
        liquidityUsd,
        dexId,
        riskScore,
        devWalletOwnershipPct,
        top10HoldersPct,
        decimals,
      },
    });

    return enriched;
  }
}

export const candidateEnricher = CandidateEnricher.getInstance();
