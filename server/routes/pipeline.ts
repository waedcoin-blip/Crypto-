// server/routes/pipeline.ts
import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { sourceHealthMonitor } from '../market/SourceHealthMonitor.js';
import { candidateRegistry } from '../market/CandidateRegistry.js';
import { CanonicalEventNormalizer } from '../market/CanonicalEventNormalizer.js';
import { marketEventBus } from '../market/MarketEventBus.js';
import { entryEngine } from '../trading/EntryEngine.js';
import { UnifiedMarketEvent, EventSource } from '../types/index.js';

const router = Router();

const handleIngress = asyncHandler(async (req, res) => {
  const body = req.body;
  if (!body || !body.mint) {
    return res.status(400).json({ status: 'error', error: 'mint is required' });
  }

  const source: EventSource = (body.source || 'MANUAL') as EventSource;
  const correlationId = body.correlationId || CanonicalEventNormalizer.generateCorrelationId(source, body.mint);
  const eventId = body.eventId || CanonicalEventNormalizer.generateEventId(source, body.mint, body.signature, body.slot, body.eventType);

  console.log(`[${source} RECEIVED] mint=${body.mint} source=${source} correlationId=${correlationId} timestamp=${Date.now()} reason="Ingress payload received"`);

  const event: UnifiedMarketEvent = {
    eventId,
    correlationId,
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

  console.log(`[${source} NORMALIZED] mint=${event.mint} source=${source} correlationId=${correlationId} timestamp=${Date.now()} reason="Canonical event created"`);

  // Publish to Authoritative Market Event Bus
  marketEventBus.publishUnified(event);

  res.json({
    status: 'success',
    eventId: event.eventId,
    correlationId: event.correlationId,
    timestamp: Date.now(),
  });
});

// Ingress endpoints
router.post('/ingress', handleIngress);
router.post('/', handleIngress);

// Health
router.get('/health', asyncHandler(async (req, res) => {
  const stats = sourceHealthMonitor.getSnapshot();
  res.json({
    status: 'success',
    sources: stats,
    timestamp: Date.now(),
  });
}));

// Candidates
router.get('/candidates', asyncHandler(async (req, res) => {
  const candidates = candidateRegistry.getAllCandidates();
  res.json({
    status: 'success',
    count: candidates.length,
    candidates,
    timestamp: Date.now(),
  });
}));

// Manual on-demand evaluation
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

export default router;
