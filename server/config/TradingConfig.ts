/**
 * Centralized Authoritative Trading Configuration (SOL-Only, Lamports & Percentages)
 * Strictly avoids hard-coded USD rates and floating-point conversion fallbacks.
 */

export interface TradingConfig {
  minimumNetProfitLamports: bigint;
  minimumNetProfitPct: number;
  minimumRewardRiskRatio: number;
  maxSlippageBps: number;
  maxPriceImpactBps: number;
  maxQuoteAgeMs: number;
  maxMarketDataAgeMs: number;
  tpPct: number;
  slPct: number;
  trailingStopPct: number;
  maxExposureLamports: bigint;
  maxPositionLamports: bigint;
  maxPositions: number;
  cooldownMs: number;
}

// FIX: Safe parsing helpers prevent startup crashes from malformed .env strings
const safeBigInt = (value: string | undefined, fallback: string): bigint => {
  try { const val = value?.trim(); return val ? BigInt(val) : BigInt(fallback); }
  catch { return BigInt(fallback); }
};
const safeNumber = (value: string | undefined, fallback: number): number => {
  try {
    const val = value?.trim();
    const parsed = val ? Number(val) : fallback;
    return Number.isNaN(parsed) ? fallback : parsed;
  } catch { return fallback; }
};

export const defaultTradingConfig: TradingConfig = {
  minimumNetProfitLamports: safeBigInt(process.env.MIN_NET_PROFIT_LAMPORTS, '1000000'),
  minimumNetProfitPct: safeNumber(process.env.MIN_NET_PROFIT_PCT, 0.5),
  minimumRewardRiskRatio: safeNumber(process.env.MIN_REWARD_RISK_RATIO, 1.5),
  maxSlippageBps: safeNumber(process.env.MAX_SLIPPAGE_BPS, 250),
  maxPriceImpactBps: safeNumber(process.env.MAX_PRICE_IMPACT_BPS, 500),
  maxQuoteAgeMs: safeNumber(process.env.MAX_QUOTE_AGE_MS, 5000),
  maxMarketDataAgeMs: safeNumber(process.env.MAX_MARKET_DATA_AGE_MS, 15000),
  tpPct: safeNumber(process.env.DEFAULT_TP_PCT, 25.0),
  slPct: safeNumber(process.env.DEFAULT_SL_PCT, 15.0),
  trailingStopPct: safeNumber(process.env.DEFAULT_TRAILING_STOP_PCT, 10.0),
  maxExposureLamports: safeBigInt(process.env.MAX_EXPOSURE_LAMPORTS, '1000000000'),
  maxPositionLamports: safeBigInt(process.env.MAX_POSITION_LAMPORTS, '200000000'),
  maxPositions: safeNumber(process.env.MAX_POSITIONS, 3),
  cooldownMs: safeNumber(process.env.COOLDOWN_MS, 60000),
};

class TradingConfigManager {
  private static instance: TradingConfigManager;
  private currentConfig: TradingConfig;
  private constructor() { this.currentConfig = { ...defaultTradingConfig }; }
  public static getInstance(): TradingConfigManager {
    if (!TradingConfigManager.instance) TradingConfigManager.instance = new TradingConfigManager();
    return TradingConfigManager.instance;
  }
  public getConfig(): TradingConfig { return { ...this.currentConfig }; }
  public updateConfig(patch: Partial<TradingConfig>): TradingConfig {
    this.currentConfig = { ...this.currentConfig, ...patch };
    return this.getConfig();
  }
  // NEW: Emergency reset to safe defaults
  public resetToDefaults(): TradingConfig {
    this.currentConfig = { ...defaultTradingConfig };
    return this.getConfig();
  }
}

export const tradingConfigManager = TradingConfigManager.getInstance();