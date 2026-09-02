// server/workers/tradingWorker.ts
import dotenv from 'dotenv';
import { SystemProgram } from '@solana/web3.js';
import { reconcileDatabaseWithMainnet } from './StartupReconciliationWorker.js';
import { tradingMonitorWorker } from './TradingMonitorWorker.js';
import { startLaserStream, DEFAULT_NETWORK_PROGRAMS } from '../engines/LaserstreamIngestion.js';
import { startWorkerHeartbeat } from '../services/WorkerHeartbeat.js';
import { criteriaRepository } from '../repositories/CriteriaRepository.js';
import { getLaserStreamTelemetry } from '../engines/LaserstreamIngestion.js';
import { workerStateRepository } from '../repositories/WorkerStateRepository.js';
import { tokenRepository } from '../repositories/TokenRepository.js';
import { config } from '../config/index.js';
import { laserLogger } from '../utils/logger.js';
import type { SseEvent } from '../types/index.js';

// Only persist actual mint addresses extracted from Yellowstone token balances.
const WSOL_MINT = 'So11111111111111111111111111111111111111112';

function ingestLaserStreamEvent(event: SseEvent): void {
  try {
    if (event.type !== 'ON_CHAIN_TX' || event.err) return;
    const mints = Array.isArray(event.tokenMints) ? event.tokenMints : [];
    if (mints.length === 0) return;
    const network = event.network === 'devnet' ? 'devnet' : 'mainnet';
    const observedAt = typeof event.observationTimestamp === 'number' ? event.observationTimestamp : Date.now();
    for (const mintAddress of [...new Set(mints)]) {
      if (!mintAddress || mintAddress === WSOL_MINT) continue;
      const existing = tokenRepository.getToken(mintAddress);
      tokenRepository.upsertToken({
        mintAddress,
        network,
        discoveredAt: existing?.discoveredAt ?? observedAt,
        updatedAt: observedAt,
        signal: existing?.signal ?? 'YELLOWSTONE_ON_CHAIN_TX',
        metadata: { ...(existing?.metadata || {}), lastSignature: event.signature, lastSlot: event.slot },
      });
    }
  } catch (err) {
    laserLogger.error({ error: err }, '[TRADING WORKER] Failed to ingest Yellowstone event');
  }
}

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

  // 5. Start Yellowstone gRPC ingestion. The worker is no longer gated by Helius.
  try {
    const network = config.YELLOWSTONE_NETWORK || 'mainnet';
    const endpoint = network === 'devnet' ? config.YELLOWSTONE_GRPC_DEVNET_ENDPOINT : config.YELLOWSTONE_GRPC_ENDPOINT;
    const xToken = network === 'devnet' ? config.YELLOWSTONE_GRPC_DEVNET_X_TOKEN : config.YELLOWSTONE_GRPC_X_TOKEN;
    if (!endpoint) {
      console.warn(`[TRADING WORKER] Yellowstone endpoint missing for ${network}; ingestion disabled.`);
    } else {
      const handle = await startLaserStream({ endpoint, xToken, network }, ingestLaserStreamEvent);
      console.log(handle ? `[TRADING WORKER] Yellowstone gRPC ingestion active on ${network}.` : `[TRADING WORKER] Yellowstone gRPC unavailable on ${network}.`);
    }
  } catch (e) {
    console.warn('[TRADING WORKER] Yellowstone start warning:', e);
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
