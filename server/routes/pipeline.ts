// server/routes/pipeline.ts
import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { sourceHealthMonitor } from '../market/SourceHealthMonitor.js';
import { candidateRegistry } from '../market/CandidateRegistry.js';
import { CanonicalEventNormalizer } from '../market/CanonicalEventNormalizer.js';
import { marketEventBus } from '../market/MarketEventBus.js';
import { UnifiedMarketEvent, EventSource } from '../types/index.js';

// INTEGRATION: Import shared engines
import { highFrequencyBuyDetector, TradeEvent } from '../../src/engines/highFrequencyBuyDetector.js'; 
import { validationEngine, TokenTelemetry } from '../../src/engines/MultiLayerValidationEngine.js';
import { riskAnalyzer } from '../../src/engines/riskAnalyzerEngine.js';
import { walletIntelligence } from '../../src/engines/walletIntelligence.js';
import { scannerEngine } from '../../src/engines/scannerEngine.js';
import { createTokenTelemetry } from '../../src/engines/telemetryMapper.js';
import { getAllCacheStats } from '../utils/cacheRegistry.js';

const router = Router();

const handleIngress = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body;
  
  // FIX: Robust validation ensures mint exists and is a string to prevent .trim() crashes
  if (!body || !body.mint || typeof body.mint !== 'string') {
    return res.status(400).json({ status: 'error', error: 'Valid string mint is required' });
  }

  // Safe casting for EventSource to prevent invalid string corruption downstream
  const VALID_EVENT_SOURCES = [
    'PULSE_FEED', 'LASERSTREAM', 'HELIUS_WSS', 'HELIUS_GRPC',
    'PUMP_FUN', 'DEXSCREENER', 'MANUAL', 'SIMULATION'
  ];
  const rawSource = String(body.source || 'MANUAL').toUpperCase();
  const source: EventSource = (VALID_EVENT_SOURCES.includes(rawSource) ? rawSource : 'MANUAL') as EventSource;

  const correlationId = body.correlationId || CanonicalEventNormalizer.generateCorrelationId(source, body.mint);
  const eventId = body.eventId || CanonicalEventNormalizer.generateEventId(source, body.mint, body.signature, body.slot, body.eventType);

  console.log(`[${source} RECEIVED] mint=${body.mint} source=${source} correlationId=${correlationId} timestamp=${Date.now()} reason="Ingress payload received"`);

  const event: UnifiedMarketEvent = {
    eventId,
    correlationId,
    chain: 'solana',
    source,
    mint: body.mint.trim(), // Safe now due to typeof check above
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

  // INTEGRATION: Feed trade into High Frequency Buy Detector for live, real-time analysis
  const tradeEvent: TradeEvent = {
    tokenAddress: event.mint,
    token: event.symbol,
    type: (event.side?.toLowerCase() === 'buy' ? 'buy' : 'sell') as 'buy' | 'sell',
    amount: event.tokenAmount ? parseFloat(event.tokenAmount) : 0,
    priceSol: event.priceSol,
    timestamp: event.timestamp,
    maker: event.buyer || event.seller,
  };
  highFrequencyBuyDetector.analyzeTrade(tradeEvent);

  res.json({
    status: 'success',
    eventId: event.eventId,
    correlationId: event.correlationId,
    timestamp: Date.now(),
  });
});

// ==========================================
// ROUTE DEFINITIONS
// ==========================================

// 1. Ingress endpoints (supports both explicit /ingress and root / for flexibility)
router.post('/ingress', handleIngress);
router.post('/', handleIngress);

// 2. Health check endpoint
router.get('/health', asyncHandler(async (req: Request, res: Response) => {
  const stats = sourceHealthMonitor.getSnapshot();
  res.json({ status: 'success', sources: stats, timestamp: Date.now() });
}));

// 3. Candidates list endpoint
router.get('/candidates', asyncHandler(async (req: Request, res: Response) => {
  const candidates = candidateRegistry.getAllCandidates();
  res.json({ status: 'success', count: candidates.length, candidates, timestamp: Date.now() });
}));

// 4. Validate token against MultiLayerValidationEngine
router.post('/validate', asyncHandler(async (req: Request, res: Response) => {
  const telemetry: TokenTelemetry = req.body;
  if (!telemetry || !telemetry.mintAddress || !telemetry.dexId) {
    return res.status(400).json({ status: 'error', error: 'Valid TokenTelemetry payload (mintAddress, dexId) is required' });
  }
  
  const result = validationEngine.validateTokenRoute(telemetry);
  res.json({ status: 'success', result, timestamp: Date.now() });
}));

// 5. Expose live state of the HighFrequencyBuyDetector
router.get('/detector-state', asyncHandler(async (req: Request, res: Response) => {
  const state = highFrequencyBuyDetector.getDetectorState();
  res.json({ status: 'success', state, timestamp: Date.now() });
}));

// 6. Get comprehensive status of ALL shared engines
router.get('/engines/status', asyncHandler(async (req: Request, res: Response) => {
  res.json({
    status: 'success',
    scanner: scannerEngine.getStatus(),
    walletIntelligence: {
      monitoredWallets: walletIntelligence.getMonitoredWallets()
    },
    riskAnalyzer: {
      activeTokens: riskAnalyzer.getAllRiskStates().length,
      states: riskAnalyzer.getAllRiskStates()
    },
    highFrequencyDetector: {
      activeBuffers: Object.keys(highFrequencyBuyDetector.getDetectorState()).length,
      state: highFrequencyBuyDetector.getDetectorState()
    },
    timestamp: Date.now()
  });
}));

// 7. Manually trigger risk analysis for a specific token
router.post('/analyze-risk', asyncHandler(async (req: Request, res: Response) => {
  const { address, riskScore, liquidity, marketCap, devOwnership } = req.body;
  if (!address) {
    return res.status(400).json({ status: 'error', error: 'Token address is required' });
  }
  
  const state = riskAnalyzer.analyzeToken({
    address,
    riskScore,
    liquidity,
    marketCap,
    devOwnership
  });
  
  res.json({ status: 'success', state, timestamp: Date.now() });
}));

// 8. Map raw DexScreener API data to TokenTelemetry schema
router.post('/telemetry', asyncHandler(async (req: Request, res: Response) => {
  const { mintAddress, apiResponse, bondingProgressOverride } = req.body;
  if (!mintAddress || !apiResponse) {
    return res.status(400).json({ status: 'error', error: 'mintAddress and apiResponse are required' });
  }
  
  const telemetry = createTokenTelemetry(mintAddress, apiResponse, bondingProgressOverride);
  if (!telemetry) {
    return res.status(404).json({ status: 'error', error: 'No valid pairs found in API response' });
  }
  
  res.json({ status: 'success', telemetry, timestamp: Date.now() });
}));

// 9. Get comprehensive cache statistics
router.get('/cache/stats', asyncHandler(async (req: Request, res: Response) => {
  const stats = getAllCacheStats();
  res.json({ 
    status: 'success', 
    caches: stats, 
    timestamp: Date.now() 
  });
}));

export default router;