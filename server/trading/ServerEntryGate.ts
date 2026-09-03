// server/trading/ServerEntryGate.ts
import { EnrichedCandidate } from './CandidateEnricher.js';
import { CriteriaConfig, DEFAULT_CRITERIA } from '../services/criteriaService.js';
import { positionManager } from './PositionManager.js';
import { rebuyGuard } from './RebuyGuard.js';
import { executionGateway } from '../execution/ExecutionGateway.js';

export interface CriterionCheckResult {
  pass: boolean;
  actualValue?: string | number | boolean;
  threshold?: string | number | boolean;
  reason: string;
}

export interface ServerEntryDecision {
  allowed: boolean;
  decision: 'BUY' | 'BLOCK';
  mintAddress: string;
  symbol: string;
  buyAmountSol: number;
  criteriaResults: Record<string, CriterionCheckResult>;
  blockingReasons: string[];
  evaluatedAt: number;
}

export class ServerEntryGate {
  private static instance: ServerEntryGate;

  private constructor() {}

  public static getInstance(): ServerEntryGate {
    if (!ServerEntryGate.instance) {
      ServerEntryGate.instance = new ServerEntryGate();
    }
    return ServerEntryGate.instance;
  }

  public async evaluateEntry(params: {
    candidate: EnrichedCandidate;
    criteria?: Partial<CriteriaConfig>;
    network: string;
    wallet: string;
    autoSniperEnabled: boolean;
  }): Promise<ServerEntryDecision> {
    const { candidate, network, wallet, autoSniperEnabled } = params;
    const config: CriteriaConfig = { ...DEFAULT_CRITERIA, ...(params.criteria || {}) };
    const criteriaResults: Record<string, CriterionCheckResult> = {};
    const blockingReasons: string[] = [];
    const mint = candidate.mintAddress.trim();

    // 1. Mint Validity
    if (!mint || mint === 'So11111111111111111111111111111111111111112' || mint.length < 32 || mint.length > 44) {
      const r = { pass: false, actualValue: mint, reason: 'INVALID_MINT_ADDRESS' };
      criteriaResults['MINT_VALIDITY'] = r;
      blockingReasons.push(r.reason);
    } else {
      criteriaResults['MINT_VALIDITY'] = { pass: true, actualValue: mint, reason: 'VALID_MINT' };
    }

    // 2. Auto Sniper Enabled
    if (!autoSniperEnabled) {
      const r = { pass: false, actualValue: autoSniperEnabled, threshold: true, reason: 'AUTO_SNIPER_DISABLED' };
      criteriaResults['AUTO_SNIPER'] = r;
      blockingReasons.push(r.reason);
    } else {
      criteriaResults['AUTO_SNIPER'] = { pass: true, actualValue: true, threshold: true, reason: 'AUTO_SNIPER_ENABLED' };
    }

    // 3. Max Positions Limit
    const maxPositions = config.maxPositions ?? 5;
    const currentPositions = positionManager.getOpenPositions(network, wallet).length;
    if (maxPositions > 0 && currentPositions >= maxPositions) {
      const r = {
        pass: false,
        actualValue: currentPositions,
        threshold: maxPositions,
        reason: `MAX_POSITIONS_REACHED: ${currentPositions}/${maxPositions}`,
      };
      criteriaResults['MAX_POSITIONS'] = r;
      blockingReasons.push(r.reason);
    } else {
      criteriaResults['MAX_POSITIONS'] = {
        pass: true,
        actualValue: currentPositions,
        threshold: maxPositions,
        reason: `POSITIONS_AVAILABLE: ${currentPositions}/${maxPositions}`,
      };
    }

    // 4. Platform Filter
    const isPumpFun = candidate.dexId.includes('pump') || mint.toLowerCase().endsWith('pump');
    const isRaydium = candidate.dexId.includes('raydium') || candidate.isRaydiumListed;
    const isBonding = candidate.bondingCurveProgress < 100 && isPumpFun;

    const tradePumpFun = config.tradePumpFun ?? true;
    const tradeRaydium = config.tradeRaydium ?? true;
    const tradeBonding = config.tradeBonding ?? true;
    const tradeUnknown = config.tradeUnknown ?? false;

    let platformAllowed = true;
    let platformReason = 'PLATFORM_ALLOWED';

    if (isBonding && !tradeBonding) {
      platformAllowed = false;
      platformReason = 'TRADE_BONDING_DISABLED';
    } else if (isPumpFun && !tradePumpFun) {
      platformAllowed = false;
      platformReason = 'TRADE_PUMP_FUN_DISABLED';
    } else if (isRaydium && !tradeRaydium) {
      platformAllowed = false;
      platformReason = 'TRADE_RAYDIUM_DISABLED';
    } else if (!isPumpFun && !isRaydium && !tradeUnknown) {
      platformAllowed = false;
      platformReason = 'TRADE_UNKNOWN_PLATFORM_DISABLED';
    }

    criteriaResults['PLATFORM_FILTER'] = {
      pass: platformAllowed,
      actualValue: candidate.dexId,
      reason: platformReason,
    };
    if (!platformAllowed) blockingReasons.push(platformReason);

    // 5. Market Cap
    const minMcap = candidate.isRaydiumListed ? config.hardenedMcapMinRaydium : config.hardenedMcapMinPump;
    const maxMcap = config.hardenedMcapMax;
    if (candidate.marketCapUsd < minMcap || candidate.marketCapUsd > maxMcap) {
      const r = {
        pass: false,
        actualValue: candidate.marketCapUsd,
        threshold: `$${minMcap} - $${maxMcap}`,
        reason: `MCAP_OUT_OF_BOUNDS: $${candidate.marketCapUsd.toFixed(0)} not in [$${minMcap}, $${maxMcap}]`,
      };
      criteriaResults['MARKET_CAP'] = r;
      blockingReasons.push(r.reason);
    } else {
      criteriaResults['MARKET_CAP'] = {
        pass: true,
        actualValue: candidate.marketCapUsd,
        threshold: `$${minMcap} - $${maxMcap}`,
        reason: 'MCAP_IN_RANGE',
      };
    }

    // 6. Bonding Progress
    if (isPumpFun && !candidate.isRaydiumListed) {
      const minProgress = config.hardenedMinBondingProgress ?? 0;
      const maxProgress = config.hardenedMaxBondingProgress ?? 100;
      if (candidate.bondingCurveProgress < minProgress || candidate.bondingCurveProgress > maxProgress) {
        const r = {
          pass: false,
          actualValue: candidate.bondingCurveProgress,
          threshold: `${minProgress}% - ${maxProgress}%`,
          reason: `BONDING_PROGRESS_OUT_OF_BOUNDS: ${candidate.bondingCurveProgress}% not in [${minProgress}%, ${maxProgress}%]`,
        };
        criteriaResults['BONDING_PROGRESS'] = r;
        blockingReasons.push(r.reason);
      } else {
        criteriaResults['BONDING_PROGRESS'] = {
          pass: true,
          actualValue: candidate.bondingCurveProgress,
          threshold: `${minProgress}% - ${maxProgress}%`,
          reason: 'BONDING_PROGRESS_OK',
        };
      }
    } else {
      criteriaResults['BONDING_PROGRESS'] = { pass: true, reason: 'MIGRATED_OR_RAYDIUM' };
    }

    // 7. Token Age
    const minAge = config.hardenedMinAge ?? 0;
    const maxAge = config.hardenedMaxAge ?? 240;
    if (candidate.ageMinutes > 0 && (candidate.ageMinutes < minAge || candidate.ageMinutes > maxAge)) {
      const r = {
        pass: false,
        actualValue: Number(candidate.ageMinutes.toFixed(1)),
        threshold: `${minAge} - ${maxAge} min`,
        reason: `TOKEN_AGE_OUT_OF_BOUNDS: ${candidate.ageMinutes.toFixed(1)}m not in [${minAge}m, ${maxAge}m]`,
      };
      criteriaResults['TOKEN_AGE'] = r;
      blockingReasons.push(r.reason);
    } else {
      criteriaResults['TOKEN_AGE'] = {
        pass: true,
        actualValue: Number(candidate.ageMinutes.toFixed(1)),
        threshold: `${minAge} - ${maxAge} min`,
        reason: 'TOKEN_AGE_OK',
      };
    }

    // 8. Liquidity USD
    const minLiq = config.hardenedLiquidityMin;
    if (candidate.liquidityUsd < minLiq) {
      const r = {
        pass: false,
        actualValue: candidate.liquidityUsd,
        threshold: minLiq,
        reason: `LIQUIDITY_TOO_LOW: $${candidate.liquidityUsd.toFixed(0)} < $${minLiq}`,
      };
      criteriaResults['LIQUIDITY'] = r;
      blockingReasons.push(r.reason);
    } else {
      criteriaResults['LIQUIDITY'] = {
        pass: true,
        actualValue: candidate.liquidityUsd,
        threshold: minLiq,
        reason: 'LIQUIDITY_OK',
      };
    }

    // 9. Liquidity Ratio
    const liqRatio = candidate.liquidityUsd / Math.max(1, candidate.marketCapUsd);
    const minLiqRatio = (config.hardenedLiquidityRatio || 5) > 1 ? config.hardenedLiquidityRatio / 100 : config.hardenedLiquidityRatio || 0.05;
    if (liqRatio < minLiqRatio) {
      const r = {
        pass: false,
        actualValue: Number((liqRatio * 100).toFixed(1)),
        threshold: Number((minLiqRatio * 100).toFixed(1)),
        reason: `LIQUIDITY_RATIO_TOO_LOW: ${(liqRatio * 100).toFixed(1)}% < ${(minLiqRatio * 100).toFixed(1)}%`,
      };
      criteriaResults['LIQUIDITY_RATIO'] = r;
      blockingReasons.push(r.reason);
    } else {
      criteriaResults['LIQUIDITY_RATIO'] = {
        pass: true,
        actualValue: Number((liqRatio * 100).toFixed(1)),
        threshold: Number((minLiqRatio * 100).toFixed(1)),
        reason: 'LIQUIDITY_RATIO_OK',
      };
    }

    // 10. Risk Score & Rug Safety
    const maxRisk = config.hardenedMaxRiskScore ?? 22;
    if (!candidate.isRugSafe || candidate.riskScore > maxRisk) {
      const r = {
        pass: false,
        actualValue: candidate.riskScore,
        threshold: maxRisk,
        reason: `RISK_SCORE_TOO_HIGH: risk=${candidate.riskScore} > ${maxRisk} or rugUnsafe`,
      };
      criteriaResults['RISK_SCORE'] = r;
      blockingReasons.push(r.reason);
    } else {
      criteriaResults['RISK_SCORE'] = {
        pass: true,
        actualValue: candidate.riskScore,
        threshold: maxRisk,
        reason: 'RISK_SCORE_SAFE',
      };
    }

    // 11. Dev Ownership (Strict 0 - 100% scale)
    const maxDev = config.hardenedMaxDevOwnership ?? 10;
    if (candidate.devWalletOwnershipPct > maxDev) {
      const r = {
        pass: false,
        actualValue: candidate.devWalletOwnershipPct,
        threshold: maxDev,
        reason: `DEV_OWNERSHIP_TOO_HIGH: ${candidate.devWalletOwnershipPct.toFixed(1)}% > ${maxDev}%`,
      };
      criteriaResults['DEV_OWNERSHIP'] = r;
      blockingReasons.push(r.reason);
    } else {
      criteriaResults['DEV_OWNERSHIP'] = {
        pass: true,
        actualValue: candidate.devWalletOwnershipPct,
        threshold: maxDev,
        reason: 'DEV_OWNERSHIP_SAFE',
      };
    }

    // 12. Top 10 Ownership (Strict 0 - 100% scale)
    const maxTop10 = config.hardenedMaxTop10 ?? 25.0;
    if (candidate.top10HoldersPct > maxTop10) {
      const r = {
        pass: false,
        actualValue: candidate.top10HoldersPct,
        threshold: maxTop10,
        reason: `TOP10_OWNERSHIP_TOO_HIGH: ${candidate.top10HoldersPct.toFixed(1)}% > ${maxTop10}%`,
      };
      criteriaResults['TOP10_OWNERSHIP'] = r;
      blockingReasons.push(r.reason);
    } else {
      criteriaResults['TOP10_OWNERSHIP'] = {
        pass: true,
        actualValue: candidate.top10HoldersPct,
        threshold: maxTop10,
        reason: 'TOP10_OWNERSHIP_SAFE',
      };
    }

    // 13. Unique Buyers 30s
    const minUnique = config.hardenedMinUniqueBuyers30s ?? 4;
    if (candidate.uniqueBuyers30s < minUnique) {
      const r = {
        pass: false,
        actualValue: candidate.uniqueBuyers30s,
        threshold: minUnique,
        reason: `UNIQUE_BUYERS_TOO_LOW: ${candidate.uniqueBuyers30s} < ${minUnique}`,
      };
      criteriaResults['UNIQUE_BUYERS'] = r;
      blockingReasons.push(r.reason);
    } else {
      criteriaResults['UNIQUE_BUYERS'] = {
        pass: true,
        actualValue: candidate.uniqueBuyers30s,
        threshold: minUnique,
        reason: 'UNIQUE_BUYERS_OK',
      };
    }

    // 14. Buy Count 30s
    const minBuys = config.hardenedMinBuyCount30s ?? 4;
    const maxBuys = config.hardenedMaxBuyCount30s ?? 40;
    if (candidate.buyCount30s < minBuys || candidate.buyCount30s > maxBuys) {
      const r = {
        pass: false,
        actualValue: candidate.buyCount30s,
        threshold: `${minBuys} - ${maxBuys}`,
        reason: `BUY_COUNT_OUT_OF_BOUNDS: ${candidate.buyCount30s} not in [${minBuys}, ${maxBuys}]`,
      };
      criteriaResults['BUY_COUNT'] = r;
      blockingReasons.push(r.reason);
    } else {
      criteriaResults['BUY_COUNT'] = {
        pass: true,
        actualValue: candidate.buyCount30s,
        threshold: `${minBuys} - ${maxBuys}`,
        reason: 'BUY_COUNT_OK',
      };
    }

    // 15. Buy / Sell Ratio
    const buySellRatio = candidate.totalBuys / Math.max(1, candidate.totalSells);
    const minRatio = config.hardenedMinBuySellRatio ?? 1.5;
    const maxRatio = config.hardenedMaxBuySellRatio ?? 15.0;
    if (buySellRatio < minRatio || buySellRatio > maxRatio) {
      const r = {
        pass: false,
        actualValue: Number(buySellRatio.toFixed(2)),
        threshold: `${minRatio} - ${maxRatio}`,
        reason: `BUY_SELL_RATIO_OUT_OF_BOUNDS: ${buySellRatio.toFixed(2)} not in [${minRatio}, ${maxRatio}]`,
      };
      criteriaResults['BUY_SELL_RATIO'] = r;
      blockingReasons.push(r.reason);
    } else {
      criteriaResults['BUY_SELL_RATIO'] = {
        pass: true,
        actualValue: Number(buySellRatio.toFixed(2)),
        threshold: `${minRatio} - ${maxRatio}`,
        reason: 'BUY_SELL_RATIO_OK',
      };
    }

    // 16. Price Change 1m
    const maxPriceChange = config.hardenedMaxPriceChange1m ?? 15.0;
    if (candidate.priceChange1m > maxPriceChange) {
      const r = {
        pass: false,
        actualValue: candidate.priceChange1m,
        threshold: maxPriceChange,
        reason: `PRICE_CHANGE_1M_TOO_HIGH: ${candidate.priceChange1m.toFixed(1)}% > ${maxPriceChange}%`,
      };
      criteriaResults['PRICE_CHANGE'] = r;
      blockingReasons.push(r.reason);
    } else {
      criteriaResults['PRICE_CHANGE'] = {
        pass: true,
        actualValue: candidate.priceChange1m,
        threshold: maxPriceChange,
        reason: 'PRICE_CHANGE_OK',
      };
    }

    // 17. RebuyGuard Check
    const rebuyCheck = rebuyGuard.canBuy({
      network,
      wallet,
      mint,
      maxRebuyTimes: config.maxRebuyTimes ?? 1,
      tradeOnlyOnce: config.tradeOnlyOnce ?? true,
    });
    if (!rebuyCheck.allowed) {
      const r = { pass: false, reason: rebuyCheck.reason };
      criteriaResults['REBUY_GUARD'] = r;
      blockingReasons.push(r.reason);
    } else {
      criteriaResults['REBUY_GUARD'] = { pass: true, reason: 'REBUY_GUARD_ALLOWED' };
    }

    // 18. Wallet Balance Check
    const buyAmountSol = Number(config.buyAmountSol) || 0.1;
    const requiredSol = buyAmountSol + 0.005; // Reserve 0.005 for gas/fees
    try {
      const executor = executionGateway.getExecutor(network);
      const balance = await executor.getBalance();
      if (balance < requiredSol) {
        const r = {
          pass: false,
          actualValue: balance,
          threshold: requiredSol,
          reason: `INSUFFICIENT_BALANCE: Available ${balance.toFixed(4)} SOL < Required ${requiredSol.toFixed(4)} SOL`,
        };
        criteriaResults['WALLET_BALANCE'] = r;
        blockingReasons.push(r.reason);
      } else {
        criteriaResults['WALLET_BALANCE'] = {
          pass: true,
          actualValue: balance,
          threshold: requiredSol,
          reason: 'BALANCE_SUFFICIENT',
        };
      }
    } catch (e: any) {
      const r = { pass: false, reason: `BALANCE_CHECK_FAILED: ${e.message}` };
      criteriaResults['WALLET_BALANCE'] = r;
      blockingReasons.push(r.reason);
    }

    const allowed = blockingReasons.length === 0;

    return {
      allowed,
      decision: allowed ? 'BUY' : 'BLOCK',
      mintAddress: mint,
      symbol: candidate.symbol,
      buyAmountSol,
      criteriaResults,
      blockingReasons,
      evaluatedAt: Date.now(),
    };
  }
}

export const serverEntryGate = ServerEntryGate.getInstance();
