// server/trading/CandidateEnricher.ts
import { fetchWithRetry } from '../utils/fetch.js';
import { tokenRepository } from '../repositories/TokenRepository.js';
import { tokenProgramResolver } from '../wallet/TokenProgramResolver.js';
import { executionGateway } from '../execution/ExecutionGateway.js';
import { tokenMintResolver } from '../market/TokenMintResolver.js';
import { bondingCurveFastLane } from './BondingCurveFastLane.js';
import { migrationDetector } from './MigrationDetector.js';
import { candidateRegistry } from '../market/CandidateRegistry.js';
import { SwrCache } from '../cache/SwrCache.js';

export type MetricState = 'AVAILABLE' | 'UNAVAILABLE' | 'PENDING' | 'OVERRIDDEN' | 'FAILED';

export interface MetricValue<T> {
  value: T | null;
  state: MetricState;
  source: string;
  updatedAt: number;
  overrideReason?: string;
}

export interface EnrichedCandidate {
  mintAddress: string;
  symbol: string;
  name: string;
  network: string;
  dexId: string;
  decimals: MetricValue<number>;
  priceUsd: MetricValue<number>;
  priceSol: MetricValue<number>;
  marketCapUsd: MetricValue<number>;
  liquidityUsd: MetricValue<number>;
  volume24h: MetricValue<number>;
  priceChange1m: MetricValue<number>;
  priceChange5m: MetricValue<number>;
  priceChange1h: MetricValue<number>;
  uniqueBuyers30s: MetricValue<number>;
  buyCount30s: MetricValue<number>;
  totalBuys: MetricValue<number>;
  totalSells: MetricValue<number>;
  ageMinutes: MetricValue<number>;
  riskScore: MetricValue<number>;
  devWalletOwnershipPct: MetricValue<number>;
  top10HoldersPct: MetricValue<number>;
  isRugSafe: MetricValue<boolean>;
  isSellable: MetricValue<boolean>;
  isEnriched: boolean;
  enrichmentStatus: 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'INVALID_MINT';
  dataSource: 'DEXSCREENER' | 'PUMPFUN_BONDING' | 'HELIUS' | 'JUPITER' | 'UNAVAILABLE';
  enrichedAt: number;
  failureReason?: string;
}

const PUMP_FUN_GRADUATION_MCAP_USD = 69000;
const SOL_PRICE_USD_FALLBACK = 150;

const enrichCache = new SwrCache<EnrichedCandidate>({
  name: 'candidate-enricher',
  softTtl: 3000,   // Revalidate after 3s
  hardTtl: 15000,  // Evict after 15s
  maxSize: 1000,
});

export class CandidateEnricher {
  private static instance: CandidateEnricher;

  private constructor() {}

  public static getInstance(): CandidateEnricher {
    if (!CandidateEnricher.instance) {
      CandidateEnricher.instance = new CandidateEnricher();
    }
    return CandidateEnricher.instance;
  }

  public createMetric<T>(
    value: T | null,
    state: MetricState = value !== null ? 'AVAILABLE' : 'UNAVAILABLE',
    source: string = 'UNKNOWN'
  ): MetricValue<T> {
    return {
      value,
      state,
      source,
      updatedAt: Date.now(),
    };
  }

  public createInvalidCandidate(
    mint: string,
    network: string,
    reason: string
  ): EnrichedCandidate {
    const unavailableMetric = <T>(val: T | null = null) =>
      this.createMetric(val, 'UNAVAILABLE', 'INVALID_GATE');

    return {
      mintAddress: mint,
      symbol: 'INVALID',
      name: 'Invalid Token Mint',
      network,
      dexId: 'unknown',
      decimals: unavailableMetric<number>(null),
      priceUsd: unavailableMetric<number>(null),
      priceSol: unavailableMetric<number>(null),
      marketCapUsd: unavailableMetric<number>(null),
      liquidityUsd: unavailableMetric<number>(null),
      volume24h: unavailableMetric<number>(null),
      priceChange1m: unavailableMetric<number>(null),
      priceChange5m: unavailableMetric<number>(null),
      priceChange1h: unavailableMetric<number>(null),
      uniqueBuyers30s: unavailableMetric<number>(null),
      buyCount30s: unavailableMetric<number>(null),
      totalBuys: unavailableMetric<number>(null),
      totalSells: unavailableMetric<number>(null),
      ageMinutes: unavailableMetric<number>(null),
      riskScore: unavailableMetric<number>(null),
      devWalletOwnershipPct: unavailableMetric<number>(null),
      top10HoldersPct: unavailableMetric<number>(null),
      isRugSafe: unavailableMetric<boolean>(false),
      isSellable: unavailableMetric<boolean>(false),
      isEnriched: false,
      enrichmentStatus: 'INVALID_MINT',
      dataSource: 'UNAVAILABLE',
      enrichedAt: Date.now(),
      failureReason: reason,
    };
  }

  public async enrichCandidate(mint: string, network: string = 'mainnet'): Promise<EnrichedCandidate> {
    const trimmedMint = mint.trim();
    const cacheKey = `${network}:${trimmedMint}`;

    return enrichCache.fetch(cacheKey, async () => {
      return this.executeEnrichment(trimmedMint, network);
    });
  }

  public async enrichCandidateWithRetry(mint: string, network: string = 'mainnet'): Promise<EnrichedCandidate> {
    return this.enrichCandidate(mint, network);
  }

