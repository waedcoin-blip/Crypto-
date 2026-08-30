import { TokenCriteria, DEFAULT_CRITERIA } from '../config/tokenCriteria';

// ─── Types ───────────────────────────────────────────────────────────

export interface ScannedToken {
  address: string;
  symbol: string;
  name: string;
  priceUsd: number;
  priceChange5m: number;
  priceChange1h: number;
  priceChange24h: number;
  volume24h: number;
  liquidityUsd: number;
  fdv: number;
  marketCap: number;
  pairCreatedAt: number;
  dexId: string;
  pairAddress: string;
  url: string;
}

export interface TokenSecurityResult {
  token: ScannedToken;
  meetsCriteria: boolean;
  rejectionReasons: string[];
  rejectionReason?: string;
}

export interface ScanStats {
  scanned: number;
  passed: number;
  rejected: number;
  byReason: Record<string, number>;
  durationMs: number;
}

export type ScanStatus = 'OK' | 'DISCOVERY_UNAVAILABLE' | 'ERROR' | 'IDLE';

// ─── Constants ─────────────────────────────────────────────────────

const DEFAULT_SCAN_TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 10_000; // 10s rapid re-check for fast-moving bonding tokens
const MAX_CACHE_SIZE = 5_000;

// ─── Helpers ───────────────────────────────────────────────────────

