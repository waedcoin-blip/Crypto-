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

// Well-known non-mint addresses that should never be treated as a discovered
// token candidate, even though they legitimately appear in every DEX transaction.
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const COMPUTE_BUDGET_PROGRAM_ID = 'ComputeBudget111111111111111111111111111';
const RENT_SYSVAR_ID = 'SysvarRent111111111111111111111111111111';
const KNOWN_NON_MINT_ADDRESSES = new Set<string>([
  SystemProgram.programId.toBase58(),
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  WSOL_MINT,
  COMPUTE_BUDGET_PROGRAM_ID,
  RENT_SYSVAR_ID,
  ...DEFAULT_NETWORK_PROGRAMS.mainnet,
]);

// Ingest a normalized LaserStream event: pull out plausible token mints touched
// by the transaction and persist them so the trading worker's discovery/search
// pipeline actually has something to read, instead of discarding every update.
function ingestLaserStreamEvent(event: SseEvent): void {
  try {
    if (event.type !== 'ON_CHAIN_TX' || event.err) return;

    const accountKeys = Array.isArray(event.accountKeys) ? (event.accountKeys as string[]) : [];
    if (accountKeys.length === 0) return;

    const network = typeof event.network === 'string' ? event.network : 'mainnet';
    const observedAt = typeof event.observationTimestamp === 'number' ? event.observationTimestamp : Date.now();

    for (const mintAddress of accountKeys) {
      if (!mintAddress || KNOWN_NON_MINT_ADDRESSES.has(mintAddress)) continue;

      const existing = tokenRepository.getToken(mintAddress);
      tokenRepository.upsertToken({
        mintAddress,
        network,
        discoveredAt: existing?.discoveredAt ?? observedAt,
        updatedAt: observedAt,
        signal: existing?.signal ?? 'LASERSTREAM_ON_CHAIN_TX',
        metadata: {
          ...(existing?.metadata || {}),
          lastSignature: event.signature,
          lastSlot: event.slot,
        },
      });
    }
  } catch (err) {
    laserLogger.error({ error: err }, '[TRADING WORKER] Failed to ingest LaserStream event');
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

  // 5. Start LaserStream gRPC Ingestion
  try {
    if (config.HELIUS_API_KEY) {
      await startLaserStream(
        { apiKey: config.HELIUS_API_KEY, network: 'mainnet' },
        ingestLaserStreamEvent
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
