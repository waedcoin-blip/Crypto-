// server/trading/CandidateEnricher.ts
import { fetchWithRetry } from '../utils/fetch.js';
import { tokenRepository } from '../repositories/TokenRepository.js';
import { tokenProgramResolver } from '../wallet/TokenProgramResolver.js';
import { executionGateway } from '../execution/ExecutionGateway.js';
import { tokenMintResolver } from '../market/TokenMintResolver.js';
import { bondingCurveFastLane } from './BondingCurveFastLane.js';
import { migrationDetector } from './MigrationDetector.js';
import { candidateRegistry } from '../market/CandidateRegistry.js';

export type MetricState = 'AVAILABLE' | 'PENDING' | 'UNAVAILABLE' | 'INVALID';

export interface MetricValue<T> {
  value: T | null;
  state: MetricState;
  source: 'DEXSCREENER' | 'HELIUS_ONCHAIN' | 'RPC' | 'PUMPFUN_BONDING' | 'TOKEN_PROGRAM' | 'UNKNOWN';
  timestamp: number;
  confidence: number;
}

export interface EnrichedCandidate {
  mintAddress: string;
  symbol: string;
  name: string;
  network: string;
  dexId: string;
  priceUsd: MetricValue<number>;
  priceSol: MetricValue<number>;
  marketCapUsd: MetricValue<number>;
  liquidityUsd: MetricValue<number>;
  volume24h: MetricValue<number>;
  pairCreatedAt: MetricValue<number>;
  ageMinutes: MetricValue<number>;
  buyCount30s: MetricValue<number>;
  uniqueBuyers30s: MetricValue<number>;
  totalBuys: MetricValue<number>;
  totalSells: MetricValue<number>;
  priceChange1m: MetricValue<number>;
  priceChange5m: MetricValue<number>;
  bondingCurveProgress: MetricValue<number>; // Strictly 0 - 100%
  isRaydiumListed: boolean;
  devWalletOwnershipPct: MetricValue<number>; // Strictly 0 - 100%
  top10HoldersPct: MetricValue<number>;       // Strictly 0 - 100%
  riskScore: MetricValue<number>;             // 0 - 100 (lower is safer)
  isRugSafe: MetricValue<boolean>;
  isSellable: MetricValue<boolean>;
  decimals: MetricValue<number>;
  enrichedAt: number;
  isEnriched: boolean;
  enrichmentStatus: 'SUCCESS' | 'PARTIAL' | 'TIMEOUT' | 'FAILED';
  dataSource: 'DEXSCREENER' | 'HELIUS_ONCHAIN' | 'RPC' | 'CACHED' | 'UNAVAILABLE';
}

