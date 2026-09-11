// shared/scannerEngine.ts (Adjust path as needed)
import { eventBus } from './eventBus';
import { useAppStore } from '../store/appStore';
import { walletIntelligence } from './walletIntelligence';
import { riskAnalyzer } from './riskAnalyzerEngine';
import { highFrequencyBuyDetector } from './highFrequencyBuyDetector';

export class ScannerEngine {
  public processTrackingFrame(trades: any[]) {
    const state = useAppStore.getState();
    if (!state.isMonitoring) return;

    trades.forEach((trade) => {
      // 1. Analyze Wallet activity
      walletIntelligence.analyzeTrade(trade);

      // 2. Analyze High Frequency Buys
      highFrequencyBuyDetector.analyzeTrade({
        tokenAddress: trade.tokenAddress,
        token: trade.token,
        type: trade.type || (trade.isBuy ? 'buy' : 'sell'),
        amount: trade.amount,
        priceSol: trade.priceSol,
        timestamp: trade.timestamp || Date.now(),
        maker: trade.maker
      });

      // 3. FIX: Actually use riskAnalyzer if token metrics are present
      if (trade.riskScore !== undefined || trade.liquidity !== undefined || trade.devOwnership !== undefined) {
        riskAnalyzer.analyzeToken({
          address: trade.tokenAddress,
          riskScore: trade.riskScore,
          liquidity: trade.liquidity,
          marketCap: trade.marketCap,
          devOwnership: trade.devOwnership
        });
      }

      // 4. Discover new token logic
      if (trade.isNewDiscovery) {
         eventBus.emit('NEW_TOKEN', {
             tokenAddress: trade.tokenAddress,
             symbol: trade.token,
             data: trade
         });
      }

      // 5. Spikes and thresholds
      if (trade.amount > 500000) {
         eventBus.emit('VOLUME_SPIKE', {
             tokenAddress: trade.tokenAddress,
             symbol: trade.token,
             volume: trade.amount
         });
      }
    });
  }

  public getStatus() {
    return {
      isMonitoring: useAppStore.getState().isMonitoring,
      monitoredWalletsCount: walletIntelligence.getMonitoredWallets().length,
      activeRiskProfiles: riskAnalyzer.getAllRiskStates().length,
      activeDetectorBuffers: Object.keys(highFrequencyBuyDetector.getDetectorState()).length
    };
  }
}

export const scannerEngine = new ScannerEngine();