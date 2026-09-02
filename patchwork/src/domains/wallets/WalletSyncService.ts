import { walletRegistry, MonitoredWallet } from './WalletRegistry';
import { walletHealthService } from './WalletHealthService';
import { loggerService } from '../../infrastructure/logging/LoggerService';

export class WalletSyncService {
  private static instance: WalletSyncService;

  public static getInstance(): WalletSyncService {
    if (!WalletSyncService.instance) {
      WalletSyncService.instance = new WalletSyncService();
    }
    return WalletSyncService.instance;
  }

  public async syncAll(): Promise<void> {
    loggerService.emit('WALLET_SYNCED', 'Starting full wallet sync');
    await walletRegistry.initialize();
    const wallets = walletRegistry.getWallets();
    for (const w of wallets) {
      walletHealthService.updateStatus(w.address, 'SYNCED');
    }
    loggerService.emit('WALLET_SYNCED', `Wallet sync completed for ${wallets.length} wallets`);
  }
}

export const walletSyncService = WalletSyncService.getInstance();
