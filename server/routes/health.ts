// server/routes/health.ts
import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { workerStateRepository } from '../repositories/WorkerStateRepository.js';
import { sourceHealthMonitor } from '../market/SourceHealthMonitor.js';
import { cacheRegistry } from '../utils/cacheRegistry.js';
import { tradingSupervisor } from '../trading/TradingSupervisor.js';
import { marketEventBus } from '../market/MarketEventBus.js';
import { candidateRegistry } from '../market/CandidateRegistry.js';

const router = Router();

/**
 * GET /api/health
 * Comprehensive system health check.
 */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const supervisorStatus = tradingSupervisor.getStatus();
  const workerStates = workerStateRepository.getAllWorkerStates();
  const sourceHealth = sourceHealthMonitor.getSnapshot();
  const busTelemetry = marketEventBus.getTelemetry();
  const candidateTelemetry = candidateRegistry.getTelemetry();

  // Determine overall system health
  const tradingWorkerHealthy = workerStateRepository.isWorkerHealthy('trading');
  const isTrading = supervisorStatus.state === 'TRADING';

  res.json({
    status: 'success',
    system: {
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      timestamp: Date.now(),
    },
    trading: {
      supervisorState: supervisorStatus.state,
      network: supervisorStatus.network,
      isLiveTrading: supervisorStatus.isLiveTrading,
      healthMap: supervisorStatus.healthMap,
    },
    workers: workerStates,
    sources: sourceHealth,
    eventBus: busTelemetry,
    candidates: candidateTelemetry,
    caches: Object.fromEntries(
      Object.entries(cacheRegistry).map(([name, cache]) => [name, cache.getStats()])
    ),
    overall: {
      trading: tradingWorkerHealthy && isTrading ? 'healthy' : 'degraded',
      timestamp: Date.now(),
    },
  });
}));

/**
 * GET /api/health/quick
 * Lightweight health check for load balancers.
 */
router.get('/quick', asyncHandler(async (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: Date.now() });
}));

// Fast liveness probe for deployment platforms
router.get('/ping', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

export default router;
