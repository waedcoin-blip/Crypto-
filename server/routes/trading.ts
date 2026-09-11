// server/routes/trading.ts
import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { pnlEngine } from '../trading/PnLEngine.js';
import { orderManager } from '../trading/OrderManager.js';
import { priorityScheduler } from '../trading/PriorityScheduler.js';
import { positionValuationEngine } from '../trading/PositionValuationEngine.js';
import { tradingSupervisor } from '../trading/TradingSupervisor.js';
import { rebuyGuard } from '../trading/RebuyGuard.js';
import { tradingEngine } from '../trading/TradingEngine.js';
import { tradingConfigManager } from '../config/TradingConfig.js';
import { positionManager } from '../trading/PositionManager.js';

const router = Router();

// ============ TRADE EXECUTION (BUY / SELL) ============
// POST /api/trading/buy
router.post('/buy', asyncHandler(async (req: Request, res: Response) => {
  const result = await tradingEngine.buy(req.body);
  if (!result.success) {
    return res.status(400).json({ status: 'error', ...result });
  }
  res.json({ status: 'success', ...result, timestamp: Date.now() });
}));

// POST /api/trading/sell
router.post('/sell', asyncHandler(async (req: Request, res: Response) => {
  const result = await tradingEngine.sell(req.body);
  if (!result.success) {
    return res.status(400).json({ status: 'error', ...result });
  }
  res.json({ status: 'success', ...result, timestamp: Date.now() });
}));

// ============ POSITIONS & VALUATIONS ============
// GET /api/trading/positions
router.get('/positions', asyncHandler(async (req: Request, res: Response) => {
  const network = req.query.network as string | undefined;
  const wallet = req.query.wallet as string | undefined;
  const openPositions = positionManager.getOpenPositions(network, wallet);
  const allPositions = positionManager.getAllPositions();

  const enriched = openPositions.map(pos => {
    const val = positionValuationEngine.getValuation(pos.network, pos.wallet, pos.mint);
    const currentPriceSol = val?.currentPriceSol || pos.currentPrice || pos.averageEntryPrice || 0;
    const unrealizedPnlSol = val?.pnlSol ?? val?.executablePnlSol ?? (currentPriceSol > 0 && pos.averageEntryPrice > 0 ? (currentPriceSol - pos.averageEntryPrice) * pos.tokenAmount : 0);
    const unrealizedPnlPct = val?.pnlPercent ?? val?.executablePnlPercent ?? (pos.averageEntryPrice > 0 ? ((currentPriceSol - pos.averageEntryPrice) / pos.averageEntryPrice) * 100 : 0);

    return {
      ...pos,
      currentPriceSol,
      unrealizedPnlSol,
      unrealizedPnlPct,
    };
  });

  const currentPrices = new Map<string, number>();
  for (const pos of openPositions) {
    const val = positionValuationEngine.getValuation(pos.network, pos.wallet, pos.mint);
    if (val?.currentPriceSol) currentPrices.set(pos.mint, val.currentPriceSol);
  }
  const portfolioPnL = pnlEngine.calculatePortfolioPnL(openPositions, currentPrices);

  res.json({
    status: 'success',
    positions: enriched,
    allPositions,
    portfolioPnL,
    count: enriched.length,
    timestamp: Date.now(),
  });
}));

// ============ PORTFOLIO PNL ============
// GET /api/trading/portfolio/pnl
router.get('/portfolio/pnl', asyncHandler(async (_req: Request, res: Response) => {
  const openPositions = positionManager.getOpenPositions();
  const currentPrices = new Map<string, number>();
  for (const pos of openPositions) {
    const val = positionValuationEngine.getValuation(pos.network, pos.wallet, pos.mint);
    if (val?.currentPriceSol) currentPrices.set(pos.mint, val.currentPriceSol);
  }
  const portfolioPnL = pnlEngine.calculatePortfolioPnL(openPositions, currentPrices);
  res.json({ status: 'success', ...portfolioPnL, timestamp: Date.now() });
}));

