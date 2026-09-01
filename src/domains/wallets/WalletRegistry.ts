import { walletRepository, WalletRecord } from '../../infrastructure/persistence/WalletRepository';
import { loggerService } from '../../infrastructure/logging/LoggerService';

export interface MonitoredWallet extends WalletRecord {}

export class WalletRegistry {
  private static instance: WalletRegistry;
  private wallets: Map<string, MonitoredWallet> = new Map();
  private listeners: Set<(wallets: MonitoredWallet[]) => void> = new Set();

  private constructor() {}

  public static getInstance(): WalletRegistry {
    if (!WalletRegistry.instance) {
      WalletRegistry.instance = new WalletRegistry();
    }
    return WalletRegistry.instance;
  }

  public async initialize(): Promise<void> {
    try {
      const records = await walletRepository.getAllWallets();
      this.wallets.clear();
      for (const record of records) {
        this.wallets.set(record.id, record);
      }
      this.notify();
    } catch (err) {
      console.warn('WalletRegistry: Unable to load from Firestore, using memory store.');
    }
  }

  public getWallets(): MonitoredWallet[] {
    return Array.from(this.wallets.values());
  }

  public getWallet(id: string): MonitoredWallet | undefined {
    return this.wallets.get(id);
  }

  public async addWallet(wallet: MonitoredWallet): Promise<void> {
    this.wallets.set(wallet.id, wallet);
    loggerService.emit('WALLET_ADDED', `Wallet added: ${wallet.name || wallet.address}`, { wallet: wallet.address });
    try {
      await walletRepository.saveWallet(wallet);
    } catch (e) {
      // Ignore fallback
    }
    this.notify();
  }

  public async removeWallet(id: string): Promise<void> {
    const w = this.wallets.get(id);
    if (w) {
      this.wallets.delete(id);
      loggerService.emit('WALLET_REMOVED', `Wallet removed: ${w.address}`, { wallet: w.address });
      try {
        await walletRepository.deleteWallet(id);
      } catch (e) {
        // Ignore fallback
      }
      this.notify();
    }
  }

  public subscribe(fn: (wallets: MonitoredWallet[]) => void): () => void {
    this.listeners.add(fn);
    fn(this.getWallets());
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    const all = this.getWallets();
    this.listeners.forEach(fn => fn(all));
  }
}

export const walletRegistry = WalletRegistry.getInstance();
