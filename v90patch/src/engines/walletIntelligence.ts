import { eventBus } from './eventBus';
import { useAppStore } from '../store/appStore';

/**
 * Wallet Intelligence Engine
 * Specialized in monitoring wallet behavior, whales, and smart money.
 */
export class WalletIntelligenceEngine {
  private monitoredWallets: Set<string>;

  constructor() {
    this.monitoredWallets = new Set();
    this.syncMonitoredWallets();
    
    // Subscribe to store changes to keep monitored wallets updated
    useAppStore.subscribe((state) => {
      this.monitoredWallets = new Set(state.monitoredWallets.map(w => w.address));
    });
  }

  private syncMonitoredWallets() {
    const list = useAppStore.getState().monitoredWallets;
    this.monitoredWallets = new Set(list.map(w => w.address));
  }

  public analyzeTrade(trade: { type: string, token: string, tokenAddress: string, amount: number, wallet: string }) {
    if (!trade.wallet) return;

    // Check if it's a monitored wallet
    if (this.monitoredWallets.has(trade.wallet)) {
      useAppStore.getState().addTelemetryAlert({
        id: `wallet-alert-${Date.now()}-${Math.random()}`,
        token: trade.token,
        address: trade.tokenAddress,
        type: 'WALLET_TRADE',
        message: `Monitored Wallet ${trade.type.toUpperCase()}: ${trade.token}`,
        timestamp: Date.now()
      });
      return;
    }

    // Whale Detection
    if (trade.type === 'buy' && trade.amount > 1000000) {
       eventBus.emit('WHALE_BUY', {
         tokenAddress: trade.tokenAddress,
         symbol: trade.token,
         amount: trade.amount,
         wallet: trade.wallet
       });
    }
  }
}

export const walletIntelligence = new WalletIntelligenceEngine();
