// server/workers/tradingWorker.ts
import '../utils/polyfill.js';
import dotenv from 'dotenv';
import { reconcileDatabaseWithMainnet } from './StartupReconciliationWorker.js';
import { tradingMonitorWorker } from './TradingMonitorWorker.js';
import { streamingTransportManager } from '../market/StreamingTransportManager.js';
import { yellowstoneConnectionManager } from '../market/YellowstoneConnectionManager.js';
import { marketEventBus } from '../market/MarketEventBus.js';
import { tokenDiscovery } from '../market/TokenDiscovery.js';
import { startWorkerHeartbeat } from '../services/WorkerHeartbeat.js';
import { criteriaRepository } from '../repositories/CriteriaRepository.js';
import { workerStateRepository } from '../repositories/WorkerStateRepository.js';
import { tradingEngine } from '../trading/TradingEngine.js';
import { entryEngine } from '../trading/EntryEngine.js';
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

  // 3. Connect Authoritative Helius Real-Time Ingestion (WSS / gRPC) & Start Entry Engine
  try {
    marketEventBus.subscribe((event) => {
      tokenDiscovery.processMarketEvent(event);
    });

    entryEngine.start();
    console.log('[TRADING WORKER] EntryEngine active and subscribed to market events.');

    const connected = await streamingTransportManager.start();
    if (connected) {
      console.log('[TRADING WORKER] Helius streaming transport active.');
    } else {
      console.log('[TRADING WORKER] Helius streaming transport standby/reconnecting.');
    }
  } catch (e) {
    console.warn('[TRADING WORKER] Streaming transport start warning:', e);
  }

  // 4. Telemetry synchronizer loop
  let telemetryLoopRunning = false;
  setInterval(() => {
    if (telemetryLoopRunning) return;
    telemetryLoopRunning = true;
    (async () => {
      try {
        const telemetry = streamingTransportManager.getTelemetry();
        await workerStateRepository.updateMetadata('trading', {
          transportConnected: telemetry.connected,
          lastReceivedSlot: telemetry.lastSlot,
          lastEventAt: telemetry.lastMessageAt || 0,
          reconnectCount: telemetry.reconnectCount,
        });
      } catch {
        // Non-blocking guard
      } finally {
        telemetryLoopRunning = false;
      }
    })();
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
