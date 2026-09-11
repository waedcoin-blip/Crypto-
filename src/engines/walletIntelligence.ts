// shared/walletIntelligence.ts (Adjust path as needed)
import { eventBus } from './eventBus';
import { useAppStore } from '../store/appStore';

export class WalletIntelligenceEngine {
  private monitoredWallets: Set<string> = new Set();
  private readonly WHALE_THRESHOLD = 1000000; // Configurable threshold (SOL/USD)

  constructor() {
    this.syncMonitoredWallets();
    useAppStore.subscribe(() => this.syncMonitoredWallets());
  }

  private syncMonitoredWallets() {
    const list = useAppStore.getState().monitoredWallets;
    this.monitoredWallets = new Set(list.map(w => w.address));
  }

  public analyzeTrade(trade: { type: string, token: string, tokenAddress: string, amount: number, wallet: string }) {
    if (!trade.wallet) return;

    const isMonitored = this.monitoredWallets.has(trade.wallet);
    
    // FIX: Removed early return so monitored wallets can ALSO trigger whale alerts
    if (isMonitored) {
       useAppStore.getState().addTelemetryAlert({
         id: `wallet-alert-${Date.now()}-${Math.random()}`,
         token: trade.token,
         address: trade.tokenAddress,
         type: 'WALLET_TRADE',
         message: `Monitored Wallet ${trade.type.toUpperCase()}: ${trade.amount.toLocaleString()} ${trade.token}`,
         timestamp: Date.now()
       });
    }

    // Whale Detection
    if (trade.type === 'buy' && trade.amount > this.WHALE_THRESHOLD) {
       eventBus.emit('WHALE_BUY', {
         tokenAddress: trade.tokenAddress,
         symbol: trade.token,
         amount: trade.amount,
         wallet: trade.wallet
       });
    }
  }

  public getMonitoredWallets(): string[] {
    return Array.from(this.monitoredWallets);
  }
}

export const walletIntelligence = new WalletIntelligenceEngine();