// server/trading/RiskManager.ts
import { positionManager } from './PositionManager.js';
import { tokenMetadataResolver } from '../market/TokenMetadataResolver.js';
import { profitabilityEngine } from './ProfitabilityEngine.js';
import { tradingConfigManager } from '../config/TradingConfig.js';
import { logger } from '../utils/logger.js';
export type { ExitDecision } from './UnifiedExitEngine.js';

export interface BuyRevalidationResult {
  allowed: boolean;
  reason: string;
  verifiedDecimals?: number;
  executableNetProfitLamports?: bigint;
}

export class RiskManager {
  private static instance: RiskManager;
  private recentBuyTimestamps: Map<string, number> = new Map();
  private buySuccessCount: number = 0;
  private buyFailureCount: number = 0;

  private constructor() {}

  public static getInstance(): RiskManager {
    if (!RiskManager.instance) {
      RiskManager.instance = new RiskManager();
    }
    return RiskManager.instance;
  }

  // ==========================================
  // FINAL REVALIDATION (Before Broadcast)
  // ==========================================

  public async revalidateBuyBeforeBroadcast(params: {
    mint: string;
    buyAmountLamports: bigint;
    network: string;
    wallet: string;
  }): Promise<BuyRevalidationResult> {
    const { mint, buyAmountLamports, network, wallet } = params;
    const config = tradingConfigManager.getConfig();

    // 1. Re-check Cooldown (Exempt rebuys/accumulation of existing positions)
    const cooldownKey = `${network}:${wallet}:${mint}`;
    const lastBuy = this.recentBuyTimestamps.get(cooldownKey) || 0;
    const hasPosition = positionManager.getOpenPositions(network, wallet).some(p => p.mint === mint);
    if (!hasPosition && Date.now() - lastBuy < config.cooldownMs) {
      return {
        allowed: false,
        reason: `COOLDOWN_ACTIVE: ${Date.now() - lastBuy}ms since last buy < ${config.cooldownMs}ms cooldown`,
      };
    }

    // 2. Re-check Max Positions
    const openPositions = positionManager.getOpenPositions(network, wallet);
    if (openPositions.length >= config.maxPositions) {
      return {
        allowed: false,
        reason: `MAX_POSITIONS_EXCEEDED: Open positions (${openPositions.length}) >= limit (${config.maxPositions})`,
      };
    }

    // In paper mode, bypass RPC calls and return verified paper metadata
    if (network === 'paper') {
      return {
        allowed: true,
        reason: 'FINAL_REVALIDATION_PASSED',
        verifiedDecimals: 6,
        executableNetProfitLamports: 1000000n,
      };
    }

    // 3. Re-check Mint & Decimals Verification
    try {
      const meta = await tokenMetadataResolver.resolveVerifiedMetadata(mint);
      if (!meta.isVerified) {
        return {
          allowed: false,
          reason: `UNVERIFIED_MINT_OR_DECIMALS: ${meta.reason || 'Failed to verify on-chain metadata'}`,
        };
      }

      // 4. Re-check Executable Quote & SOL Profitability

      // FIX: Added try-catch to prevent external service failures from crashing the buy pipeline
      let prof;
      try {
        prof = await profitabilityEngine.evaluateExecutableProfitability(
          mint,
          buyAmountLamports,
          config.maxSlippageBps
        );
      } catch (err: any) {
        return {
          allowed: false,
          reason: `PROFITABILITY_ENGINE_UNAVAILABLE: ${err?.message || 'Unknown error during profitability check'}`,
        };
      }

      if (prof.status !== 'AUTHORIZED') {
        return {
          allowed: false,
          reason: `PROFITABILITY_REVALIDATION_FAILED: ${prof.reason || prof.status}`,
        };
      }
      if (prof.quoteFreshnessMs > config.maxQuoteAgeMs) {
        return {
          allowed: false,
          reason: `QUOTE_STALE: Latency ${prof.quoteFreshnessMs}ms exceeds limit ${config.maxQuoteAgeMs}ms`,
        };
      }

      return {
        allowed: true,
        reason: 'FINAL_REVALIDATION_PASSED',
        verifiedDecimals: meta.decimals,
        executableNetProfitLamports: prof.expectedNetProfitLamports,
      };
    } catch (err: any) {
      return {
        allowed: false,
        reason: `REVALIDATION_ERROR: ${err?.message || String(err)}`,
      };
    }
  }

  // ==========================================
  // TELEMETRY
  // ==========================================

  public recordBuySuccess(network: string, wallet: string, mint: string): void {
    const key = `${network}:${wallet}:${mint}`;
    this.recentBuyTimestamps.set(key, Date.now());
    this.buySuccessCount++;
  }

  public recordBuyFailure(): void {
    this.buyFailureCount++;
  }

  public getTelemetry() {
    return {
      buySuccessCount: this.buySuccessCount,
      buyFailureCount: this.buyFailureCount,
      activeCooldowns: this.recentBuyTimestamps.size,
    };
  }
}

export const riskManager = RiskManager.getInstance();
