import { recordCandidatePrice, checkTokenInProfitLast2Seconds, clearPriceHistories } from '../../services/priceTracker';
import { tokenRegistry } from '../../services/TokenRegistry';
import { positionRegistry } from '../../services/PositionRegistry';

export class PriceMonitor {
  private static instance: PriceMonitor;

  public static getInstance(): PriceMonitor {
    if (!PriceMonitor.instance) {
      PriceMonitor.instance = new PriceMonitor();
    }
    return PriceMonitor.instance;
  }

  public recordPriceTick(mintAddress: string, priceSOL: number, priceUSD?: number): void {
    recordCandidatePrice(mintAddress, priceSOL);
    tokenRegistry.updatePrice(mintAddress, priceSOL, priceUSD);
    positionRegistry.updatePrice(mintAddress, priceSOL);
  }

  public isTokenInProfit(mintAddress: string, currentPriceSOL: number): { inProfit: boolean; reason: string } {
    return checkTokenInProfitLast2Seconds(mintAddress, currentPriceSOL);
  }

  public reset(): void {
    clearPriceHistories();
  }
}

export const priceMonitor = PriceMonitor.getInstance();
