import { PublicKey } from '@solana/web3.js';
import { ConnectionFactory } from '../../infrastructure/solana/ConnectionFactory';
import { walletRegistry, MonitoredWallet } from './WalletRegistry';
import { walletTransactionProcessor } from './WalletTransactionProcessor';
import { walletHealthService } from './WalletHealthService';
import { ParsedWalletTrade } from '../../services/WalletTransactionParser';
import { loggerService } from '../../infrastructure/logging/LoggerService';

export type WalletTradeListener = (trade: ParsedWalletTrade, wallet: MonitoredWallet) => void;

export class WalletSubscriptionManager {
  private static instance: WalletSubscriptionManager;
  private activeSubscriptions: Map<string, number> = new Map(); // walletAddress -> subId
  private tradeListeners: Set<WalletTradeListener> = new Set();
  private isRunning = false;

  private constructor() {}

  public static getInstance(): WalletSubscriptionManager {
    if (!WalletSubscriptionManager.instance) {
      WalletSubscriptionManager.instance = new WalletSubscriptionManager();
    }
    return WalletSubscriptionManager.instance;
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    walletRegistry.subscribe((wallets) => {
      this.syncSubscriptions(wallets);
    });
  }

  public stop(): void {
    const connection = ConnectionFactory.getConnectionForRole('monitor');
    for (const [address, subId] of this.activeSubscriptions.entries()) {
      try {
        connection.removeOnLogsListener(subId);
      } catch (e) {
        // Ignore removal error
      }
      walletHealthService.updateStatus(address, 'DISCONNECTED');
    }
    this.activeSubscriptions.clear();
    this.isRunning = false;
  }

  public onTrade(listener: WalletTradeListener): () => void {
    this.tradeListeners.add(listener);
    return () => this.tradeListeners.delete(listener);
  }

  private syncSubscriptions(wallets: MonitoredWallet[]): void {
    const activeWallets = wallets.filter(w => w.status === 'active' || !w.status);
    const activeAddresses = new Set(activeWallets.map(w => w.address));

    // Remove obsolete subscriptions
    const connection = ConnectionFactory.getConnectionForRole('monitor');
    for (const [address, subId] of this.activeSubscriptions.entries()) {
      if (!activeAddresses.has(address)) {
        try {
          connection.removeOnLogsListener(subId);
        } catch (e) {
          // ignore
        }
        this.activeSubscriptions.delete(address);
        walletHealthService.setSubscriptionCount(address, 0);
      }
    }

    // Subscribe to new active wallets
    for (const wallet of activeWallets) {
      if (!this.activeSubscriptions.has(wallet.address)) {
        this.subscribeWallet(wallet);
      }
    }
  }

  private subscribeWallet(wallet: MonitoredWallet): void {
    try {
      const pubkey = new PublicKey(wallet.address);
      const connection = ConnectionFactory.getConnectionForRole('monitor');

      const subId = connection.onLogs(
        pubkey,
        async (logs, _ctx) => {
          if (logs.err) return;
          const signature = logs.signature;
          if (!signature) return;

          const parsed = await walletTransactionProcessor.processSignature(signature, wallet.address);
          if (parsed) {
            walletHealthService.recordTransaction(wallet.address, parsed.timestampMs);
            this.tradeListeners.forEach(listener => {
              try {
                listener(parsed, wallet);
              } catch (err) {
                console.error('Error in trade listener:', err);
              }
            });
          }
        },
        'confirmed'
      );

      this.activeSubscriptions.set(wallet.address, subId);
      walletHealthService.setSubscriptionCount(wallet.address, 1);
      loggerService.emit('WALLET_SUBSCRIPTION_ACTIVE', `Active subscription established for ${wallet.name || wallet.address}`, { wallet: wallet.address });
    } catch (err: any) {
      console.error(`Failed to subscribe wallet ${wallet.address}:`, err);
      walletHealthService.updateStatus(wallet.address, 'ERROR', err?.message || 'Subscription failed');
    }
  }
}

export const walletSubscriptionManager = WalletSubscriptionManager.getInstance();
