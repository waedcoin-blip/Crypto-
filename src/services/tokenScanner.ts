import { TokenCriteria, DEFAULT_CRITERIA } from '../config/tokenCriteria';

export interface ScannedToken {
  address: string;
  symbol: string;
  name: string;
  priceUsd: number;
  priceNative?: number;
  priceChange5m: number;
  priceChange1h: number;
  priceChange6h?: number;
  priceChange24h: number;
  volume5m?: number;
  volume1h?: number;
  volume6h?: number;
  volume24h: number;
  liquidityUsd: number;
  fdv: number;
  marketCap: number;
  pairCreatedAt: number;
  ageMinutes?: number;
  dexId: string;
  pairAddress: string;
  url: string;
  txns?: {
    m5?: { buys: number; sells: number };
    h1?: { buys: number; sells: number };
    h6?: { buys: number; sells: number };
    h24?: { buys: number; sells: number };
  };
  rawPair?: any;
}

export interface TokenSecurityResult {
  token: ScannedToken;
  meetsCriteria: boolean;
  rejectionReason?: string;
}

/**
 * Fetches trending/new tokens from DEXScreener and filters them
 * against the configured criteria.
 */
export class TokenScanner {
  private criteria: TokenCriteria;
  private scannedCache: Map<string, number> = new Map(); // address → last scan time
  private onTokenFound?: (token: ScannedToken) => void;

  constructor(
    criteria: TokenCriteria = DEFAULT_CRITERIA,
    onTokenFound?: (token: ScannedToken) => void
  ) {
    this.criteria = criteria;
    this.onTokenFound = onTokenFound;
  }

  getCriteria() { return this.criteria; }
  updateCriteria(criteria: Partial<TokenCriteria>) {
    this.criteria = { ...this.criteria, ...criteria };
  }

  /**
   * Fetch latest token pairs from DEXScreener.
   * Returns only Solana tokens that meet criteria.
   */
  async scanForNewTokens(): Promise<ScannedToken[]> {
    try {
      // Use server-side proxy for DEXScreener
      const response = await fetch('/api/dex/tokens/trending');

      if (!response.ok) {
        console.warn(`[Scanner] DEXScreener returned ${response.status}`);
        return [];
      }

      const data = await response.json();
      const pairs = data.pairs || data;

      if (!Array.isArray(pairs)) return [];

      const candidates: ScannedToken[] = [];

      for (const pair of pairs) {
        // Only Solana
        if (pair.chainId !== 'solana') continue;

        const address = pair.baseToken?.address;
        if (!address) continue;

        // Skip already-scanned tokens (within 5s to allow live updates)
        const lastScan = this.scannedCache.get(address) || 0;
        if (Date.now() - lastScan < 5_000) continue;

        // Skip excluded mints
        if (this.criteria.excludedMints.has(address)) continue;

        const priceUsd = parseFloat(pair.priceUsd || '0');
        const priceNative = parseFloat(pair.priceNative || '0');
        const pairCreatedAt = pair.pairCreatedAt || 0;
        const ageMinutes = pairCreatedAt > 0 ? Math.max(0, Math.floor((Date.now() - pairCreatedAt) / 60000)) : 0;

        const token: ScannedToken = {
          address,
          symbol: pair.baseToken?.symbol || 'UNKNOWN',
          name: pair.baseToken?.name || `${pair.baseToken?.symbol || 'Solana'} Token`,
          priceUsd,
          priceNative: priceNative > 0 ? priceNative : (priceUsd / 150),
          priceChange5m: parseFloat(pair.priceChange?.m5 || '0'),
          priceChange1h: parseFloat(pair.priceChange?.h1 || '0'),
          priceChange6h: parseFloat(pair.priceChange?.h6 || '0'),
          priceChange24h: parseFloat(pair.priceChange?.h24 || '0'),
          volume5m: parseFloat(pair.volume?.m5 || '0'),
          volume1h: parseFloat(pair.volume?.h1 || '0'),
          volume6h: parseFloat(pair.volume?.h6 || '0'),
          volume24h: parseFloat(pair.volume?.h24 || '0'),
          liquidityUsd: parseFloat(pair.liquidity?.usd || '0'),
          fdv: parseFloat(pair.fdv || '0'),
          marketCap: parseFloat(pair.marketCap || pair.fdv || '0'),
          pairCreatedAt,
          ageMinutes,
          dexId: pair.dexId || 'unknown',
          pairAddress: pair.pairAddress || address,
          url: pair.url || `https://dexscreener.com/solana/${pair.pairAddress || address}`,
          txns: pair.txns || undefined,
          rawPair: pair,
        };

        candidates.push(token);
        this.scannedCache.set(address, Date.now());
      }

      return candidates;

    } catch (err) {
      console.error('[Scanner] Scan failed:', err);
      return [];
    }
  }

  /**
   * Check if a single token meets all criteria.
   */
  evaluateToken(token: ScannedToken): TokenSecurityResult {
    // Price must be valid
    if (token.priceUsd <= 0) {
      return { token, meetsCriteria: false, rejectionReason: 'Zero price' };
    }

    // Liquidity
    if (token.liquidityUsd < this.criteria.minLiquidityUsd) {
      return {
        token,
        meetsCriteria: false,
        rejectionReason: `Low liquidity: $${token.liquidityUsd.toFixed(0)} < $${this.criteria.minLiquidityUsd}`,
      };
    }

    // Volume
    if (token.volume24h < this.criteria.minVolume24hUsd) {
      return {
        token,
        meetsCriteria: false,
        rejectionReason: `Low volume: $${token.volume24h.toFixed(0)} < $${this.criteria.minVolume24hUsd}`,
      };
    }

    // Token age
    if (token.pairCreatedAt > 0) {
      const age = Date.now() - token.pairCreatedAt;
      if (age > this.criteria.maxTokenAgeMs) {
        return {
          token,
          meetsCriteria: false,
          rejectionReason: `Too old: ${(age / 3600000).toFixed(1)}h > ${(this.criteria.maxTokenAgeMs / 3600000)}h`,
        };
      }
    }

    // Momentum (price change 5m)
    if (token.priceChange5m < this.criteria.minPriceChange5m) {
      return {
        token,
        meetsCriteria: false,
        rejectionReason: `No momentum: 5m change ${token.priceChange5m.toFixed(2)}% < ${this.criteria.minPriceChange5m}%`,
      };
    }

    if (token.priceChange5m > this.criteria.maxPriceChange5m) {
      return {
        token,
        meetsCriteria: false,
        rejectionReason: `Already pumped: 5m change ${token.priceChange5m.toFixed(2)}% > ${this.criteria.maxPriceChange5m}%`,
      };
    }

    return { token, meetsCriteria: true };
  }

  /**
   * Full scan + filter pipeline.
   * Returns only tokens that pass all criteria.
   */
  async scanAndFilter(): Promise<ScannedToken[]> {
    const allTokens = await this.scanForNewTokens();
    const passed: ScannedToken[] = [];

    for (const token of allTokens) {
      const result = this.evaluateToken(token);
      if (result.meetsCriteria) {
        passed.push(token);
        if (this.onTokenFound) {
          this.onTokenFound(token);
        }
      }
    }

    if (allTokens.length > 0) {
      console.log(
        `[Scanner] Scanned ${allTokens.length} tokens, ` +
        `${passed.length} passed criteria`
      );
    }

    return passed;
  }
}