function safeParseFloat(value: unknown, fallback = 0): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function safeParseInt(value: unknown, fallback = 0): number {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.floor(value) : fallback;
  if (typeof value === 'string') {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

/**
 * Maps a raw DEXScreener pair object into a clean ScannedToken.
 */
function mapPairToToken(pair: unknown): ScannedToken | null {
  if (!pair || typeof pair !== 'object') return null;

  const p = pair as Record<string, unknown>;
  const baseToken = p.baseToken as Record<string, unknown> | undefined;
  const priceChange = p.priceChange as Record<string, unknown> | undefined;
  const volume = p.volume as Record<string, unknown> | undefined;
  const liquidity = p.liquidity as Record<string, unknown> | undefined;

  const address = baseToken?.address;
  if (typeof address !== 'string' || !address) return null;

  return {
    address,
    symbol: typeof baseToken?.symbol === 'string' ? baseToken.symbol : 'UNKNOWN',
    name: typeof baseToken?.name === 'string' ? baseToken.name : 'Unknown',
    priceUsd: safeParseFloat(p.priceUsd),
    priceChange5m: safeParseFloat(priceChange?.m5),
    priceChange1h: safeParseFloat(priceChange?.h1),
    priceChange24h: safeParseFloat(priceChange?.h24),
    volume24h: safeParseFloat(volume?.h24),
    liquidityUsd: safeParseFloat(liquidity?.usd),
    fdv: safeParseFloat(p.fdv),
    marketCap: safeParseFloat(p.marketCap),
    pairCreatedAt: safeParseInt(p.pairCreatedAt),
    dexId: typeof p.dexId === 'string' ? p.dexId : '',
    pairAddress: typeof p.pairAddress === 'string' ? p.pairAddress : '',
    url: typeof p.url === 'string' ? p.url : '',
  };
}

// ─── Scanner ───────────────────────────────────────────────────────

export class TokenScanner {
  private criteria: TokenCriteria;
  private scannedCache: Map<string, number> = new Map(); // address → last scan timestamp
  private onTokenFound?: (token: ScannedToken) => void;
  private abortController: AbortController | null = null;
  private isScanning = false;

  public lastScanStatus: ScanStatus = 'IDLE';
  public lastErrorMessage = '';
  public lastScanStats: ScanStats | null = null;

  constructor(
    criteria: TokenCriteria = DEFAULT_CRITERIA,
    onTokenFound?: (token: ScannedToken) => void
  ) {
    this.criteria = criteria;
    this.onTokenFound = onTokenFound;
  }

  getCriteria(): Readonly<TokenCriteria> {
    return Object.freeze({ ...this.criteria });
  }

  updateCriteria(criteria: Partial<TokenCriteria>): void {
    this.criteria = { ...this.criteria, ...criteria };
  }

  /**
   * Abort any in-flight scan request.
   */
  abort(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  /**
   * Clear the scanned-token cache.
   */
  clearCache(): void {
    this.scannedCache.clear();
  }

  /**
   * Return approximate cache size.
   */
  getCacheSize(): number {
    return this.scannedCache.size;
  }

  /**
   * Remove expired entries from the cache to prevent unbounded growth.
   */
  private pruneCache(): void {
    const now = Date.now();
    for (const [address, timestamp] of this.scannedCache) {
      if (now - timestamp > CACHE_TTL_MS * 2) {
        this.scannedCache.delete(address);
      }
    }

    // Hard cap: evict oldest if still over limit
    if (this.scannedCache.size > MAX_CACHE_SIZE) {
      const entries = Array.from(this.scannedCache.entries());
      entries.sort((a, b) => a[1] - b[1]);
      const toDelete = entries.slice(0, entries.length - MAX_CACHE_SIZE);
      for (const [address] of toDelete) {
        this.scannedCache.delete(address);
      }
    }
  }

  /**
   * Fetch latest token pairs from DEXScreener.
   * Returns only Solana tokens that haven't been scanned recently.
   */
  async scanForNewTokens(): Promise<ScannedToken[]> {
    if (this.isScanning) {
      console.warn('[Scanner] Scan already in progress; skipping.');
      return [];
    }

    this.isScanning = true;
    this.abortController = new AbortController();
    const startTime = performance.now();

    try {
      const response = await fetch('/api/dex/tokens/trending', {
        signal: this.abortController.signal,
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        // Direct Telemetry X-Ray fallback
        try {
          const xrayRes = await fetch('https://app.telemetry.io/x-ray', { signal: this.abortController.signal });
          if (xrayRes.ok) {
            const xrayText = await xrayRes.text();
            const matches = xrayText.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g);
            if (matches) {
              const uniqueMints = Array.from(new Set(matches));
              const candidates: ScannedToken[] = [];
              for (const address of uniqueMints) {
                if (this.criteria.excludedMints.has(address)) continue;
                candidates.push({
                  address,
                  symbol: 'XRAY',
                  name: 'Telemetry X-Ray Token',
                  priceUsd: 0,
                  priceChange5m: 0,
                  priceChange1h: 0,
                  priceChange24h: 0,
                  volume24h: 0,
                  liquidityUsd: 0,
                  fdv: 0,
                  marketCap: 0,
                  pairCreatedAt: Date.now(),
                  dexId: address.toLowerCase().endsWith('pump') ? 'pumpfun' : 'raydium',
                  pairAddress: '',
                  url: 'https://app.telemetry.io/x-ray'
                });
              }
              if (candidates.length > 0) {
                this.lastScanStatus = 'OK';
                this.lastErrorMessage = '';
                return candidates;
              }
            }
          }
        } catch {
          // Ignore fallback error
        }

        const status = response.status === 503 ? 'DISCOVERY_UNAVAILABLE' : 'ERROR';
        this.lastScanStatus = status;
        this.lastErrorMessage = `Discovery API unavailable (HTTP ${response.status})`;
        console.warn(`[Scanner] DEXScreener feed unavailable: ${response.status}`);
        return [];
      }

      const data = (await response.json()) as Record<string, unknown>;
      if (data.error === 'DISCOVERY_UNAVAILABLE' || data.failed === true) {
        this.lastScanStatus = 'DISCOVERY_UNAVAILABLE';
        this.lastErrorMessage = typeof data.message === 'string' ? data.message : 'Discovery feeds currently unreachable';
        console.warn('[Scanner] DEXScreener discovery feeds failed closed');
        return [];
      }

      const rawPairs = data.pairs ?? data;
      if (!Array.isArray(rawPairs)) {
        this.lastScanStatus = 'ERROR';
        this.lastErrorMessage = 'Invalid pairs payload received';
        return [];
      }

      this.pruneCache();
      const now = Date.now();
      const candidates: ScannedToken[] = [];

      for (const pair of rawPairs) {
        if ((pair as Record<string, unknown>).chainId !== 'solana') continue;

        const token = mapPairToToken(pair);
        if (!token) continue;

        // Deduplicate: skip if already scanned within TTL
        const lastScan = this.scannedCache.get(token.address) ?? 0;
        if (now - lastScan < CACHE_TTL_MS) continue;

        // Skip excluded mints
        if (this.criteria.excludedMints.has(token.address)) continue;

        // Candidate re-check TTL: 10s for initial candidates, 60s once accepted
        this.scannedCache.set(token.address, now - (CACHE_TTL_MS - 10000));
        candidates.push(token);
      }

      this.lastScanStatus = 'OK';
      this.lastErrorMessage = '';
      return candidates;

    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        this.lastScanStatus = 'ERROR';
        this.lastErrorMessage = 'Scan aborted';
      } else {
        this.lastScanStatus = 'ERROR';
        this.lastErrorMessage = err instanceof Error ? err.message : String(err);
        console.error('[Scanner] Scan failed:', err);
      }
      return [];
    } finally {
      this.isScanning = false;
      const duration = performance.now() - startTime;
      this.lastScanStats = {
        scanned: 0,
        passed: 0,
        rejected: 0,
        byReason: {},
        durationMs: Math.round(duration),
      };
    }
  }

  /**
   * Check if a single token meets all criteria.
   * Returns ALL rejection reasons, not just the first.
   */
  evaluateToken(token: ScannedToken): TokenSecurityResult {
    const reasons: string[] = [];

    if (token.priceUsd <= 0) {
      reasons.push('Zero or negative price');
    }

    if (token.liquidityUsd < this.criteria.minLiquidityUsd) {
      reasons.push(
        `Low liquidity: $${token.liquidityUsd.toFixed(0)} < $${this.criteria.minLiquidityUsd}`
      );
    }

    if (token.volume24h < this.criteria.minVolume24hUsd) {
      reasons.push(
        `Low volume: $${token.volume24h.toFixed(0)} < $${this.criteria.minVolume24hUsd}`
      );
    }

    if (token.pairCreatedAt > 0) {
      const age = Date.now() - token.pairCreatedAt;
      if (age > this.criteria.maxTokenAgeMs) {
        reasons.push(
          `Too old: ${(age / 3_600_000).toFixed(1)}h > ${(this.criteria.maxTokenAgeMs / 3_600_000)}h`
        );
      }
    }

    if (token.priceChange5m < this.criteria.minPriceChange5m) {
      reasons.push(
        `No momentum: 5m change ${token.priceChange5m.toFixed(2)}% < ${this.criteria.minPriceChange5m}%`
      );
    }

    if (token.priceChange5m > this.criteria.maxPriceChange5m) {
      reasons.push(
        `Already pumped: 5m change ${token.priceChange5m.toFixed(2)}% > ${this.criteria.maxPriceChange5m}%`
      );
    }

    return {
      token,
      meetsCriteria: reasons.length === 0,
      rejectionReasons: reasons,
      rejectionReason: reasons.length > 0 ? reasons[0] : undefined,
    };
  }

  /**
   * Full scan + filter pipeline.
   * Returns only tokens that pass all criteria, sorted by momentum (5m change desc).
   */
  async scanAndFilter(): Promise<ScannedToken[]> {
    const allTokens = await this.scanForNewTokens();
    const passed: ScannedToken[] = [];
    const byReason: Record<string, number> = {};

    for (const token of allTokens) {
      const result = this.evaluateToken(token);
      if (result.meetsCriteria) {
        passed.push(token);
        this.onTokenFound?.(token);
      } else {
        for (const reason of result.rejectionReasons) {
          byReason[reason] = (byReason[reason] ?? 0) + 1;
        }
      }
    }

    // Sort by best 5m momentum
    passed.sort((a, b) => b.priceChange5m - a.priceChange5m);

    if (this.lastScanStats) {
      this.lastScanStats.scanned = allTokens.length;
      this.lastScanStats.passed = passed.length;
      this.lastScanStats.rejected = allTokens.length - passed.length;
      this.lastScanStats.byReason = byReason;
    }

    if (allTokens.length > 0) {
      console.log(
        `[Scanner] Scanned ${allTokens.length} tokens, ${passed.length} passed, ${allTokens.length - passed.length} rejected`
      );
    }

    return passed;
  }
}
