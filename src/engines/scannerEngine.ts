import { eventBus } from './eventBus';
import { useAppStore } from '../store/appStore';
import { walletIntelligence } from './walletIntelligence';
import { riskAnalyzer } from './riskAnalyzerEngine';

/**
 * Scanner Engine
 * Processes incoming data streams from WebSockets or polling (e.g. tracking frame).
 */
export class ScannerEngine {
  public processTrackingFrame(trades: any[]) {
      const state = useAppStore.getState();
      if (!state.isMonitoring) return;

      trades.forEach((trade) => {
          // 1. Analyze Wallet activity
          walletIntelligence.analyzeTrade(trade);

          // 2. Discover new token logic
          if (trade.isNewDiscovery) {
             eventBus.emit('NEW_TOKEN', {
                 tokenAddress: trade.tokenAddress,
                 symbol: trade.token,
                 data: trade
             });
          }

          // 3. Spikes and thresholds
          if (trade.amount > 500000) {
             eventBus.emit('VOLUME_SPIKE', {
                 tokenAddress: trade.tokenAddress,
                 symbol: trade.token,
                 volume: trade.amount
             });
          }
          
          // Here we would also update metrics mapping 
          // useAppStore.getState().setTokenMetrics(...)
      });
  }
}

export const scannerEngine = new ScannerEngine();
