// server/config/TradingConfig.ts
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

export const defaultTradingConfig: TradingConfig = {
  minimumNetProfitLamports: BigInt(process.env.MIN_NET_PROFIT_LAMPORTS || '1000000'), // 0.001 SOL
  minimumNetProfitPct: Number(process.env.MIN_NET_PROFIT_PCT || '0.5'), // 0.5%
  minimumRewardRiskRatio: Number(process.env.MIN_REWARD_RISK_RATIO || '1.5'),
  maxSlippageBps: Number(process.env.MAX_SLIPPAGE_BPS || '250'), // 2.5%
  maxPriceImpactBps: Number(process.env.MAX_PRICE_IMPACT_BPS || '500'), // 5.0%
  maxQuoteAgeMs: Number(process.env.MAX_QUOTE_AGE_MS || '5000'), // 5 seconds
  maxMarketDataAgeMs: Number(process.env.MAX_MARKET_DATA_AGE_MS || '15000'), // 15 seconds
  tpPct: Number(process.env.DEFAULT_TP_PCT || '25.0'), // +25%
  slPct: Number(process.env.DEFAULT_SL_PCT || '15.0'), // -15%
  trailingStopPct: Number(process.env.DEFAULT_TRAILING_STOP_PCT || '10.0'), // 10% from peak
  maxExposureLamports: BigInt(process.env.MAX_EXPOSURE_LAMPORTS || '1000000000'), // 1.0 SOL
  maxPositionLamports: BigInt(process.env.MAX_POSITION_LAMPORTS || '200000000'), // 0.2 SOL
  maxPositions: Number(process.env.MAX_POSITIONS || '3'),
  cooldownMs: Number(process.env.COOLDOWN_MS || '60000'), // 60 seconds
};

class TradingConfigManager {
  private static instance: TradingConfigManager;
  private currentConfig: TradingConfig;

  private constructor() {
    this.currentConfig = { ...defaultTradingConfig };
  }

  public static getInstance(): TradingConfigManager {
    if (!TradingConfigManager.instance) {
      TradingConfigManager.instance = new TradingConfigManager();
    }
    return TradingConfigManager.instance;
  }

  public getConfig(): TradingConfig {
    return { ...this.currentConfig };
  }

  public updateConfig(patch: Partial<TradingConfig>): TradingConfig {
    this.currentConfig = {
      ...this.currentConfig,
      ...patch,
    };
    return this.getConfig();
  }
}

export const tradingConfigManager = TradingConfigManager.getInstance();
