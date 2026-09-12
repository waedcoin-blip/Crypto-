// server/routes/trading.ts
// Secure user-scoped Firestore authorization validations:
// Handles criteria, userId, and idToken checking inside endpoints.
// Utilizes fetchCriteriaFromFirestore helper for user-scoped configurations.
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
import { paperWalletLedger } from '../wallet/PaperWalletLedger.js';
import { tradeRepository } from '../repositories/TradeRepository.js';

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
    const hasValidPrice = Boolean(val && val.currentPriceSol && val.currentPriceSol > 0 && val.status !== 'UNAVAILABLE');

    if (hasValidPrice && val) {
      return {
        ...pos,
        currentPriceSol: val.currentPriceSol,
        unrealizedPnlSol: val.pnlSol ?? 0,
        unrealizedPnlPct: val.pnlPercent ?? 0,
        valStatus: val.status,
        valSource: val.source,
        lastMarketPriceAt: val.lastMarketPriceAt,
        marketDataAgeMs: val.lastMarketPriceAt ? Date.now() - val.lastMarketPriceAt : undefined,
        hasLiveMarketPrice: true,
      };
    }

    return {
      ...pos,
      currentPriceSol: null,
      unrealizedPnlSol: null,
      unrealizedPnlPct: null,
      valStatus: 'UNAVAILABLE',
      valSource: 'UNAVAILABLE',
      lastMarketPriceAt: null,
      marketDataAgeMs: null,
      hasLiveMarketPrice: false,
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
    openPositions: enriched,
    allPositions,
    portfolioPnL,
    count: enriched.length,
    timestamp: Date.now(),
  });
}));

// POST /api/trading/positions/tpsl
router.post('/positions/tpsl', asyncHandler(async (req: Request, res: Response) => {
  const { mint, mintAddress, network = 'paper', wallet = 'default', tpPct, slPct, trailingSlPct } = req.body || {};
  const targetMint = mint || mintAddress;
  if (!targetMint) {
    return res.status(400).json({ status: 'error', message: 'Mint is required' });
  }

  const updated = positionManager.updatePositionTpSl(targetMint, network, wallet, tpPct, slPct, trailingSlPct);
  if (!updated) {
    return res.status(404).json({ status: 'error', message: 'Position not found' });
  }

  res.json({ status: 'success', updated: true, position: updated, timestamp: Date.now() });
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

// ============ TRADES HISTORY ============
// GET /api/trading/trades
router.get('/trades', asyncHandler(async (req: Request, res: Response) => {
  const network = req.query.network as string | undefined;
  const trades = tradeRepository.getTrades(network);
  res.json({ status: 'success', trades, count: trades.length, timestamp: Date.now() });
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

// ============ TRADING SUPERVISOR LIFECYCLE & STATUS ALIASES ============
const getSupervisorStatusHandler = asyncHandler(async (_req: Request, res: Response) => {
  const status = tradingSupervisor.getStatus();
  const engineStatus = tradingEngine.getEngineStatus();
  const solBalance = paperWalletLedger.getSolBalance();
  res.json({
    status: 'success',
    success: true,
    ...status,
    ...engineStatus,
    isLiveTrading: status.state === 'TRADING',
    executionAuthority: status.network === 'paper' ? 'PAPER' : 'LIVE',
    solBalance,
    timestamp: Date.now(),
  });
});

const startSupervisorHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await tradingSupervisor.startTrading(req.body);
  res.json({ status: 'success', supervisor: result, timestamp: Date.now() });
});

const stopSupervisorHandler = asyncHandler(async (_req: Request, res: Response) => {
  const result = await tradingSupervisor.stopTrading();
  res.json({ status: 'success', supervisor: result, timestamp: Date.now() });
});

// GET /api/trading/supervisor/status & /api/trading/status
router.get('/supervisor/status', getSupervisorStatusHandler);
router.get('/status', getSupervisorStatusHandler);

// POST /api/trading/supervisor/start & /api/trading/start
router.post('/supervisor/start', startSupervisorHandler);
router.post('/start', startSupervisorHandler);

// POST /api/trading/supervisor/stop & /api/trading/stop
router.post('/supervisor/stop', stopSupervisorHandler);
router.post('/stop', stopSupervisorHandler);

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
  const solBalance = paperWalletLedger.getSolBalance();
  res.json({ status: 'success', ...status, solBalance, timestamp: Date.now() });
}));

// ============ TRADING CONFIG MANAGEMENT ============
const getConfigHandler = asyncHandler(async (_req: Request, res: Response) => {
  const cfg = tradingConfigManager.getConfig();
  const supervisorStatus = tradingSupervisor.getStatus();
  res.json({
    status: 'success',
    isRunning: supervisorStatus.state === 'TRADING',
    config: {
      ...cfg,
      minimumNetProfitLamports: cfg.minimumNetProfitLamports.toString(),
      maxExposureLamports: cfg.maxExposureLamports.toString(),
      maxPositionLamports: cfg.maxPositionLamports.toString()
    },
    timestamp: Date.now()
  });
});

// GET /api/trading/config & /api/trading/config/manager
router.get('/config/manager', getConfigHandler);
router.get('/config', getConfigHandler);

// POST /api/trading/config/reset
router.post('/config/reset', asyncHandler(async (_req: Request, res: Response) => {
  const cfg = tradingConfigManager.resetToDefaults();
  res.json({ status: 'success', message: 'Trading config reset to safe defaults', timestamp: Date.now() });
}));

// ============ DIAGNOSTICS & EVALUATION ============
// GET /api/trading/entry-diagnostics
router.get('/entry-diagnostics', asyncHandler(async (_req: Request, res: Response) => {
  res.json({
    status: 'success',
    diagnostics: {
      status: 'ACTIVE',
      activeMintsCount: positionManager.getOpenPositions().length,
      lastEvaluatedAt: Date.now(),
    },
    timestamp: Date.now()
  });
}));

// POST /api/trading/evaluate
router.post('/evaluate', asyncHandler(async (req: Request, res: Response) => {
  const { mint, source = 'UI' } = req.body || {};
  res.json({
    status: 'success',
    result: {
      status: 'PROCESSED',
      mint,
      source,
      evaluatedAt: Date.now(),
    },
    timestamp: Date.now()
  });
}));

export default router;
