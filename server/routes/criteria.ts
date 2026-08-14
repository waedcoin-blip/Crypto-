import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

// In-memory runtime state for live criteria and trade size
let currentCriteriaConfig: Record<string, any> = {
  buyAmountSol: 0.1,
  hardenedMcapMinPump: 40000,
  hardenedMcapMinRaydium: 80000,
  hardenedMcapMax: 3000000,
  hardenedLiquidityMin: 20000,
  hardenedLiquidityRatio: 5,
  hardenedMaxRiskScore: 18,
  hardenedMaxDevOwnership: 10,
  hardenedMaxTop10: 25.0,
  hardenedMinUniqueBuyers30s: 4,
  hardenedMinBuyCount30s: 5,
  hardenedMaxBuyCount30s: 30,
  hardenedMinBuySellRatio: 2.0,
  hardenedMaxBuySellRatio: 10.0,
  hardenedMaxPriceChange1m: 15.0,
  hardenedMinBondingProgress: 65,
  hardenedMaxBondingProgress: 100,
  hardenedMinAge: 0,
  hardenedMaxAge: 240,
  hardenedMinLatency: 0,
  hardenedMaxLatency: 250,
  hardenedMatchRequirement: 100,
  enableLatencyGuard: true,
  telemetryWhaleBuyMin: 500000,
  telemetryHighBuyMin: 100000,
  telemetryVolumeSpikeMin: 1000,
  telemetryAllowWhaleBuy: true,
  telemetryAllowHighBuy: true,
  telemetryAllowVolumeSpike: true,
  telemetryAllowMigrated: true,
  telemetryAllowGoldenCross: true,
  tradePumpFun: true,
  tradeRaydium: true,
  tradeBonding: true,
  tradeUnknown: true,
  hardenedMinProfit5m: 1.5,
  maxRebuyTimes: 1,
  minTakeProfit: 25,
  maxTakeProfit: 45,
  bondingCurveTakeProfit: 25,
  stopLoss: -30,
  bondingCurveStopLoss: -30,
  pumpSwapStopLoss: -30,
  unknownStopLoss: -30,
  maxPositions: 5,
  slippage: 1.0,
  activePreset: 'custom',
  updatedAt: new Date().toISOString(),
  lastSyncedAt: Date.now()
};

// GET /api/criteria or /api/config
router.get('/', (req, res) => {
  res.json({
    status: 'success',
    config: currentCriteriaConfig,
    timestamp: Date.now()
  });
});

// POST /api/criteria or /api/config
router.post('/', asyncHandler(async (req, res) => {
  const incoming = req.body || {};
  
  // Merge incoming criteria and trade size fields
  currentCriteriaConfig = {
    ...currentCriteriaConfig,
    ...incoming,
    updatedAt: new Date().toISOString(),
    lastSyncedAt: Date.now()
  };

  console.log(`[CRITERIA & TRADE SIZE SYNC] Updated live config on backend: buyAmountSol=${currentCriteriaConfig.buyAmountSol}, PumpMinMcap=${currentCriteriaConfig.hardenedMcapMinPump}, RayMinMcap=${currentCriteriaConfig.hardenedMcapMinRaydium}`);

  res.json({
    status: 'success',
    message: 'Criteria and trade size successfully updated on backend',
    config: currentCriteriaConfig,
    timestamp: Date.now()
  });
}));

export default router;
