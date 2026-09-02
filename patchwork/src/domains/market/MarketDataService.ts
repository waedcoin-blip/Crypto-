import { priceMonitor } from './PriceMonitor';

export class MarketDataService {
  private static instance: MarketDataService;

  public static getInstance(): MarketDataService {
    if (!MarketDataService.instance) {
      MarketDataService.instance = new MarketDataService();
    }
    return MarketDataService.instance;
  }

  public async fetchLatestPrice(mintAddress: string): Promise<number | null> {
    try {
      const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mintAddress}`);
      if (res.ok) {
        const data = await res.json();
        const pair = data.pairs?.[0];
        if (pair && pair.priceNative) {
          const priceSOL = parseFloat(pair.priceNative);
          const priceUSD = pair.priceUsd ? parseFloat(pair.priceUsd) : undefined;
          priceMonitor.recordPriceTick(mintAddress, priceSOL, priceUSD);
          return priceSOL;
        }
      }
    } catch (e) {
      console.warn(`Failed to fetch DexScreener market price for ${mintAddress}:`, e);
    }
    return null;
  }
}

export const marketDataService = MarketDataService.getInstance();
