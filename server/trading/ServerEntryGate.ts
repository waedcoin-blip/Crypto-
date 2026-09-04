// server/trading/ServerEntryGate.ts
import { EnrichedCandidate } from './CandidateEnricher.js';
import { CriteriaConfig, DEFAULT_CRITERIA } from '../services/criteriaService.js';
import { positionManager } from './PositionManager.js';
import { rebuyGuard } from './RebuyGuard.js';
import { executionGateway } from '../execution/ExecutionGateway.js';
import { tokenMintResolver } from '../market/TokenMintResolver.js';

export interface CriterionCheckResult {
  pass: boolean;
  actualValue?: string | number | boolean | null;
  threshold?: string | number | boolean;
  reason: string;
}

export interface ServerEntryDecision {
  allowed: boolean;
  decision: 'BUY' | 'BLOCK';
  mintAddress: string;
  symbol: string;
  buyAmountSol: number;
  matchScorePct: number;
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

    // 1. Mint Validity (Strict SPL/Token-2022 Token Mint Check)
    const mintClassification = tokenMintResolver.classifyAddress(mint);
    if (!mintClassification.isValidMint) {
      const r = { pass: false, actualValue: mint, reason: `TOKEN_MINT_INVALID: ${mintClassification.reason}` };
      criteriaResults['MINT_VALIDITY'] = r;
      blockingReasons.push(r.reason);
    } else {
      criteriaResults['MINT_VALIDITY'] = { pass: true, actualValue: mint, reason: 'VALID_MINT' };
    }

