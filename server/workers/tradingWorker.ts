// server/workers/tradingWorker.ts
import dotenv from 'dotenv';
import { reconcileDatabaseWithMainnet } from './StartupReconciliationWorker.js';
import { tradingMonitorWorker } from './TradingMonitorWorker.js';
import { startLaserStream } from '../engines/LaserstreamIngestion.js';
import { startWorkerHeartbeat } from '../services/WorkerHeartbeat.js';
import { criteriaRepository } from '../repositories/CriteriaRepository.js';
import { getLaserStreamTelemetry } from '../engines/LaserstreamIngestion.js';
import { workerStateRepository } from '../repositories/WorkerStateRepository.js';
import { config } from '../config/index.js';

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

  // 3. Telemetry synchronizer loop
  setInterval(async () => {
    try {
      const telemetry = getLaserStreamTelemetry();
      await workerStateRepository.updateMetadata('trading', {
        laserstreamStatus: telemetry.status,
        lastReceivedSlot: telemetry.lastReceivedSlot,
        lastProcessedSlot: telemetry.lastProcessedSlot,
        slotLag: telemetry.slotLag,
        queueDepth: telemetry.queueDepth,
        transportConnected: telemetry.transportConnected,
        lastEventAt: telemetry.lastEventAt,
      });
    } catch (err) {
      // Non-blocking telemetry sync error guard
    }
  }, 3000);

  // 4. Startup reconciliation
  await reconcileDatabaseWithMainnet();
  console.log('[TRADING WORKER] Startup reconciliation completed.');

  // 5. Start LaserStream gRPC Ingestion
  try {
    if (config.HELIUS_API_KEY) {
      await startLaserStream(
        { apiKey: config.HELIUS_API_KEY, network: 'mainnet' },
        (event) => {
          // On-chain transaction ingested
        }
      );
      console.log('[TRADING WORKER] LaserStream in-process gRPC ingestion initiated.');
    } else {
      console.log('[TRADING WORKER] No HELIUS_API_KEY configured for LaserStream.');
    }
  } catch (e) {
    console.warn('[TRADING WORKER] LaserStream start warning:', e);
  }

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