// ============ ORDER RECOVERY ============
// GET /api/trading/orders/recovery
router.get('/orders/recovery', asyncHandler(async (_req: Request, res: Response) => {
  const recoveryOrders = orderManager.getOrdersByStatus('RECOVERY_REQUIRED');
  res.json({ status: 'success', count: recoveryOrders.length, orders: recoveryOrders, timestamp: Date.now() });
}));

// ============ SCHEDULER METRICS ============
// GET /api/trading/scheduler/metrics
router.get('/scheduler/metrics', asyncHandler(async (_req: Request, res: Response) => {
  const metrics = priorityScheduler.getMetrics();
  const details = priorityScheduler.getQueueDetails();
  res.json({ status: 'success', metrics, queueDetails: details, timestamp: Date.now() });
}));

// ============ FORCE REFRESH VALUATIONS ============
// POST /api/trading/valuations/refresh
router.post('/valuations/refresh', asyncHandler(async (_req: Request, res: Response) => {
  const openPositions = positionManager.getOpenPositions();
  await positionValuationEngine.forceRefreshAllQuotes(openPositions);
  res.json({ status: 'success', message: `Refreshed quotes for ${openPositions.length} open positions`, timestamp: Date.now() });
}));

// ============ TRADING SUPERVISOR LIFECYCLE ============
// GET /api/trading/supervisor/status
router.get('/supervisor/status', asyncHandler(async (_req: Request, res: Response) => {
  const status = tradingSupervisor.getStatus();
  res.json({ status: 'success', ...status, timestamp: Date.now() });
}));

// POST /api/trading/supervisor/start
router.post('/supervisor/start', asyncHandler(async (req: Request, res: Response) => {
  const result = await tradingSupervisor.startTrading(req.body);
  res.json({ status: 'success', supervisor: result, timestamp: Date.now() });
}));

// POST /api/trading/supervisor/stop
router.post('/supervisor/stop', asyncHandler(async (_req: Request, res: Response) => {
  const result = await tradingSupervisor.stopTrading();
  res.json({ status: 'success', supervisor: result, timestamp: Date.now() });
}));

// POST /api/trading/supervisor/recovery (Admin Override)
router.post('/supervisor/recovery', asyncHandler(async (req: Request, res: Response) => {
  const { reason = 'MANUAL_ADMIN_OVERRIDE' } = req.body || {};
  const result = tradingSupervisor.forceRecovery(reason);
  res.json({ status: 'success', supervisor: result, timestamp: Date.now() });
}));

// ============ REBUY GUARD ============
// GET /api/trading/rebuy-guard/:mint
router.get('/rebuy-guard/:mint', asyncHandler(async (req: Request, res: Response) => {
  const mint = req.params.mint;
  const network = (req.query.network as string) || 'mainnet';
  const wallet = (req.query.wallet as string) || 'default';
  const state = rebuyGuard.getGuardState(network, wallet, mint);
  const canBuy = rebuyGuard.canBuy({ network, wallet, mint });
  res.json({ status: 'success', mint, state, canBuy, timestamp: Date.now() });
}));

// ============ TRADING ENGINE STATUS ============
// GET /api/trading/engine/status
router.get('/engine/status', asyncHandler(async (_req: Request, res: Response) => {
  const status = tradingEngine.getEngineStatus();
  res.json({ status: 'success', ...status, timestamp: Date.now() });
}));

// ============ TRADING CONFIG MANAGEMENT ============
// GET /api/trading/config/manager
router.get('/config/manager', asyncHandler(async (_req: Request, res: Response) => {
  const cfg = tradingConfigManager.getConfig();
  res.json({
    status: 'success',
    config: {
      ...cfg,
      minimumNetProfitLamports: cfg.minimumNetProfitLamports.toString(),
      maxExposureLamports: cfg.maxExposureLamports.toString(),
      maxPositionLamports: cfg.maxPositionLamports.toString()
    },
    timestamp: Date.now()
  });
}));

// POST /api/trading/config/reset
router.post('/config/reset', asyncHandler(async (_req: Request, res: Response) => {
  const cfg = tradingConfigManager.resetToDefaults();
  res.json({ status: 'success', message: 'Trading config reset to safe defaults', timestamp: Date.now() });
}));

export default router;