  private async executeEnrichment(trimmedMint: string, network: string): Promise<EnrichedCandidate> {
    const executor = executionGateway.getExecutor(network) as any;
    const connection = executor?.connection || null;
    const mintValidation = await tokenMintResolver.validateTokenMint(trimmedMint, connection);
    if (!mintValidation.ok) {
      if (mintValidation.code === 'INVALID_MINT') {
        return this.createInvalidCandidate(trimmedMint, network, mintValidation.reason);
      }
    }

    const now = Date.now();

    // 1. Decimals resolution
    let decimalsValue: number | null = (mintValidation as any).decimals ?? null;
    let decimalsState: MetricState = decimalsValue !== null ? 'AVAILABLE' : 'PENDING';

    // 2. Query DEXScreener
    let dexPair: any = null;
    let dataSource: EnrichedCandidate['dataSource'] = 'UNAVAILABLE';
    try {
      const url = `https://api.dexscreener.com/latest/dex/tokens/${trimmedMint}`;
      const { response, text } = await fetchWithRetry(url, { timeoutMs: 1500 }, 2, 100);
      if (response.ok) {
        const json = JSON.parse(text);
        if (json?.pairs?.length > 0) {
          dexPair = json.pairs.find((p: any) => p.chainId === 'solana') || json.pairs[0];
          dataSource = 'DEXSCREENER';
        }
      }
    } catch {}

    const regCandidate = candidateRegistry.getCandidate(network, trimmedMint);
    const bCurve = bondingCurveFastLane.getState(trimmedMint);
    const migration = migrationDetector.getMigratedPool(trimmedMint);
    
    const symbol = dexPair?.baseToken?.symbol || regCandidate?.symbol || trimmedMint.slice(0, 6).toUpperCase();
    const name = dexPair?.baseToken?.name || symbol;
    const dexId = (dexPair?.dexId || (migration ? migration.poolType : 'unknown')).toLowerCase();
    const isPumpFun = dexId.includes('pump') || !!bCurve;

    if (!dexPair && bCurve) dataSource = 'PUMPFUN_BONDING';

    // Price Extraction
    let rawPriceSol = dexPair?.priceNative ? Number(dexPair.priceNative) : (bCurve?.priceSolPerToken || null);
    let rawPriceUsd = dexPair?.priceUsd ? Number(dexPair.priceUsd) : (rawPriceSol ? rawPriceSol * SOL_PRICE_USD_FALLBACK : null);

    // Market Cap & Liquidity
    let rawMcap = dexPair?.fdv ? Number(dexPair.fdv) : null;
    let rawLiq = dexPair?.liquidity?.usd ? Number(dexPair.liquidity.usd) : null;

    if (!rawMcap && bCurve) {
      rawMcap = bCurve.bondingProgressPct > 0 ? Math.round((bCurve.bondingProgressPct / 100) * PUMP_FUN_GRADUATION_MCAP_USD) : 5000;
    }
    if (!rawLiq && bCurve) {
      const solReserves = Number(bCurve.realSolReservesLamports) / 1e9;
      rawLiq = solReserves > 0 ? Math.round(solReserves * SOL_PRICE_USD_FALLBACK) : 3000;
    }

    const volume24hVal = dexPair?.volume?.h24 ? Number(dexPair.volume.h24) : null;
    const pc1m = bCurve?.buyVelocity ? bCurve.buyVelocity * 0.5 : null;
    const pc5m = dexPair?.priceChange?.m5 ? Number(dexPair.priceChange.m5) : null;
    const pc1h = dexPair?.priceChange?.h1 ? Number(dexPair.priceChange.h1) : null;

    const uBuyers = bCurve?.uniqueBuyerVelocity ?? null;
    const bCount = bCurve?.buyVelocity ?? dexPair?.txns?.h24?.buys ?? null;
    const totalBuys = dexPair?.txns?.h24?.buys ?? (bCurve ? bCurve.buyVelocity : null);
    const totalSells = dexPair?.txns?.h24?.sells ?? (bCurve ? bCurve.sellVelocity : null);

    const pairCreatedAt = dexPair?.pairCreatedAt ? Number(dexPair.pairCreatedAt) : (bCurve?.createdAt || null);
    const ageMinutes = pairCreatedAt ? Math.max(0, (now - pairCreatedAt) / 60000) : null;

    const hasCriticalData = rawMcap !== null || rawLiq !== null || isPumpFun;

    const createMet = <T>(val: T | null, src = dataSource) => this.createMetric(val, val !== null ? 'AVAILABLE' : 'UNAVAILABLE', src);

    const enriched: EnrichedCandidate = {
      mintAddress: trimmedMint,
      symbol,
      name,
      network,
      dexId,
      decimals: this.createMetric(decimalsValue, decimalsState, 'ON_CHAIN'),
      priceUsd: createMet(rawPriceUsd),
      priceSol: createMet(rawPriceSol),
      marketCapUsd: createMet(rawMcap),
      liquidityUsd: createMet(rawLiq),
      volume24h: createMet(volume24hVal),
      priceChange1m: createMet(pc1m),
      priceChange5m: createMet(pc5m),
      priceChange1h: createMet(pc1h),
      uniqueBuyers30s: createMet(uBuyers),
      buyCount30s: createMet(bCount),
      totalBuys: createMet(totalBuys),
      totalSells: createMet(totalSells),
      ageMinutes: createMet(ageMinutes),
      riskScore: createMet(null),
      devWalletOwnershipPct: createMet(null),
      top10HoldersPct: createMet(null),
      isRugSafe: createMet(true),
      isSellable: createMet(true),
      isEnriched: hasCriticalData,
      enrichmentStatus: hasCriticalData ? 'SUCCESS' : 'PARTIAL',
      dataSource,
      enrichedAt: now,
    };

    return enriched;
  }
}

export const candidateEnricher = CandidateEnricher.getInstance();
