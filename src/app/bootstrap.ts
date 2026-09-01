import { container } from './dependencyContainer';

export async function bootstrapApplication(): Promise<void> {
  container.loggerService.emit('WALLET_SYNCED', 'Bootstrapping application domain services');
  await container.walletSyncService.syncAll();
  container.walletSubscriptionManager.start();
  container.loggerService.emit('WALLET_SYNCED', 'Application domain services successfully initialized');
}
