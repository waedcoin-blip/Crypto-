// server/trading/RiskManager.ts
import { Position, positionManager } from './PositionManager.js';
import { unifiedExitEngine, ExitDecision } from './UnifiedExitEngine.js';
import { tokenMetadataResolver } from '../market/TokenMetadataResolver.js';
import { profitabilityEngine } from './ProfitabilityEngine.js';
import { defaultTradingConfig } from '../config/TradingConfig.js';

export type { ExitDecision };

export interface BuyRevalidationResult {
  allowed: boolean;
  reason: string;
  verifiedDecimals?: number;
  executableNetProfitLamports?: bigint;
}

export class RiskManager {
  private static instance: RiskManager;
  private recentBuyTimestamps: Map<string, number> = new Map();

  private constructor() {}

  public static getInstance(): RiskManager {
    if (!RiskManager.instance) {
      RiskManager.instance = new RiskManager();
    }
    return RiskManager.instance;
  }

  /**
   * Mandatory Final Buy Revalidation Gate before transaction broadcast/signing.
   */
  public async revalidateBuyBeforeBroadcast(params: {
    mint: string;
    buyAmountLamports: bigint;
    network: string;
    wallet: string;
  }): Promise<BuyRevalidationResult> {
    const { mint, buyAmountLamports, network, wallet } = params;

    // 1. Re-check Cooldown & Position Limits
    const openPositions = positionManager.getOpenPositions(network, wallet);
    if (openPositions.length >= defaultTradingConfig.maxPositions) {
      return {
        allowed: false,
        reason: `MAX_POSITIONS_EXCEEDED: Open positions (${openPositions.length}) >= limit (${defaultTradingConfig.maxPositions})`,
      };
    }

    const lastBuy = this.recentBuyTimestamps.get(`${network}:${wallet}:${mint}`) || 0;
    if (Date.now() - lastBuy < defaultTradingConfig.cooldownMs) {
      return {
        allowed: false,
        reason: `COOLDOWN_ACTIVE: ${Date.now() - lastBuy}ms since last buy < ${defaultTradingConfig.cooldownMs}ms cooldown`,
      };
    }

    // 2. Re-check Mint & Decimals Verification
    const meta = await tokenMetadataResolver.resolveVerifiedMetadata(mint);
    if (!meta.isVerified) {
      return {
        allowed: false,
        reason: `UNVERIFIED_MINT_OR_DECIMALS: ${meta.reason || 'Failed to verify on-chain metadata'}`,
      };
    }

    // 3. Re-check Executable Quote & SOL Profitability
    const prof = await profitabilityEngine.evaluateExecutableProfitability(
      mint,
      buyAmountLamports,
      defaultTradingConfig.maxSlippageBps
    );

    if (prof.status !== 'AUTHORIZED') {
      return {
        allowed: false,
        reason: `PROFITABILITY_REVALIDATION_FAILED: ${prof.reason || prof.status}`,
      };
    }

    if (prof.quoteFreshnessMs > defaultTradingConfig.maxQuoteAgeMs) {
      return {
        allowed: false,
        reason: `QUOTE_STALE: Latency ${prof.quoteFreshnessMs}ms exceeds limit ${defaultTradingConfig.maxQuoteAgeMs}ms`,
      };
    }

    // Record buy timestamp for cooldown
    this.recentBuyTimestamps.set(`${network}:${wallet}:${mint}`, Date.now());

    return {
      allowed: true,
      reason: 'FINAL_REVALIDATION_PASSED',
      verifiedDecimals: meta.decimals,
      executableNetProfitLamports: prof.expectedNetProfitLamports,
    };
  }

  /**
   * Delegates exit locking/reservation to UnifiedExitEngine.
   */
  public reserveExit(positionId: string): boolean {
    const position = positionManager.getPositionById(positionId);
    if (!position) return false;
    return unifiedExitEngine.acquireExitLock(position.network, position.wallet, position.mint);
  }

  /**
   * Delegates releasing exit locking/reservation to UnifiedExitEngine.
   */
  public releaseExit(positionId: string): void {
    const position = positionManager.getPositionById(positionId);
    if (position) {
      unifiedExitEngine.releaseExitLock(position.network, position.wallet, position.mint);
    }
  }

  /**
   * Delegates position exit evaluations to UnifiedExitEngine.
   */
  public async evaluatePositionExit(
    position: Position,
    marketPriceSol: number
  ): Promise<ExitDecision> {
    return unifiedExitEngine.evaluatePositionExit(position, marketPriceSol);
  }
}

export const riskManager = RiskManager.getInstance();
