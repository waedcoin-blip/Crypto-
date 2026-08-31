// server/routes/trading.ts
import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { criteriaRepository } from '../repositories/CriteriaRepository.js';
import { positionRepository } from '../repositories/PositionRepository.js';
import { orderRepository } from '../repositories/OrderRepository.js';
import { tradeRepository } from '../repositories/TradeRepository.js';
import { workerStateRepository } from '../repositories/WorkerStateRepository.js';

const router = Router();

// GET /api/trading/config
router.get('/config', asyncHandler(async (req, res) => {
  const criteria = await criteriaRepository.getActiveCriteria();
  const workerState = workerStateRepository.getWorkerState('trading');
  res.json({
    status: 'success',
    config: {
      ...criteria,
      buyAmountSol: Number(process.env.BUY_AMOUNT_SOL) || 0.1,
      minTakeProfit: Number(process.env.MIN_TAKE_PROFIT) || 25,
      maxTakeProfit: Number(process.env.MAX_TAKE_PROFIT) || 100,
      stopLoss: Number(process.env.STOP_LOSS) || 15,
      maxPositions: Number(process.env.MAX_POSITIONS) || 3,
    },
    isRunning: workerState?.status === 'RUNNING',
    rpcConfig: {
      search: !!process.env.SEARCH_RPC_URL,
      execution: !!process.env.EXECUTION_RPC_URL,
      monitor: !!process.env.MONITOR_RPC_URL,
    },
    timestamp: Date.now(),
  });
}));

// PUT /api/trading/config & POST /api/trading/config
const updateConfigHandler = asyncHandler(async (req, res) => {
  const patch = req.body;
  const updated = await criteriaRepository.updateCriteria(patch);
  res.json({
    status: 'success',
    config: updated,
    timestamp: Date.now(),
  });
});
router.put('/config', updateConfigHandler);
router.post('/config', updateConfigHandler);

// GET /api/trading/positions
router.get('/positions', asyncHandler(async (req, res) => {
  const openPositions = positionRepository.getOpenPositions();
  const allPositions = positionRepository.getAllPositions();
  res.json({
    status: 'success',
    openPositions,
    allPositions,
    timestamp: Date.now(),
  });
}));

// POST /api/trading/positions removed as it should be server-internal
// POST /api/trading/trades removed as it should be server-internal

// GET /api/trading/orders
router.get('/orders', asyncHandler(async (req, res) => {
  const orders = orderRepository.getOrders();
  res.json({
    status: 'success',
    orders,
    timestamp: Date.now(),
  });
}));

// GET /api/trading/trades
router.get('/trades', asyncHandler(async (req, res) => {
  const trades = tradeRepository.getTrades();
  res.json({
    status: 'success',
    trades,
    timestamp: Date.now(),
  });
}));



// GET /api/trading/status
router.get('/status', asyncHandler(async (req, res) => {
  const worker = workerStateRepository.getWorkerState('trading');
  res.json({
    status: 'success',
    workerState: worker || { worker: 'trading', status: 'STOPPED', lastHeartbeat: 0 },
    timestamp: Date.now(),
  });
}));

// POST /api/trading/start
router.post('/start', asyncHandler(async (req, res) => {
  await workerStateRepository.heartbeat({
    worker: 'trading',
    status: 'RUNNING',
    lastHeartbeat: Date.now(),
  });
  res.json({
    status: 'success',
    workerState: { worker: 'trading', status: 'RUNNING', lastHeartbeat: Date.now() },
    timestamp: Date.now(),
  });
}));

// POST /api/trading/stop
router.post('/stop', asyncHandler(async (req, res) => {
  await workerStateRepository.heartbeat({
    worker: 'trading',
    status: 'STOPPED',
    lastHeartbeat: Date.now(),
  });
  res.json({
    status: 'success',
    workerState: { worker: 'trading', status: 'STOPPED', lastHeartbeat: Date.now() },
    timestamp: Date.now(),
  });
}));

export default router;

