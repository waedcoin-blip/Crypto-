// server/routes/trading.ts
import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { tradingEngine } from '../trading/TradingEngine.js';
import { positionManager } from '../trading/PositionManager.js';
import { orderManager } from '../trading/OrderManager.js';
import { criteriaRepository } from '../repositories/CriteriaRepository.js';
import { workerStateRepository } from '../repositories/WorkerStateRepository.js';
import { tradeRepository } from '../repositories/TradeRepository.js';
import { entryEngine } from '../trading/EntryEngine.js';
import { unifiedExitEngine } from '../trading/UnifiedExitEngine.js';
import { positionValuationEngine } from '../trading/PositionValuationEngine.js';

import { CriteriaService } from '../services/criteriaService.js';

const router = Router();

// User-scoped criteria resolver helper
async function fetchCriteriaFromFirestore(userId?: string, idToken?: string): Promise<any> {
  if (userId && idToken) {
    try {
      const state = await CriteriaService.getInstance().fetchCriteriaFromFirestore(userId, idToken);
      if (state?.criteria) {
        return state.criteria;
      }
    } catch (e) {
      // Fall back to server repository if Firestore unreachable
    }
  }
  return criteriaRepository.getActiveCriteria();
}

// GET /api/trading/config
router.get('/config', asyncHandler(async (req, res) => {
  const userId = (req as any).user?.uid;
  const idToken = (req as any).idToken;
  const criteria = userId ? await fetchCriteriaFromFirestore(userId, idToken) : await criteriaRepository.getActiveCriteria();
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
  
  if (!network) {
    return res.status(400).json({ status: 'error', error: 'INVALID_NETWORK_EXPLICIT_REQUIRED: Network parameter is required and cannot be empty.' });
  }

  const response = await tradingEngine.buy({
    network,
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

  if (!network) {
    return res.status(400).json({ status: 'error', error: 'INVALID_NETWORK_EXPLICIT_REQUIRED: Network parameter is required and cannot be empty.' });
  }

  const response = await tradingEngine.sell({
    network,
    wallet: wallet || 'default',
    mint,
    amountRaw: amountRaw !== undefined ? Number(amountRaw) : undefined,
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

  const valuationsMap: Record<string, any> = {};
  for (const pos of openPositions) {
    const val = positionValuationEngine.getValuation(pos.network, pos.wallet, pos.mint);
    if (val) {
      valuationsMap[pos.mint] = val;
    }
  }

  res.json({
    status: 'success',
    openPositions,
    allPositions,
    valuations: valuationsMap,
    timestamp: Date.now(),
  });
}));

// POST /api/trading/positions/tpsl
router.post('/positions/tpsl', asyncHandler(async (req, res) => {
  const { mint, tpPct, slPct, trailingSlPct, network, wallet } = req.body;
  if (!mint) {
    return res.status(400).json({ status: 'error', error: 'mint is required' });
  }

  const updated = positionManager.updatePositionTpSl(
    network,
    wallet,
    mint,
    tpPct !== undefined ? Number(tpPct) : undefined,
    slPct !== undefined ? Number(slPct) : undefined,
    trailingSlPct !== undefined ? Number(trailingSlPct) : undefined
  );

  if (!updated) {
    return res.status(404).json({ status: 'error', error: `Position for ${mint} not found or already closed` });
  }

  res.json({
    status: 'success',
    position: updated,
    timestamp: Date.now(),
  });
}));

// GET /api/trading/valuations
router.get('/valuations', asyncHandler(async (req, res) => {
  const valuations = positionValuationEngine.getAllValuations();
  res.json({
    status: 'success',
    valuations,
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

import { tradingSupervisor } from '../trading/TradingSupervisor.js';

// GET /api/trading/status
router.get('/status', asyncHandler(async (req, res) => {
  const status = tradingSupervisor.getStatus();
  res.json({
    status: 'success',
    supervisorStatus: status,
    isRunning: status.state === 'TRADING',
    timestamp: Date.now(),
  });
}));

// POST /api/trading/start
router.post('/start', asyncHandler(async (req, res) => {
  const supervisorStatus = await tradingSupervisor.startTrading(req.body || {});
  if (supervisorStatus.state === 'START_FAILED') {
    return res.status(500).json({
      status: 'error',
      error: supervisorStatus.lastError || 'Trading engine start failed',
      supervisorStatus,
      timestamp: Date.now(),
    });
  }
  res.json({
    status: 'success',
    supervisorStatus,
    timestamp: Date.now(),
  });
}));

// POST /api/trading/stop
router.post('/stop', asyncHandler(async (req, res) => {
  const supervisorStatus = await tradingSupervisor.stopTrading();
  res.json({
    status: 'success',
    supervisorStatus,
    timestamp: Date.now(),
  });
}));

// GET /api/trading/entry-diagnostics
router.get('/entry-diagnostics', asyncHandler(async (req, res) => {
  const diagnostics = entryEngine.getDiagnostics();
  res.json({
    status: 'success',
    diagnostics,
    timestamp: Date.now(),
  });
}));

// GET /api/trading/exit-audit
router.get('/exit-audit', asyncHandler(async (req, res) => {
  const auditLogs = unifiedExitEngine.getAuditTrail();
  res.json({
    status: 'success',
    auditLogs,
    timestamp: Date.now(),
  });
}));

// GET /api/trading/exit-audit/:positionId
router.get('/exit-audit/:positionId', asyncHandler(async (req, res) => {
  const auditLogs = unifiedExitEngine.getAuditTrail(req.params.positionId);
  res.json({
    status: 'success',
    auditLogs,
    timestamp: Date.now(),
  });
}));

// POST /api/trading/evaluate
router.post('/evaluate', asyncHandler(async (req, res) => {
  const { mint, source } = req.body;
  if (!mint || typeof mint !== 'string') {
    return res.status(400).json({ status: 'error', error: 'mint address is required' });
  }
  const result = await entryEngine.evaluateAndTrade(mint, source || 'API_ON_DEMAND');
  res.json({
    status: 'success',
    result,
    timestamp: Date.now(),
  });
}));

// GET /api/trading/sniper-config
router.get('/sniper-config', asyncHandler(async (req, res) => {
  const config = entryEngine.getConfig();
  res.json({
    status: 'success',
    config,
    timestamp: Date.now(),
  });
}));

// POST /api/trading/sniper-config
router.post('/sniper-config', asyncHandler(async (req, res) => {
  const { autoSniperEnabled, isLiveTrading, network, wallet } = req.body;
  entryEngine.setConfig({
    autoSniperEnabled: autoSniperEnabled !== undefined ? Boolean(autoSniperEnabled) : undefined,
    isLiveTrading: isLiveTrading !== undefined ? Boolean(isLiveTrading) : undefined,
    network: typeof network === 'string' ? network : undefined,
    wallet: typeof wallet === 'string' ? wallet : undefined,
  });
  res.json({
    status: 'success',
    config: entryEngine.getConfig(),
    timestamp: Date.now(),
  });
}));

import { sourceHealthMonitor } from '../market/SourceHealthMonitor.js';
import { candidateRegistry } from '../market/CandidateRegistry.js';
import { CanonicalEventNormalizer } from '../market/CanonicalEventNormalizer.js';
import { marketEventBus } from '../market/MarketEventBus.js';
import { UnifiedMarketEvent } from '../types/index.js';

// POST /api/trading/pipeline/ingress
router.post('/pipeline/ingress', asyncHandler(async (req, res) => {
  const body = req.body;
  if (!body || !body.mint) {
    return res.status(400).json({ status: 'error', error: 'mint is required' });
  }

  const source = body.source || 'MANUAL';
  const event: UnifiedMarketEvent = {
    eventId: body.eventId || CanonicalEventNormalizer.generateEventId(source, body.mint, body.signature, body.slot, body.eventType),
    correlationId: body.correlationId || CanonicalEventNormalizer.generateCorrelationId(source, body.mint),
    chain: 'solana',
    source,
    mint: body.mint.trim(),
    signature: body.signature,
    slot: body.slot ? Number(body.slot) : undefined,
    timestamp: body.timestamp || Date.now(),
    eventType: body.eventType || 'TRADE',
    side: body.side,
    tokenAmount: body.tokenAmount ? String(body.tokenAmount) : undefined,
    solAmount: body.solAmount ? String(body.solAmount) : undefined,
    priceSol: body.priceSol ? Number(body.priceSol) : undefined,
    buyer: body.buyer,
    seller: body.seller,
    confidence: body.confidence !== undefined ? Number(body.confidence) : 1.0,
    symbol: body.symbol,
    pool: body.pool,
    protocol: body.protocol,
    network: body.network || 'mainnet',
    raw: body.raw,
  };

  marketEventBus.publishUnified(event);

  res.json({
    status: 'success',
    eventId: event.eventId,
    correlationId: event.correlationId,
    timestamp: Date.now(),
  });
}));

// GET /api/trading/pipeline/health
router.get('/pipeline/health', asyncHandler(async (req, res) => {
  const stats = sourceHealthMonitor.getSnapshot();
  res.json({
    status: 'success',
    sources: stats,
    timestamp: Date.now(),
  });
}));

// GET /api/trading/pipeline/candidates
router.get('/pipeline/candidates', asyncHandler(async (req, res) => {
  const candidates = candidateRegistry.getAllCandidates();
  res.json({
    status: 'success',
    count: candidates.length,
    candidates,
    timestamp: Date.now(),
  });
}));

export default router;
