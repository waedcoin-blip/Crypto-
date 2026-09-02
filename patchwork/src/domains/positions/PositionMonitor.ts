import { positionRegistry } from '../../services/PositionRegistry';
import { PnlCalculator } from './PnlCalculator';

export class PositionMonitor {
  private static instance: PositionMonitor;

  public static getInstance(): PositionMonitor {
    if (!PositionMonitor.instance) {
      PositionMonitor.instance = new PositionMonitor();
    }
    return PositionMonitor.instance;
  }

  public evaluatePositions(priceMap: Map<string, number>): void {
    const openPositions = positionRegistry.getOpenPositions();
    for (const pos of openPositions) {
      const currentPrice = priceMap.get(pos.mintAddress);
      if (currentPrice && currentPrice > 0) {
        positionRegistry.updatePrice(pos.mintAddress, currentPrice);
      }
    }
  }
}

export const positionMonitor = PositionMonitor.getInstance();
