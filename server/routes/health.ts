/**
 * Health check endpoint
 */
import { Router } from 'express';
import { fetchWithTimeout } from '../utils/fetch.js';
import { getJupiterApiKey, getHeliusApiKey } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import type { HealthCheck } from '../types/index.js';

import { workerStateRepository } from '../repositories/WorkerStateRepository.js';
import { getLaserStreamTelemetry } from '../engines/LaserstreamIngestion.js';

const router = Router();

// Fast liveness probe for deployment platforms (Render, Cloud Run, K8s)
router.get('/ping', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

router.get('/', asyncHandler(async (req, res) => {
  const checks: Record<string, string> = {};
  const workerState = workerStateRepository.getWorkerState('trading');
  const laser = getLaserStreamTelemetry();

  const now = Date.now();
  const workerHeartbeatAgeMs = workerState ? now - workerState.lastHeartbeat : Infinity;
  const isWorkerHealthy = workerState && workerState.status === 'RUNNING' && workerHeartbeatAgeMs < 15000;

  // Check Jupiter Quote API
  try {
    const jupKey = getJupiterApiKey();
    const testUrl = 
      'https://api.jup.ag/swap/v1/quote' +
      '?inputMint=So11111111111111111111111111111111111111112' +
      '&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' +
      '&amount=1000000&slippageBps=50' +
      '&restrictIntermediateTokens=true';

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (jupKey) headers['x-api-key'] = jupKey;

    const resp = await fetchWithTimeout(testUrl, { headers }, 5000);
    checks.jupiter = resp.ok ? 'OK' : `Error ${resp.status}`;
  } catch (err: any) {
    checks.jupiter = `Failed: ${err.message}`;
  }

  // Check DEXScreener
  try {
    const resp = await fetchWithTimeout(
      'https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112',
      {},
      5000
    );
    checks.dexscreener = resp.ok ? 'OK' : `Error ${resp.status}`;
  } catch (err: any) {
    checks.dexscreener = `Failed: ${err.message}`;
  }

  // Check Helius
  const heliusKey = getHeliusApiKey();
  if (heliusKey) {
    try {
      const resp = await fetchWithTimeout(
        `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
        },
        5000
      );
      checks.helius = resp.ok ? 'OK' : `Error ${resp.status}`;
    } catch (err: any) {
      checks.helius = `Failed: ${err.message}`;
    }
  } else {
    checks.helius = 'No API key configured';
  }

  const allOk = Object.entries(checks).every(([k, v]) => {
    if (k === 'helius' && v.startsWith('No API key')) return true;
    return v === 'OK';
  });

  const result = {
    web: 'healthy',
    tradingWorker: isWorkerHealthy ? 'healthy' : 'unhealthy',
    lastWorkerHeartbeat: workerState?.lastHeartbeat || 0,
    laserstream: {
      status: laser.status,
      transportConnected: laser.transportConnected,
      slotLag: laser.slotLag,
      queueDepth: laser.queueDepth,
      lastReceivedSlot: laser.lastReceivedSlot,
      lastProcessedSlot: laser.lastProcessedSlot,
      processingDurationMs: laser.processingLagMs,
      ingestionState: laser.ingestionState || 'idle',
    },
    monitor: isWorkerHealthy ? 'healthy' : 'degraded',
    execution: 'healthy',
    reconciliation: 'healthy',
    status: allOk && isWorkerHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    checks,
  };

  res.status(200).json(result);
}));

// Dedicated Render / K8s / Cloud Run Trading Worker health check endpoint
router.get('/trading', asyncHandler(async (req, res) => {
  const workerState = workerStateRepository.getWorkerState('trading');
  const now = Date.now();
  const workerHeartbeatAgeMs = workerState ? now - workerState.lastHeartbeat : Infinity;
  const isHeartbeatFresh = workerState && workerState.status === 'RUNNING' && workerHeartbeatAgeMs <= 30000;

  const { positionRepository } = await import('../repositories/PositionRepository.js');
  const { orderRepository } = await import('../repositories/OrderRepository.js');

  const laser = getLaserStreamTelemetry();
  const laserHealthy = !laser.transportConnected || (
    laser.status === 'connected' ||
    laser.status === 'degraded' ||
    laser.status === 'replaying'
  );

  const recoveryPositions = positionRepository.getOpenPositions().filter(p => p.state === 'RECOVERY_REQUIRED');
  const recoveryOrders = orderRepository.getOrders().filter(o => o.state === 'RECOVERY_REQUIRED');

  const isHealthy = isHeartbeatFresh && laserHealthy && recoveryPositions.length === 0 && recoveryOrders.length === 0;

  const payload = {
    healthy: isHealthy,
    status: isHealthy ? 'healthy' : 'unhealthy',
    workerHeartbeatAgeMs,
    workerStatus: workerState?.status || 'STOPPED',
    laserstream: {
      status: laser.status,
      transportConnected: laser.transportConnected,
      lastReceivedSlot: laser.lastReceivedSlot,
      lastProcessedSlot: laser.lastProcessedSlot,
      slotLag: laser.slotLag,
      queueDepth: laser.queueDepth,
      processingDurationMs: laser.processingLagMs,
      ingestionState: laser.ingestionState || 'idle',
    },
    recoveryPositionsCount: recoveryPositions.length,
    recoveryOrdersCount: recoveryOrders.length,
    timestamp: new Date().toISOString(),
  };

  if (!isHealthy) {
    return res.status(503).json(payload);
  }
  return res.status(200).json(payload);
}));

export default router;