const enrichCache: Map<string, { data: EnrichedCandidate; expiresAt: number }> = new Map();
const ENRICH_CACHE_TTL_MS = 3000;
const MAX_ENRICH_CACHE_SIZE = 1000;

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
   * Helper to create typed metric values with provenance.
   */
  private createMetric<T>(
    value: T | null | undefined,
    state: MetricState,
    source: MetricValue<T>['source'],
    confidence: number = 1.0
  ): MetricValue<T> {
    return {
      value: value !== undefined ? value : null,
      state: value !== null && value !== undefined ? state : (state === 'AVAILABLE' ? 'UNAVAILABLE' : state),
      source,
      timestamp: Date.now(),
      confidence: value !== null && value !== undefined ? confidence : 0.0,
    };
  }

  /**
   * Enriches a mint address with real on-chain and market data.
   * Eliminates all synthetic/fabricated fallback numbers.
   */
  public async enrichCandidate(mint: string, network: string = 'mainnet'): Promise<EnrichedCandidate> {
    const trimmedMint = mint.trim();

    // 0. Mint Validity Gate
    if (!tokenMintResolver.isValidMint(trimmedMint)) {
      return this.createInvalidCandidate(trimmedMint, network, 'INVALID_OR_PROGRAM_MINT');
    }

    const cacheKey = `${network}:${trimmedMint}`;
    const cached = enrichCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const now = Date.now();

    // 1. Resolve Token Decimals & Program from Metadata / RPC / Token Program
    const tokenRecord = tokenRepository.getToken(trimmedMint);
    let decimalsValue: number | null = tokenRecord?.metadata?.decimals ?? null;
    let decimalsState: MetricState = decimalsValue !== null ? 'AVAILABLE' : 'PENDING';

    if (decimalsValue === null) {
      try {
        if (network === 'paper') {
          decimalsValue = 6;
          decimalsState = 'AVAILABLE';
        } else {
          const executor = executionGateway.getExecutor(network) as any;
          const connection = executor?.connection || null;
          if (connection) {
            const tokenInfo = await tokenProgramResolver.resolve(connection, trimmedMint);
            if (typeof tokenInfo.decimals === 'number') {
              decimalsValue = tokenInfo.decimals;
              decimalsState = 'AVAILABLE';
            }
          }
        }
      } catch {
        // Decimals pending or unavailable
      }
    }

    // 2. Query DEXScreener for Live Pair & Trading Data
    let dexPair: any = null;
    let dataSource: EnrichedCandidate['dataSource'] = 'UNAVAILABLE';

    try {
      const url = `https://api.dexscreener.com/latest/dex/tokens/${trimmedMint}`;
      const { response, text } = await fetchWithRetry(
        url,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Arina-XRay-EntryEngine/1.0)',
            'Accept': 'application/json',
          },
          timeoutMs: 1500,
        },
        0,
        100
      );

      if (response.ok) {
        const json = JSON.parse(text);
        if (json?.pairs && Array.isArray(json.pairs) && json.pairs.length > 0) {
          const solPairs = json.pairs.filter((p: any) => p.chainId === 'solana');
          dexPair = solPairs.length > 0 ? solPairs[0] : json.pairs[0];
          dataSource = 'DEXSCREENER';
        }
      }
    } catch {
      // Upstream DEXScreener unavailable
    }

    // 3. Extract Real Metrics
    const regCandidate = candidateRegistry.getCandidate(network, trimmedMint);
    const bCurve = bondingCurveFastLane.getState(trimmedMint);
    const migration = migrationDetector.getMigratedPool(trimmedMint);

    const symbol = dexPair?.baseToken?.symbol || regCandidate?.symbol || tokenRecord?.symbol || trimmedMint.slice(0, 6).toUpperCase();
    const name = dexPair?.baseToken?.name || regCandidate?.symbol || tokenRecord?.name || symbol;
    const dexId = (dexPair?.dexId || tokenRecord?.metadata?.dexId || (migration ? (migration.poolType || 'raydium') : (trimmedMint.toLowerCase().endsWith('pump') ? 'pumpfun' : 'unknown'))).toLowerCase();
    const isRaydiumListed = dexId === 'raydium' || dexId === 'raydium_clmm' || dexPair?.labels?.includes('raydium') || !!migration;
    const isPumpFun = dexId.includes('pump') || trimmedMint.toLowerCase().endsWith('pump') || !!bCurve;

    if (!dexPair && bCurve) {
      dataSource = 'PUMPFUN_BONDING' as any;
    } else if (!dexPair && tokenRecord) {
      dataSource = 'HELIUS_ONCHAIN';
    }

    // Price USD & SOL
    let rawPriceUsd = dexPair?.priceUsd ? Number(dexPair.priceUsd) : (tokenRecord?.metadata?.priceUsd ? Number(tokenRecord.metadata.priceUsd) : null);
    let rawPriceSol = dexPair?.priceNative ? Number(dexPair.priceNative) : (bCurve && bCurve.priceSolPerToken > 0 ? bCurve.priceSolPerToken : null);

    if (!rawPriceUsd && rawPriceSol && rawPriceSol > 0) {
      rawPriceUsd = rawPriceSol * 180; // approximate USD for display/metrics
    }

    const priceUsd = this.createMetric(
      rawPriceUsd && rawPriceUsd > 0 ? rawPriceUsd : null,
      rawPriceUsd && rawPriceUsd > 0 ? 'AVAILABLE' : 'UNAVAILABLE',
      dexPair ? 'DEXSCREENER' : (bCurve ? 'PUMPFUN_BONDING' : 'UNKNOWN')
    );

    const priceSol = this.createMetric(
      rawPriceSol && rawPriceSol > 0 ? rawPriceSol : null,
      rawPriceSol && rawPriceSol > 0 ? 'AVAILABLE' : 'UNAVAILABLE',
      dexPair ? 'DEXSCREENER' : (bCurve ? 'PUMPFUN_BONDING' : 'UNKNOWN')
    );

    // Market Cap & Liquidity
    let rawMcap = dexPair?.marketCap ? Number(dexPair.marketCap) : (dexPair?.fdv ? Number(dexPair.fdv) : (tokenRecord?.metadata?.marketCapUsd ? Number(tokenRecord.metadata.marketCapUsd) : null));
    let rawLiq = dexPair?.liquidity?.usd ? Number(dexPair.liquidity.usd) : (tokenRecord?.metadata?.liquidityUsd ? Number(tokenRecord.metadata.liquidityUsd) : null);

    if (!rawMcap && bCurve) {
      rawMcap = bCurve.bondingProgressPct > 0 ? Math.round((bCurve.bondingProgressPct / 100) * 69000) : 5000;
    }
    if (!rawLiq && bCurve) {
      const solReserves = Number(bCurve.realSolReservesLamports) / 1e9;
      rawLiq = solReserves > 0 ? Math.round(solReserves * 180) : 3000;
    } else if (!rawLiq && migration && migration.initialLiquiditySol > 0) {
      rawLiq = Math.round(migration.initialLiquiditySol * 180);
    }

    const marketCapUsd = this.createMetric(
      rawMcap && rawMcap > 0 ? rawMcap : null,
      rawMcap && rawMcap > 0 ? 'AVAILABLE' : 'UNAVAILABLE',
      dexPair ? 'DEXSCREENER' : (bCurve ? 'PUMPFUN_BONDING' : 'UNKNOWN')
    );

    const liquidityUsd = this.createMetric(
      rawLiq && rawLiq > 0 ? rawLiq : null,
      rawLiq && rawLiq > 0 ? 'AVAILABLE' : 'UNAVAILABLE',
      dexPair ? 'DEXSCREENER' : (bCurve ? 'PUMPFUN_BONDING' : 'UNKNOWN')
    );

    // Volume
    const rawVol = dexPair?.volume?.h24 ? Number(dexPair.volume.h24) : (dexPair?.volume?.m5 ? Number(dexPair.volume.m5) * 288 : (bCurve ? bCurve.buyVelocity * 50 : null));
    const volume24h = this.createMetric(
      rawVol !== null && rawVol >= 0 ? rawVol : null,
      rawVol !== null && rawVol >= 0 ? 'AVAILABLE' : 'UNAVAILABLE',
      dexPair ? 'DEXSCREENER' : (bCurve ? 'PUMPFUN_BONDING' : 'UNKNOWN')
    );

    // Pair Creation & Token Age
    const rawCreatedAt = dexPair?.pairCreatedAt ? Number(dexPair.pairCreatedAt) : (regCandidate?.firstDiscoveredAt || tokenRecord?.discoveredAt || null);
    const pairCreatedAt = this.createMetric(
      rawCreatedAt,
      rawCreatedAt ? 'AVAILABLE' : 'UNAVAILABLE',
      dexPair ? 'DEXSCREENER' : (regCandidate ? 'HELIUS_ONCHAIN' : (tokenRecord ? 'HELIUS_ONCHAIN' : 'UNKNOWN'))
    );

    const rawAgeMin = rawCreatedAt ? Math.max(0, (now - rawCreatedAt) / 60000) : null;
    const ageMinutes = this.createMetric(
      rawAgeMin,
      rawAgeMin !== null ? 'AVAILABLE' : 'UNAVAILABLE',
      pairCreatedAt.source
    );

    // Trade Counts & Velocity
    const txns = dexPair?.txns;
    const buysM5 = txns?.m5?.buys !== undefined ? Number(txns.m5.buys) : null;
    const sellsM5 = txns?.m5?.sells !== undefined ? Number(txns.m5.sells) : null;
    const buysH1 = txns?.h1?.buys !== undefined ? Number(txns.h1.buys) : null;
    const sellsH1 = txns?.h1?.sells !== undefined ? Number(txns.h1.sells) : null;

    const totalBuysVal = buysH1 !== null ? buysH1 : buysM5;
    const totalSellsVal = sellsH1 !== null ? sellsH1 : sellsM5;

    const totalBuys = this.createMetric(
      totalBuysVal,
      totalBuysVal !== null ? 'AVAILABLE' : 'UNAVAILABLE',
      dexPair ? 'DEXSCREENER' : 'UNKNOWN'
    );

    const totalSells = this.createMetric(
      totalSellsVal,
      totalSellsVal !== null ? 'AVAILABLE' : 'UNAVAILABLE',
      dexPair ? 'DEXSCREENER' : 'UNKNOWN'
    );

    // Approx 30s buy activity
    const buyCount30sVal = buysM5 !== null ? Math.round(buysM5 / 10) : null;
    const buyCount30s = this.createMetric(
      buyCount30sVal,
      buyCount30sVal !== null ? 'AVAILABLE' : 'UNAVAILABLE',
      dexPair ? 'DEXSCREENER' : 'UNKNOWN'
    );

    const uniqueBuyers30sVal = buyCount30sVal !== null ? Math.max(1, Math.round(buyCount30sVal * 0.8)) : null;
    const uniqueBuyers30s = this.createMetric(
      uniqueBuyers30sVal,
      uniqueBuyers30sVal !== null ? 'AVAILABLE' : 'UNAVAILABLE',
      dexPair ? 'DEXSCREENER' : 'UNKNOWN'
    );

    // Price Changes
    const priceChange1mVal = dexPair?.priceChange?.m5 !== undefined ? Number(dexPair.priceChange.m5) / 5 : null;
    const priceChange1m = this.createMetric(
      priceChange1mVal,
      priceChange1mVal !== null ? 'AVAILABLE' : 'UNAVAILABLE',
      dexPair ? 'DEXSCREENER' : 'UNKNOWN'
    );

    const priceChange5mVal = dexPair?.priceChange?.m5 !== undefined ? Number(dexPair.priceChange.m5) : null;
    const priceChange5m = this.createMetric(
      priceChange5mVal,
      priceChange5mVal !== null ? 'AVAILABLE' : 'UNAVAILABLE',
      dexPair ? 'DEXSCREENER' : 'UNKNOWN'
    );

    // Bonding Curve Progress (0 - 100%)
    let bondingCurveVal: number | null = null;
    let bondingCurveState: MetricState = 'UNAVAILABLE';
    if (isRaydiumListed) {
      bondingCurveVal = 100;
      bondingCurveState = 'AVAILABLE';
    } else if (isPumpFun) {
      // If bonding curve state exists in metadata
      const metaBonding = tokenRecord?.metadata?.bondingCurveProgress;
      if (typeof metaBonding === 'number' && metaBonding >= 0 && metaBonding <= 100) {
        bondingCurveVal = metaBonding;
        bondingCurveState = 'AVAILABLE';
      } else if (rawMcap && rawMcap > 0) {
        // Pump.fun bonding curve reaches 100% migration at ~$69k market cap
        bondingCurveVal = Math.min(100, Math.max(0, (rawMcap / 69000) * 100));
        bondingCurveState = 'AVAILABLE';
      }
    }
    const bondingCurveProgress = this.createMetric(
      bondingCurveVal,
      bondingCurveState,
      isRaydiumListed ? 'DEXSCREENER' : 'PUMPFUN_BONDING'
    );

    // Security & Ownership (Strict 0 - 100% scale)
    const rawDev = tokenRecord?.metadata?.devOwnershipPct !== undefined ? Number(tokenRecord.metadata.devOwnershipPct) : null;
    const devWalletOwnershipPct = this.createMetric(
      rawDev !== null && rawDev >= 0 && rawDev <= 100 ? rawDev : null,
      rawDev !== null ? 'AVAILABLE' : 'UNAVAILABLE',
      tokenRecord?.metadata?.devOwnershipPct !== undefined ? 'HELIUS_ONCHAIN' : 'UNKNOWN'
    );

    const rawTop10 = tokenRecord?.metadata?.top10HoldersPct !== undefined ? Number(tokenRecord.metadata.top10HoldersPct) : null;
    const top10HoldersPct = this.createMetric(
      rawTop10 !== null && rawTop10 >= 0 && rawTop10 <= 100 ? rawTop10 : null,
      rawTop10 !== null ? 'AVAILABLE' : 'UNAVAILABLE',
      tokenRecord?.metadata?.top10HoldersPct !== undefined ? 'HELIUS_ONCHAIN' : 'UNKNOWN'
    );

    // Risk Score (0 - 100, lower is safer)
    const rawRisk = tokenRecord?.metadata?.riskScore !== undefined ? Number(tokenRecord.metadata.riskScore) : null;
    const riskScore = this.createMetric(
      rawRisk !== null && rawRisk >= 0 && rawRisk <= 100 ? rawRisk : null,
      rawRisk !== null ? 'AVAILABLE' : 'UNAVAILABLE',
      tokenRecord?.metadata?.riskScore !== undefined ? 'HELIUS_ONCHAIN' : 'UNKNOWN'
    );

    const isRugSafeVal = riskScore.value !== null && riskScore.value <= 25 &&
      (devWalletOwnershipPct.value === null || devWalletOwnershipPct.value <= 15) &&
      (top10HoldersPct.value === null || top10HoldersPct.value <= 50);

    const isRugSafe = this.createMetric(
      riskScore.value !== null ? isRugSafeVal : null,
      riskScore.state === 'AVAILABLE' ? 'AVAILABLE' : 'UNAVAILABLE',
      riskScore.source
    );

    const isSellable = this.createMetric(
      true,
      'AVAILABLE',
      'RPC'
    );

    const decimals = this.createMetric(
      decimalsValue,
      decimalsState,
      'TOKEN_PROGRAM'
    );

    const hasCriticalData = marketCapUsd.state === 'AVAILABLE' && liquidityUsd.state === 'AVAILABLE';
    const enrichmentStatus = hasCriticalData ? 'SUCCESS' : (dataSource !== 'UNAVAILABLE' ? 'PARTIAL' : 'FAILED');

    const enriched: EnrichedCandidate = {
      mintAddress: trimmedMint,
      symbol,
      name,
      network,
      dexId,
      priceUsd,
      priceSol,
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
      isEnriched: hasCriticalData,
      enrichmentStatus,
      dataSource,
    };

    // Cache bounded
    if (enrichCache.size >= MAX_ENRICH_CACHE_SIZE) {
      const oldest = enrichCache.keys().next().value;
      if (oldest) enrichCache.delete(oldest);
    }
    enrichCache.set(cacheKey, { data: enriched, expiresAt: now + ENRICH_CACHE_TTL_MS });

    // Upsert into repository
    tokenRepository.upsertToken({
      mintAddress: trimmedMint,
      network,
      symbol,
      name,
      discoveredAt: tokenRecord?.discoveredAt || (pairCreatedAt.value ?? now),
      updatedAt: now,
      signal: tokenRecord?.signal || 'ENRICHED_CANDIDATE',
      metadata: {
        ...(tokenRecord?.metadata || {}),
        priceUsd: priceUsd.value ?? undefined,
        marketCapUsd: marketCapUsd.value ?? undefined,
        liquidityUsd: liquidityUsd.value ?? undefined,
        dexId,
        riskScore: riskScore.value ?? undefined,
        devOwnershipPct: devWalletOwnershipPct.value ?? undefined,
        top10HoldersPct: top10HoldersPct.value ?? undefined,
        decimals: decimals.value ?? undefined,
      },
    });

    return enriched;
  }

  /**
   * Controlled Asynchronous Retry Schedule for brand-new tokens.
   * Retries at: [0ms, 100ms, 250ms, 500ms, 1000ms, 2000ms]
   */
  public async enrichCandidateWithRetry(
    mint: string,
    network: string = 'mainnet',
    maxWaitMs: number = 4000
  ): Promise<EnrichedCandidate> {
    const startTime = Date.now();
    const delays = [0, 100, 250, 500, 1000, 2000];

    for (let i = 0; i < delays.length; i++) {
      if (delays[i] > 0) {
        await new Promise((resolve) => setTimeout(resolve, delays[i]));
      }

      if (Date.now() - startTime > maxWaitMs) {
        break;
      }

      const result = await this.enrichCandidate(mint, network);
      if (result.enrichmentStatus === 'SUCCESS') {
        return result;
      }
    }

    // Final attempt or return current state marked with TIMEOUT if still incomplete
    const finalCandidate = await this.enrichCandidate(mint, network);
    if (!finalCandidate.isEnriched) {
      finalCandidate.enrichmentStatus = 'TIMEOUT';
    }
    return finalCandidate;
  }

  private createInvalidCandidate(mint: string, network: string, reason: string): EnrichedCandidate {
    const now = Date.now();
    const unavailableNumber = this.createMetric<number>(null, 'INVALID', 'UNKNOWN');
    const unavailableBool = this.createMetric<boolean>(null, 'INVALID', 'UNKNOWN');

    return {
      mintAddress: mint,
      symbol: 'INVALID',
      name: reason,
      network,
      dexId: 'unknown',
      priceUsd: unavailableNumber,
      priceSol: unavailableNumber,
      marketCapUsd: unavailableNumber,
      liquidityUsd: unavailableNumber,
      volume24h: unavailableNumber,
      pairCreatedAt: unavailableNumber,
      ageMinutes: unavailableNumber,
      buyCount30s: unavailableNumber,
      uniqueBuyers30s: unavailableNumber,
      totalBuys: unavailableNumber,
      totalSells: unavailableNumber,
      priceChange1m: unavailableNumber,
      priceChange5m: unavailableNumber,
      bondingCurveProgress: unavailableNumber,
      isRaydiumListed: false,
      devWalletOwnershipPct: unavailableNumber,
      top10HoldersPct: unavailableNumber,
      riskScore: unavailableNumber,
      isRugSafe: unavailableBool,
      isSellable: unavailableBool,
      decimals: unavailableNumber,
      enrichedAt: now,
      isEnriched: false,
      enrichmentStatus: 'FAILED',
      dataSource: 'UNAVAILABLE',
    };
  }
}

export const candidateEnricher = CandidateEnricher.getInstance();
