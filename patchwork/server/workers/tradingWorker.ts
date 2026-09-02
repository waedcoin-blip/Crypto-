// server/workers/tradingWorker.ts
import dotenv from 'dotenv';
import { reconcileDatabaseWithMainnet } from './StartupReconciliationWorker.js';
import { tradingMonitorWorker } from './TradingMonitorWorker.js';
import { yellowstoneConnectionManager } from '../market/YellowstoneConnectionManager.js';
import { marketEventBus } from '../market/MarketEventBus.js';
import { tokenDiscovery } from '../market/TokenDiscovery.js';
import { startWorkerHeartbeat } from '../services/WorkerHeartbeat.js';
import { criteriaRepository } from '../repositories/CriteriaRepository.js';
import { workerStateRepository } from '../repositories/WorkerStateRepository.js';
import { tradingEngine } from '../trading/TradingEngine.js';
import { laserLogger } from '../utils/logger.js';

dotenv.config({ path: '.env.local' });
dotenv.config();

async function main() {
  console.log('[TRADING WORKER] Initializing 24/7 Render trading worker...');

  // 1. Connect & load trading config
  const activeCriteria = await criteriaRepository.getActiveCriteria();
  console.log('[TRADING WORKER] Loaded active trading criteria:', JSON.stringify(activeCriteria));

  // 2. Initialize worker heartbeat
  startWorkerHeartbeat('trading', 3000);
  console.log('[TRADING WORKER] Worker heartbeat active.');

  // 3. Connect Yellowstone gRPC Ingestion
  try {
    marketEventBus.subscribe((event) => {
      tokenDiscovery.processMarketEvent(event);
    });

    const connected = await yellowstoneConnectionManager.connect();
    if (connected) {
      console.log('[TRADING WORKER] Yellowstone gRPC ingestion active.');
    } else {
      console.warn('[TRADING WORKER] Yellowstone gRPC connection pending auto-reconnect.');
    }
  } catch (e) {
    console.warn('[TRADING WORKER] Yellowstone start warning:', e);
  }

  // 4. Telemetry synchronizer loop
  setInterval(async () => {
    try {
      const telemetry = yellowstoneConnectionManager.getTelemetry();
      await workerStateRepository.updateMetadata('trading', {
        transportConnected: telemetry.connected,
        lastReceivedSlot: telemetry.lastReceivedSlot,
        lastEventAt: telemetry.lastEventAt,
        reconnectCount: telemetry.reconnectCount,
      });
    } catch {
      // Non-blocking guard
    }
  }, 3000);

  // 5. Startup reconciliation
  await reconcileDatabaseWithMainnet();
  console.log('[TRADING WORKER] Startup reconciliation completed.');

  // 6. Start position monitor loop
  await tradingMonitorWorker.start();
  console.log('[TRADING WORKER] Position monitor loop started.');

  console.log('[TRADING WORKER] 24/7 worker started successfully.');

  // Keep worker process alive 24/7
  await new Promise(() => {});
}

main().catch((error) => {
  console.error('[TRADING WORKER FATAL]', error);
  process.exit(1);
});
