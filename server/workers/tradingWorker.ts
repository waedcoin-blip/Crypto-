// server/workers/tradingWorker.ts
import '../utils/polyfill.js';
import dotenv from 'dotenv';
import { tradingSupervisor } from '../trading/TradingSupervisor.js';
import { startWorkerHeartbeat } from '../services/WorkerHeartbeat.js';
import { criteriaRepository } from '../repositories/CriteriaRepository.js';
import { workerStateRepository } from '../repositories/WorkerStateRepository.js';
import { streamingTransportManager } from '../market/StreamingTransportManager.js';

dotenv.config({ path: '.env.local' });
dotenv.config();

async function main() {
  console.log('[TRADING WORKER] Initializing 24/7 Render trading worker via TradingSupervisor...');

  // 1. Connect & load trading config
  const activeCriteria = await criteriaRepository.getActiveCriteria();
  console.log('[TRADING WORKER] Loaded active trading criteria:', JSON.stringify(activeCriteria));

  // 2. Initialize worker heartbeat
  startWorkerHeartbeat('trading', 3000);
  console.log('[TRADING WORKER] Worker heartbeat active.');

  // 3. Delegate complete startup to authoritative TradingSupervisor
  const defaultNet = process.env.DEFAULT_NETWORK || 'paper';
  const supervisorStatus = await tradingSupervisor.startTrading({
    network: defaultNet,
    wallet: 'default',
  });

  console.log('[TRADING WORKER] TradingSupervisor status:', supervisorStatus.state);

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

  console.log('[TRADING WORKER] 24/7 worker process started successfully.');

  // Keep worker process alive 24/7
  await new Promise(() => {});
}

main().catch((error) => {
  console.error('[TRADING WORKER FATAL]', error);
  process.exit(1);
});