    // 1b. Token Decimals Gate (Must be resolved and AVAILABLE)
    const decimals = candidate.decimals.value;
    if (decimals === null || candidate.decimals.state !== 'AVAILABLE' || !Number.isInteger(decimals) || decimals < 0) {
      const r = { pass: false, actualValue: decimals, reason: 'DECIMALS_UNRESOLVED' };
      criteriaResults['DECIMALS'] = r;
      blockingReasons.push(r.reason);
    } else {
      criteriaResults['DECIMALS'] = { pass: true, actualValue: decimals, reason: 'DECIMALS_RESOLVED' };
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
    const bondingProgressVal = candidate.bondingCurveProgress.value ?? 0;
    const isBonding = bondingProgressVal < 100 && isPumpFun;

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

    // 5. Market Cap (Requires AVAILABLE Metric)
    const mcap = candidate.marketCapUsd.value;
    const minMcap = candidate.isRaydiumListed ? config.hardenedMcapMinRaydium : config.hardenedMcapMinPump;
    const maxMcap = config.hardenedMcapMax;

    if (mcap === null || candidate.marketCapUsd.state !== 'AVAILABLE') {
      const r = { pass: false, actualValue: null, threshold: `$${minMcap} - $${maxMcap}`, reason: 'MARKET_CAP_UNAVAILABLE' };
      criteriaResults['MARKET_CAP'] = r;
      blockingReasons.push(r.reason);
    } else if (mcap < minMcap || mcap > maxMcap) {
      const r = {
        pass: false,
        actualValue: mcap,
        threshold: `$${minMcap} - $${maxMcap}`,
        reason: `MCAP_OUT_OF_BOUNDS: $${mcap.toFixed(0)} not in [$${minMcap}, $${maxMcap}]`,
      };
      criteriaResults['MARKET_CAP'] = r;
      blockingReasons.push(r.reason);
    } else {
      criteriaResults['MARKET_CAP'] = {
        pass: true,
        actualValue: mcap,
        threshold: `$${minMcap} - $${maxMcap}`,
        reason: 'MCAP_IN_RANGE',
      };
    }

    // 6. Bonding Progress (Requires AVAILABLE for Pump.fun)
    if (isPumpFun && !candidate.isRaydiumListed) {
      const minProgress = config.hardenedMinBondingProgress ?? 0;
      const maxProgress = config.hardenedMaxBondingProgress ?? 100;
      const progress = candidate.bondingCurveProgress.value;

      if (progress === null) {
        const r = { pass: false, actualValue: null, threshold: `${minProgress}% - ${maxProgress}%`, reason: 'BONDING_PROGRESS_UNAVAILABLE' };
        criteriaResults['BONDING_PROGRESS'] = r;
        blockingReasons.push(r.reason);
      } else if (progress < minProgress || progress > maxProgress) {
        const r = {
          pass: false,
          actualValue: progress,
          threshold: `${minProgress}% - ${maxProgress}%`,
          reason: `BONDING_PROGRESS_OUT_OF_BOUNDS: ${progress.toFixed(1)}% not in [${minProgress}%, ${maxProgress}%]`,
        };
        criteriaResults['BONDING_PROGRESS'] = r;
        blockingReasons.push(r.reason);
      } else {
        criteriaResults['BONDING_PROGRESS'] = {
          pass: true,
          actualValue: progress,
          threshold: `${minProgress}% - ${maxProgress}%`,
          reason: 'BONDING_PROGRESS_OK',
        };
      }
    } else {
      criteriaResults['BONDING_PROGRESS'] = { pass: true, reason: 'MIGRATED_OR_RAYDIUM' };
    }

    // 7. Token Age (Minutes)
    const minAge = config.hardenedMinAge ?? 0;
    const maxAge = config.hardenedMaxAge ?? 240;
    const age = candidate.ageMinutes.value;

    if (age === null || candidate.ageMinutes.state !== 'AVAILABLE') {
      const r = { pass: false, actualValue: null, threshold: `${minAge} - ${maxAge} min`, reason: 'TOKEN_AGE_UNAVAILABLE' };
      criteriaResults['TOKEN_AGE'] = r;
      blockingReasons.push(r.reason);
    } else if (age < minAge || age > maxAge) {
      const r = {
        pass: false,
        actualValue: Number(age.toFixed(1)),
        threshold: `${minAge} - ${maxAge} min`,
        reason: `TOKEN_AGE_OUT_OF_BOUNDS: ${age.toFixed(1)}m not in [${minAge}m, ${maxAge}m]`,
      };
      criteriaResults['TOKEN_AGE'] = r;
      blockingReasons.push(r.reason);
    } else {
      criteriaResults['TOKEN_AGE'] = {
        pass: true,
        actualValue: Number(age.toFixed(1)),
        threshold: `${minAge} - ${maxAge} min`,
        reason: 'TOKEN_AGE_OK',
      };
    }

    // 8. Liquidity USD (Requires AVAILABLE Metric)
    const minLiq = config.hardenedLiquidityMin;
    const liq = candidate.liquidityUsd.value;

    if (liq === null || candidate.liquidityUsd.state !== 'AVAILABLE') {
      const r = { pass: false, actualValue: null, threshold: minLiq, reason: 'LIQUIDITY_UNAVAILABLE' };
      criteriaResults['LIQUIDITY'] = r;
      blockingReasons.push(r.reason);
    } else if (liq < minLiq) {
      const r = {
        pass: false,
        actualValue: liq,
        threshold: minLiq,
        reason: `LIQUIDITY_TOO_LOW: $${liq.toFixed(0)} < $${minLiq}`,
      };
      criteriaResults['LIQUIDITY'] = r;
      blockingReasons.push(r.reason);
    } else {
      criteriaResults['LIQUIDITY'] = {
        pass: true,
        actualValue: liq,
        threshold: minLiq,
        reason: 'LIQUIDITY_OK',
      };
    }

    // 9. Liquidity Ratio (Liq / Mcap >= minRatio)
    const minLiqRatio = (config.hardenedLiquidityRatio || 5) > 1 ? config.hardenedLiquidityRatio / 100 : config.hardenedLiquidityRatio || 0.05;
    if (liq !== null && mcap !== null && mcap > 0) {
      const liqRatio = liq / mcap;
      if (liqRatio < minLiqRatio) {
        const r = {
          pass: false,
          actualValue: Number((liqRatio * 100).toFixed(2)),
          threshold: Number((minLiqRatio * 100).toFixed(2)),
          reason: `LIQUIDITY_RATIO_TOO_LOW: ${(liqRatio * 100).toFixed(2)}% < ${(minLiqRatio * 100).toFixed(2)}%`,
        };
        criteriaResults['LIQUIDITY_RATIO'] = r;
        blockingReasons.push(r.reason);
      } else {
        criteriaResults['LIQUIDITY_RATIO'] = {
          pass: true,
          actualValue: Number((liqRatio * 100).toFixed(2)),
          threshold: Number((minLiqRatio * 100).toFixed(2)),
          reason: 'LIQUIDITY_RATIO_OK',
        };
      }
    } else {
      const r = { pass: false, reason: 'LIQUIDITY_RATIO_UNAVAILABLE' };
      criteriaResults['LIQUIDITY_RATIO'] = r;
      blockingReasons.push(r.reason);
    }

    // 10. Risk Score & Rug Safety
    const maxRisk = config.hardenedMaxRiskScore ?? 22;
    const risk = candidate.riskScore.value;
    const rugSafe = candidate.isRugSafe.value;

    if (risk === null || candidate.riskScore.state !== 'AVAILABLE') {
      const r = { pass: false, actualValue: null, threshold: maxRisk, reason: 'SECURITY_DATA_UNAVAILABLE' };
      criteriaResults['RISK_SCORE'] = r;
      blockingReasons.push(r.reason);
    } else if (risk > maxRisk || rugSafe === false) {
      const r = {
        pass: false,
        actualValue: risk,
        threshold: maxRisk,
        reason: `RISK_SCORE_TOO_HIGH: risk=${risk} > ${maxRisk} or rugUnsafe`,
      };
      criteriaResults['RISK_SCORE'] = r;
      blockingReasons.push(r.reason);
    } else {
      criteriaResults['RISK_SCORE'] = {
        pass: true,
        actualValue: risk,
        threshold: maxRisk,
        reason: 'RISK_SCORE_SAFE',
      };
    }

    // 11. Dev Ownership (Strict 0 - 100% scale)
    const maxDev = config.hardenedMaxDevOwnership ?? 10;
    const devPct = candidate.devWalletOwnershipPct.value;

    if (devPct === null || candidate.devWalletOwnershipPct.state !== 'AVAILABLE') {
      const r = { pass: false, actualValue: null, threshold: maxDev, reason: 'DEV_OWNERSHIP_UNAVAILABLE' };
      criteriaResults['DEV_OWNERSHIP'] = r;
      blockingReasons.push(r.reason);
    } else if (devPct > maxDev) {
      const r = {
        pass: false,
        actualValue: devPct,
        threshold: maxDev,
        reason: `DEV_OWNERSHIP_TOO_HIGH: ${devPct.toFixed(1)}% > ${maxDev}%`,
      };
      criteriaResults['DEV_OWNERSHIP'] = r;
      blockingReasons.push(r.reason);
    } else {
      criteriaResults['DEV_OWNERSHIP'] = {
        pass: true,
        actualValue: devPct,
        threshold: maxDev,
        reason: 'DEV_OWNERSHIP_SAFE',
      };
    }

    // 12. Top 10 Ownership (Strict 0 - 100% scale)
    const maxTop10 = config.hardenedMaxTop10 ?? 25.0;
    const top10Pct = candidate.top10HoldersPct.value;

    if (top10Pct === null || candidate.top10HoldersPct.state !== 'AVAILABLE') {
      const r = { pass: false, actualValue: null, threshold: maxTop10, reason: 'TOP10_OWNERSHIP_UNAVAILABLE' };
      criteriaResults['TOP10_OWNERSHIP'] = r;
      blockingReasons.push(r.reason);
    } else if (top10Pct > maxTop10) {
      const r = {
        pass: false,
        actualValue: top10Pct,
        threshold: maxTop10,
        reason: `TOP10_OWNERSHIP_TOO_HIGH: ${top10Pct.toFixed(1)}% > ${maxTop10}%`,
      };
      criteriaResults['TOP10_OWNERSHIP'] = r;
      blockingReasons.push(r.reason);
    } else {
      criteriaResults['TOP10_OWNERSHIP'] = {
        pass: true,
        actualValue: top10Pct,
        threshold: maxTop10,
        reason: 'TOP10_OWNERSHIP_SAFE',
      };
    }

    // 13. Unique Buyers 30s
    const minUnique = config.hardenedMinUniqueBuyers30s ?? 4;
    const uniqueBuyers = candidate.uniqueBuyers30s.value;

    if (uniqueBuyers !== null && uniqueBuyers < minUnique) {
      const r = {
        pass: false,
        actualValue: uniqueBuyers,
        threshold: minUnique,
        reason: `UNIQUE_BUYERS_TOO_LOW: ${uniqueBuyers} < ${minUnique}`,
      };
      criteriaResults['UNIQUE_BUYERS'] = r;
      blockingReasons.push(r.reason);
    } else {
      criteriaResults['UNIQUE_BUYERS'] = {
        pass: true,
        actualValue: uniqueBuyers,
        threshold: minUnique,
        reason: 'UNIQUE_BUYERS_OK',
      };
    }

    // 14. Buy Count 30s
    const minBuys = config.hardenedMinBuyCount30s ?? 4;
    const maxBuys = config.hardenedMaxBuyCount30s ?? 40;
    const buyCount = candidate.buyCount30s.value;

    if (buyCount !== null && (buyCount < minBuys || buyCount > maxBuys)) {
      const r = {
        pass: false,
        actualValue: buyCount,
        threshold: `${minBuys} - ${maxBuys}`,
        reason: `BUY_COUNT_OUT_OF_BOUNDS: ${buyCount} not in [${minBuys}, ${maxBuys}]`,
      };
      criteriaResults['BUY_COUNT'] = r;
      blockingReasons.push(r.reason);
    } else {
      criteriaResults['BUY_COUNT'] = {
        pass: true,
        actualValue: buyCount,
        threshold: `${minBuys} - ${maxBuys}`,
        reason: 'BUY_COUNT_OK',
      };
    }

    // 15. Buy / Sell Ratio
    const totalBuys = candidate.totalBuys.value;
    const totalSells = candidate.totalSells.value;
    const minRatio = config.hardenedMinBuySellRatio ?? 1.5;
    const maxRatio = config.hardenedMaxBuySellRatio ?? 15.0;

    if (totalBuys !== null && totalSells !== null) {
      const buySellRatio = totalBuys / Math.max(1, totalSells);
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
    } else {
      criteriaResults['BUY_SELL_RATIO'] = { pass: true, reason: 'RATIO_NOT_APPLICABLE' };
    }

    // 16. Price Change 1m
    const maxPriceChange = config.hardenedMaxPriceChange1m ?? 15.0;
    const priceChange = candidate.priceChange1m.value;

    if (priceChange !== null && priceChange > maxPriceChange) {
      const r = {
        pass: false,
        actualValue: priceChange,
        threshold: maxPriceChange,
        reason: `PRICE_CHANGE_1M_TOO_HIGH: ${priceChange.toFixed(1)}% > ${maxPriceChange}%`,
      };
      criteriaResults['PRICE_CHANGE'] = r;
      blockingReasons.push(r.reason);
    } else {
      criteriaResults['PRICE_CHANGE'] = {
        pass: true,
        actualValue: priceChange,
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

    // 17b. Dynamic Momentum Evaluation
    const { momentumEngine } = await import('./MomentumEngine.js');
    const momentumMetrics = momentumEngine.calculateMomentum(candidate);
    const minMomentumScore = config.hardenedMinBuyCount30s ? 40 : 50; // Use reasonable minimum threshold
    if (momentumMetrics.momentumScore < minMomentumScore) {
      const r = {
        pass: false,
        actualValue: momentumMetrics.momentumScore,
        threshold: minMomentumScore,
        reason: `MOMENTUM_SCORE_TOO_LOW: ${momentumMetrics.momentumScore.toFixed(1)}/100 < ${minMomentumScore}`,
      };
      criteriaResults['MOMENTUM'] = r;
      blockingReasons.push(r.reason);
    } else {
      criteriaResults['MOMENTUM'] = {
        pass: true,
        actualValue: momentumMetrics.momentumScore,
        threshold: minMomentumScore,
        reason: 'MOMENTUM_OK',
      };
    }

    // 17c. Dynamic Profitability Evaluation
    const { profitabilityEngine } = await import('./ProfitabilityEngine.js');
    const buyAmountSol = Number(config.buyAmountSol) || 0.1;
    const profitabilityMetrics = profitabilityEngine.calculateProfitability(candidate, buyAmountSol);
    const expectedNetProfitSol = Number(profitabilityMetrics.expectedNetProfitLamports) / 1e9;
    if (profitabilityMetrics.status === 'UNPROFITABLE' || expectedNetProfitSol <= 0) {
      const r = {
        pass: false,
        actualValue: expectedNetProfitSol,
        threshold: 0,
        reason: `UNPROFITABLE_OPPORTUNITY: Expected Net SOL Profit is ${expectedNetProfitSol.toFixed(4)}`,
      };
      criteriaResults['PROFITABILITY'] = r;
      blockingReasons.push(r.reason);
    } else if (profitabilityMetrics.status === 'DATA_UNAVAILABLE') {
      const r = {
        pass: false,
        reason: 'PROFITABILITY_DATA_UNAVAILABLE',
      };
      criteriaResults['PROFITABILITY'] = r;
      blockingReasons.push(r.reason);
    } else {
      criteriaResults['PROFITABILITY'] = {
        pass: true,
        actualValue: expectedNetProfitSol,
        threshold: 0,
        reason: 'OPPORTUNITY_PROFITABLE',
      };
    }

    // 18. Wallet Balance Check
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

    // 19. Required Criteria Match Score (Default >= 80%)
    const totalChecks = Object.keys(criteriaResults).length;
    const passedChecks = Object.values(criteriaResults).filter((c) => c.pass).length;
    const matchScorePct = totalChecks > 0 ? Math.round((passedChecks / totalChecks) * 100) : 0;
    const requiredMatchPct = 80;

    if (matchScorePct < requiredMatchPct) {
      const r = {
        pass: false,
        actualValue: matchScorePct,
        threshold: requiredMatchPct,
        reason: `MATCH_SCORE_TOO_LOW: ${matchScorePct}% < ${requiredMatchPct}%`,
      };
      criteriaResults['MATCH_SCORE'] = r;
      blockingReasons.push(r.reason);
    }

    const allowed = blockingReasons.length === 0;

    return {
      allowed,
      decision: allowed ? 'BUY' : 'BLOCK',
      mintAddress: mint,
      symbol: candidate.symbol,
      buyAmountSol,
      matchScorePct,
      criteriaResults,
      blockingReasons,
      evaluatedAt: Date.now(),
    };
  }
}

export const serverEntryGate = ServerEntryGate.getInstance();
