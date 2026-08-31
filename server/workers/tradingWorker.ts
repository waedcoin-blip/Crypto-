// server/workers/tradingWorker.ts
import dotenv from 'dotenv';
import { reconcileDatabaseWithMainnet } from './StartupReconciliationWorker.js';
import { tradingMonitorWorker } from './TradingMonitorWorker.js';
import { runLaserstreamWorker } from '../engines/LaserstreamIngestion.js';
import { startWorkerHeartbeat } from '../services/WorkerHeartbeat.js';
import { criteriaRepository } from '../repositories/CriteriaRepository.js';

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

  // 3. Startup reconciliation
  await reconcileDatabaseWithMainnet();
  console.log('[TRADING WORKER] Startup reconciliation completed.');

  // 4. Start LaserStream gRPC / Telemetry ingestion
  try {
    runLaserstreamWorker().catch(e => console.warn('[TRADING WORKER] Laserstream worker error:', e));
    console.log('[TRADING WORKER] Laserstream gRPC ingestion initiated.');
  } catch (e) {
    console.warn('[TRADING WORKER] Laserstream start warning:', e);
  }

  // 5. Start position monitor loop
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
