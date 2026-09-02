// server/routes/trading.ts
import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { tradingEngine } from '../trading/TradingEngine.js';
import { positionManager } from '../trading/PositionManager.js';
import { orderManager } from '../trading/OrderManager.js';
import { criteriaRepository } from '../repositories/CriteriaRepository.js';
import { workerStateRepository } from '../repositories/WorkerStateRepository.js';
import { tradeRepository } from '../repositories/TradeRepository.js';

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

// POST /api/trading/buy
router.post('/buy', asyncHandler(async (req, res) => {
  const { network, wallet, mint, amountSol, slippageBps, maxRebuyTimes, tradeOnlyOnce, clientRequestId, label, tpPct, slPct } = req.body;
  const response = await tradingEngine.buy({
    network: network || 'paper',
    wallet: wallet || 'default',
    mint,
    amountSol: Number(amountSol || 0.1),
    slippageBps: Number(slippageBps || 250),
    maxRebuyTimes: maxRebuyTimes !== undefined ? Number(maxRebuyTimes) : undefined,
    tradeOnlyOnce: tradeOnlyOnce !== undefined ? tradeOnlyOnce === true : undefined,
    clientRequestId,
    label,
    tpPct,
    slPct,
  });

  if (!response.success) {
    return res.status(400).json({ status: 'error', error: response.error });
  }

  res.json({ status: 'success', ...response, timestamp: Date.now() });
}));

// POST /api/trading/sell
router.post('/sell', asyncHandler(async (req, res) => {
  const { network, wallet, mint, amountRaw, slippageBps, clientRequestId, reason } = req.body;
  const response = await tradingEngine.sell({
    network: network || 'paper',
    wallet: wallet || 'default',
    mint,
    amountRaw: amountRaw !== undefined ? (typeof amountRaw === 'string' ? BigInt(amountRaw) : amountRaw) : undefined,
    slippageBps: slippageBps ? Number(slippageBps) : undefined,
    clientRequestId,
    reason,
  });

  if (!response.success) {
    return res.status(400).json({ status: 'error', error: response.error });
  }

  res.json({ status: 'success', ...response, timestamp: Date.now() });
}));

// GET /api/trading/positions
router.get('/positions', asyncHandler(async (req, res) => {
  const { network, wallet } = req.query;
  const openPositions = positionManager.getOpenPositions(network as string, wallet as string);
  const allPositions = positionManager.getAllPositions();
  res.json({
    status: 'success',
    openPositions,
    allPositions,
    timestamp: Date.now(),
  });
}));

// GET /api/trading/orders
router.get('/orders', asyncHandler(async (req, res) => {
  const { network, wallet, mint } = req.query;
  const orders = orderManager.getOrders({
    network: network as string,
    wallet: wallet as string,
    mint: mint as string,
  });
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
  const engineStatus = tradingEngine.getStatus();
  res.json({
    status: 'success',
    workerState: worker || { worker: 'trading', status: 'RUNNING', lastHeartbeat: Date.now() },
    engineStatus,
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
