import { walletRegistry, walletSubscriptionManager, walletSyncService } from '../domains/wallets';
import { tokenDiscoveryService } from '../domains/discovery';
import { priceMonitor, marketDataService } from '../domains/market';
import { tradeReceiptService } from '../domains/trading';
import { positionRegistry, positionMonitor } from '../domains/positions';
import { laserStreamService } from '../domains/telemetry';
import { loggerService } from '../infrastructure/logging/LoggerService';

export class DependencyContainer {
  public walletRegistry = walletRegistry;
  public walletSubscriptionManager = walletSubscriptionManager;
  public walletSyncService = walletSyncService;
  public tokenDiscoveryService = tokenDiscoveryService;
  public priceMonitor = priceMonitor;
  public marketDataService = marketDataService;
  public tradeReceiptService = tradeReceiptService;
  public positionRegistry = positionRegistry;
  public positionMonitor = positionMonitor;
  public laserStreamService = laserStreamService;
  public loggerService = loggerService;
}

export const container = new DependencyContainer();
