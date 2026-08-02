export interface JupiterTokenMetadata {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  priceUsd: number;
  priceNativeSol: number;
  liquidityUsd: number;
  volume24h: number;
  priceChange5m: number;
  priceChange1h: number;
  priceChange24h: number;
  fdv: number;
  dexId: string;
  pairAddress: string;
  logoURI?: string;
  verified: boolean;
  isProfitableHistory?: boolean;
}

const tokenMetadataCache: Map<string, { data: JupiterTokenMetadata; expiresAt: number }> = new Map();

export const loadTokenMetadataByAddress = async (address: string): Promise<JupiterTokenMetadata | null> => {
  const cleanAddr = address.trim();
  if (!cleanAddr) return null;

  const cached = tokenMetadataCache.get(cleanAddr);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  try {
    // 1. Fetch from DexScreener API
    const res = await fetch(`/api/dex/tokens/${cleanAddr}?t=${Date.now()}`);
    if (res.ok) {
      const data = await res.json();
      const pairs = data.pairs || data;
      if (Array.isArray(pairs) && pairs.length > 0) {
        const solPair = pairs.find((p: any) => p.quoteToken?.symbol === 'SOL') || pairs[0];
        const priceUsd = parseFloat(solPair.priceUsd || '0');
        const priceNativeSol = parseFloat(solPair.priceNative || '0');

        const meta: JupiterTokenMetadata = {
          address: solPair.baseToken?.address || cleanAddr,
          symbol: solPair.baseToken?.symbol || 'UNKNOWN',
          name: solPair.baseToken?.name || 'Unknown Token',
          decimals: 6,
          priceUsd,
          priceNativeSol,
          liquidityUsd: solPair.liquidity?.usd || 0,
          volume24h: solPair.volume?.h24 || 0,
          priceChange5m: solPair.priceChange?.m5 || 0,
          priceChange1h: solPair.priceChange?.h1 || 0,
          priceChange24h: solPair.priceChange?.h24 || 0,
          fdv: solPair.fdv || 0,
          dexId: solPair.dexId || 'raydium',
          pairAddress: solPair.pairAddress || '',
          logoURI: solPair.info?.imageUrl,
          verified: true
        };

        tokenMetadataCache.set(cleanAddr, { data: meta, expiresAt: Date.now() + 15000 });
        return meta;
      }
    }
  } catch (e) {
    console.warn(`[JupiterSearchService]: Failed fetching metadata for ${cleanAddr}:`, e);
  }

  // Fallback token meta if external fetch fails
  const fallbackMeta: JupiterTokenMetadata = {
    address: cleanAddr,
    symbol: cleanAddr.length > 10 ? `${cleanAddr.slice(0, 4)}...${cleanAddr.slice(-4)}` : cleanAddr,
    name: `Token (${cleanAddr.slice(0, 6)})`,
    decimals: cleanAddr.toLowerCase().endsWith('pump') ? 6 : 6,
    priceUsd: 0,
    priceNativeSol: 0,
    liquidityUsd: 0,
    volume24h: 0,
    priceChange5m: 0,
    priceChange1h: 0,
    priceChange24h: 0,
    fdv: 0,
    dexId: 'unknown',
    pairAddress: '',
    verified: false
  };

  tokenMetadataCache.set(cleanAddr, { data: fallbackMeta, expiresAt: Date.now() + 10000 });
  return fallbackMeta;
};

export const searchJupiterTokens = async (query: string): Promise<JupiterTokenMetadata[]> => {
  const clean = query.trim();
  if (!clean) return [];

  // Address lookup
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(clean)) {
    const single = await loadTokenMetadataByAddress(clean);
    return single ? [single] : [];
  }

  // Symbol / Name search lookup via DexScreener proxy
  try {
    const res = await fetch(`/api/dex/search?q=${encodeURIComponent(clean)}`);
    if (res.ok) {
      const data = await res.json();
      const pairs = data.pairs || (Array.isArray(data) ? data : []);
      if (Array.isArray(pairs)) {
        const solPairs = pairs.filter((p: any) => p.chainId === 'solana');
        const results: JupiterTokenMetadata[] = solPairs.slice(0, 15).map((p: any) => ({
          address: p.baseToken?.address || '',
          symbol: p.baseToken?.symbol || 'UNKNOWN',
          name: p.baseToken?.name || 'Unknown',
          decimals: 6,
          priceUsd: parseFloat(p.priceUsd || '0'),
          priceNativeSol: parseFloat(p.priceNative || '0'),
          liquidityUsd: p.liquidity?.usd || 0,
          volume24h: p.volume?.h24 || 0,
          priceChange5m: p.priceChange?.m5 || 0,
          priceChange1h: p.priceChange?.h1 || 0,
          priceChange24h: p.priceChange?.h24 || 0,
          fdv: p.fdv || 0,
          dexId: p.dexId || 'dex',
          pairAddress: p.pairAddress || '',
          logoURI: p.info?.imageUrl,
          verified: true
        })).filter(t => t.address !== '');

        return results;
      }
    }
  } catch (e) {
    console.warn('[JupiterSearchService]: Token query search failed:', e);
  }

  return [];
};
