// server/trading/HardenedCriteriaEngine.ts
import {
  HardenedApproval,
  HardenedCriterionResult,
  HardenedDecision,
} from '../types/index.js';
import { EnrichedCandidate } from './CandidateEnricher.js';
import { CriteriaConfig, DEFAULT_CRITERIA } from '../services/criteriaService.js';
import { positionManager } from './PositionManager.js';
import { rebuyGuard } from './RebuyGuard.js';
import { tokenMintResolver } from '../market/TokenMintResolver.js';
import { hardenedApprovalStore, HardenedApprovalStore } from './HardenedApprovalStore.js';
import { criteriaRepository } from '../repositories/CriteriaRepository.js';

export interface HardenedEvaluationResult {
  decision: HardenedDecision;
  approval?: HardenedApproval;
  checks: HardenedCriterionResult[];
  rejectionReasons: string[];
  unknownReasons: string[];
  buyAmountSol: number;
  criteriaVersion: string;
  evaluatedAt: number;
}

function extractVal<T>(field: any): T | null | undefined {
  if (field === null || field === undefined) return field;
  if (typeof field === 'object' && 'value' in field) return field.value;
  return field;
}

function extractState(field: any): string | undefined {
  if (field && typeof field === 'object' && 'state' in field) return field.state;
  return 'AVAILABLE';
}

export class HardenedCriteriaEngine {
  private static instance: HardenedCriteriaEngine;
  private criteriaVersion: string = 'v1.0.0';
  private versionCounter: number = 1;

  // Negative decisions cache: `${criteriaVersion}:${mint}`
  private rejectionCache: Map<string, { rejectedAt: number; reasons: string[] }> = new Map();
  private retryTracker: Map<string, { retries: number; lastAttemptAt: number }> = new Map();

  private readonly MAX_RETRIES = 3;
  private readonly RETRY_BACKOFF_MS = [500, 1000, 2000];
  private readonly MAX_CACHE_AGE_MS = 3600000; // 1 hour

  private constructor() {
    this.updateCriteriaVersion();
    // FIX: Prevent memory leaks by pruning stale cache entries
    const pruneInterval = setInterval(() => this.pruneStaleCache(), 300000); // Every 5 mins
    if (pruneInterval.unref) pruneInterval.unref();
  }

  public static getInstance(): HardenedCriteriaEngine {
    if (!HardenedCriteriaEngine.instance) {
      HardenedCriteriaEngine.instance = new HardenedCriteriaEngine();
    }
    return HardenedCriteriaEngine.instance;
  }

  // ==========================================
  // VERSION MANAGEMENT
  // ==========================================

  public getCriteriaVersion(): string {
    return this.criteriaVersion;
  }

  public bumpCriteriaVersion(): void {
    this.versionCounter++;
    this.criteriaVersion = `v1.0.${this.versionCounter}`;
    this.rejectionCache.clear();
    this.retryTracker.clear();
    console.log(`[HARDENED_CRITERIA_VERSION_BUMP] New criteriaVersion=${this.criteriaVersion}. Rejection cache cleared.`);
  }

  private updateCriteriaVersion(): void {
    // Version is set on construction; bump manually via API
  }

  // ==========================================
  // CACHE PRUNING
  // ==========================================

  private pruneStaleCache(): void {
    const now = Date.now();
    let prunedRejections = 0;
    let prunedRetries = 0;

    for (const [key, data] of this.rejectionCache.entries()) {
      if (now - data.rejectedAt > this.MAX_CACHE_AGE_MS) {
        this.rejectionCache.delete(key);
        prunedRejections++;
      }
    }
    for (const [mint, data] of this.retryTracker.entries()) {
      if (now - data.lastAttemptAt > this.MAX_CACHE_AGE_MS) {
        this.retryTracker.delete(mint);
        prunedRetries++;
      }
    }

    if (prunedRejections > 0 || prunedRetries > 0) {
      console.log(`[HardenedCriteriaEngine] Pruned ${prunedRejections} stale rejections, ${prunedRetries} stale retries.`);
    }
  }

  // ==========================================
  // CORE EVALUATION
  // ==========================================

  public async evaluateCandidate(
    candidate: EnrichedCandidate,
    opts: {
      network: string;
      wallet: string;
      criteria?: Partial<CriteriaConfig>;
      autoSniperEnabled?: boolean;
      currentSlot?: number;
    }
  ): Promise<HardenedEvaluationResult> {
    const { network, wallet, autoSniperEnabled = true } = opts;

    // FIX: Fetch config once to avoid redundant I/O
    const repoConfig = (criteriaRepository.getActiveCriteriaSync() as any) || {};
    const config: CriteriaConfig = { ...DEFAULT_CRITERIA, ...repoConfig, ...(opts.criteria || {}) };

    const mint = candidate.mintAddress.trim();
    const cacheKey = `${this.criteriaVersion}:${mint}`;
    const now = Date.now();
    const defaultBuyAmountSol = config.buyAmountSol || config.minBuyAmount || 0.1;

    if (network === 'paper') {
      // Paper mode: Skip strict criteria, issue approval directly
      const approvalId = `appr_paper_${mint.slice(0, 8)}_${Date.now()}`;
      const approval: HardenedApproval = {
        approvalId,
        chain: 'solana',
        mint: mint.trim().toLowerCase(),
        criteriaVersion: this.criteriaVersion,
        evaluatedAt: Date.now(),
        evaluatedSlot: 0,
        evaluationPrice: 0.000001,
        maxSlotLag: 999999,
        maxPriceDeviationPct: 999999,
        expiresAt: Date.now() + 60000,
        checks: [],
        decisionHash: 'paper_mode_bypass',
        correlationId: `corr_paper_${Date.now()}`,
        state: 'ISSUED',
      };
      hardenedApprovalStore.issueApproval(approval);
      return {
        decision: 'PASS',
        approval,
        checks: [],
        rejectionReasons: [],
        unknownReasons: [],
        buyAmountSol: config.buyAmountSol || 0.1,
        criteriaVersion: this.criteriaVersion,
        evaluatedAt: Date.now(),
      };
    }

    // Check rejection cache first
    const cachedRejection = this.rejectionCache.get(cacheKey);
    if (cachedRejection) {
      return {
        decision: 'FAIL',
        checks: [],
        rejectionReasons: cachedRejection.reasons,
        unknownReasons: [],
        buyAmountSol: defaultBuyAmountSol,
        criteriaVersion: this.criteriaVersion,
        evaluatedAt: now,
      };
    }

    const checks: HardenedCriterionResult[] = [];
    const rejectionReasons: string[] = [];
    const unknownReasons: string[] = [];

    const record = (
      ruleId: string,
      name: string,
      status: HardenedDecision,
      passed: boolean,
      reason?: string,
      observedValue?: any,
      threshold?: any
    ) => {
      const res: HardenedCriterionResult = { ruleId, name, status, passed, reason, observedValue, threshold };
      checks.push(res);
      if (status === 'FAIL') rejectionReasons.push(reason || ruleId);
      if (status === 'UNKNOWN') unknownReasons.push(reason || ruleId);
    };

    // ---- RULE 1: MINT VALIDITY ----
    const mintClassification = tokenMintResolver.classifyAddress(mint);
    record(
      'MINT_VALIDITY', 'Mint Validity',
      mintClassification.isValidMint ? 'PASS' : 'FAIL',
      !!mintClassification.isValidMint,
      mintClassification.isValidMint ? 'VALID_MINT' : `INVALID_MINT: ${mintClassification.reason}`,
      mint
    );

    // ---- RULE 2: TOKEN DECIMALS ----
    const decimals = extractVal<number>(candidate.decimals);
    const decimalsState = extractState(candidate.decimals);
    if (decimalsState === 'PENDING') {
      record('TOKEN_DECIMALS', 'Token Decimals Gate', 'UNKNOWN', false, 'DECIMALS_RESOLUTION_PENDING');
    } else if (decimals === null || decimals === undefined || !Number.isInteger(decimals) || decimals < 0) {
      record('TOKEN_DECIMALS', 'Token Decimals Gate', 'UNKNOWN', false, `DECIMALS_UNRESOLVED: state=${decimalsState}`);
    } else {
      record('TOKEN_DECIMALS', 'Token Decimals Gate', 'PASS', true, 'DECIMALS_RESOLVED', decimals);
    }

    // ---- RULE 3: MARKET CAP ----
    const mcap = extractVal<number>(candidate.marketCapUsd);
    if (mcap === null || mcap === undefined) {
      record('MARKET_CAP', 'Market Cap Gate', 'UNKNOWN', false, 'MCAP_UNAVAILABLE');
    } else {
      // Paper network: relaxed thresholds for simulation
      const minMcap = network === 'paper' ? 1000 : (config.minMarketCap || 5000);
      const maxMcap = config.maxMarketCap || 100000000;
      if (mcap < minMcap || mcap > maxMcap) {
        record('MARKET_CAP', 'Market Cap Gate', 'FAIL', false, `MCAP_OUT_OF_RANGE: $${mcap}`, mcap, `$${minMcap}-$${maxMcap}`);
      } else {
        record('MARKET_CAP', 'Market Cap Gate', 'PASS', true, 'MCAP_IN_RANGE', mcap);
      }
    }

    // ---- RULE 4: LIQUIDITY ----
    const liq = extractVal<number>(candidate.liquidityUsd);
    if (liq === null || liq === undefined) {
      record('LIQUIDITY', 'Liquidity Gate', 'UNKNOWN', false, 'LIQUIDITY_UNAVAILABLE');
    } else {
      const minLiq = config.minLiquidity || 5000;
      if (liq < minLiq) {
        record('LIQUIDITY', 'Liquidity Gate', 'FAIL', false, `LIQUIDITY_TOO_LOW: $${liq}`, liq, `>$${minLiq}`);
      } else {
        record('LIQUIDITY', 'Liquidity Gate', 'PASS', true, 'LIQUIDITY_OK', liq);
      }
    }

    // ---- RULE 5: LIQUIDITY RATIO ----
    if (mcap && liq && mcap > 0) {
      const liqRatio = (liq / mcap) * 100;
      const minRatio = config.minLiquidityRatio || 2;
      if (liqRatio < minRatio) {
        record('LIQUIDITY_RATIO', 'Liquidity Ratio Gate', 'FAIL', false, `LIQ_RATIO_TOO_LOW: ${liqRatio.toFixed(2)}%`, liqRatio, `>${minRatio}%`);
      } else {
        record('LIQUIDITY_RATIO', 'Liquidity Ratio Gate', 'PASS', true, 'LIQ_RATIO_OK', liqRatio);
      }
    }

    // ---- RULE 6: TOKEN AGE ----
    const ageMinutes = extractVal<number>(candidate.ageMinutes);
    if (ageMinutes !== null && ageMinutes !== undefined) {
      const minAge = config.minAge || 0;
      const maxAge = config.maxAge || 1440;
      if (ageMinutes < minAge || ageMinutes > maxAge) {
        record('TOKEN_AGE', 'Token Age Gate', 'FAIL', false, `AGE_OUT_OF_RANGE: ${ageMinutes}m`, ageMinutes, `${minAge}-${maxAge}m`);
      } else {
        record('TOKEN_AGE', 'Token Age Gate', 'PASS', true, 'AGE_IN_RANGE', ageMinutes);
      }
    }

    // ---- RULE 7: BONDING PROGRESS ----
    const bondingProgress = extractVal<number>((candidate as any).bondingProgress || (candidate as any).bondingCurveProgress);
    if (bondingProgress !== null && bondingProgress !== undefined) {
      const minBonding = config.minBondingProgress || 0;
      const maxBonding = config.maxBondingProgress || 100;
      if (bondingProgress < minBonding || bondingProgress > maxBonding) {
        record('BONDING_PROGRESS', 'Bonding Progress Gate', 'FAIL', false, `BONDING_OUT_OF_RANGE: ${bondingProgress}%`, bondingProgress, `${minBonding}-${maxBonding}%`);
      } else {
        record('BONDING_PROGRESS', 'Bonding Progress Gate', 'PASS', true, 'BONDING_IN_RANGE', bondingProgress);
      }
    }

    // ---- RULE 8: MAX OPEN POSITIONS ----
    const openPositions = positionManager.getOpenPositions(network, wallet);
    const maxPositions = config.maxPositions || 10;
    if (openPositions.length >= maxPositions) {
      record('MAX_POSITIONS', 'Max Positions Gate', 'FAIL', false, `MAX_POSITIONS_REACHED: ${openPositions.length}/${maxPositions}`, openPositions.length, maxPositions);
    } else {
      record('MAX_POSITIONS', 'Max Positions Gate', 'PASS', true, 'POSITIONS_AVAILABLE', openPositions.length);
    }

    // ---- RULE 9: REBUY GUARD ----
    const rebuyCheck = rebuyGuard.canBuy({ network, wallet, mint });
    if (!rebuyCheck.allowed) {
      record('REBUY_GUARD', 'Rebuy Guard Gate', 'FAIL', false, `REBUY_BLOCKED: ${rebuyCheck.reason}`);
    } else {
      record('REBUY_GUARD', 'Rebuy Guard Gate', 'PASS', true, 'REBUY_ALLOWED');
    }

    // ---- RULE 10: RISK SCORE ----
    const riskScore = extractVal<number>(candidate.riskScore);
    if (riskScore !== null && riskScore !== undefined) {
      const maxRisk = (config as any).hardenedMaxRiskScore ?? config.maxRiskScore ?? 80;
      if (riskScore > maxRisk) {
        record('RISK_SCORE', 'Risk Score Gate', 'FAIL', false, `RISK_TOO_HIGH: ${riskScore}`, riskScore, `<${maxRisk}`);
      } else {
        record('RISK_SCORE', 'Risk Score Gate', 'PASS', true, 'RISK_OK', riskScore);
      }
    }

    // ---- RULE 11: DEV WALLET OWNERSHIP ----
    const devPct = extractVal<number>(candidate.devWalletOwnershipPct);
    const maxDev = (config as any).hardenedMaxDevOwnership ?? (config as any).maxDevOwnership ?? (config as any).maxDevOwnershipPct ?? 10;
    if (devPct !== null && devPct !== undefined) {
      if (devPct > maxDev) {
        record('DEV_OWNERSHIP', 'Dev Ownership Gate', 'FAIL', false, `DEV_OWNERSHIP_TOO_HIGH: ${devPct}% exceeds ${maxDev}%`, devPct, `<=${maxDev}%`);
      } else {
        record('DEV_OWNERSHIP', 'Dev Ownership Gate', 'PASS', true, 'DEV_OWNERSHIP_OK', devPct);
      }
    }

    // ---- RULE 12: TOP 10 HOLDERS ----
    const top10Pct = extractVal<number>(candidate.top10HoldersPct);
    const maxTop10 = (config as any).hardenedMaxTop10Ownership ?? (config as any).maxTop10HoldersPct ?? 50;
    if (top10Pct !== null && top10Pct !== undefined) {
      if (top10Pct > maxTop10) {
        record('TOP10_HOLDERS', 'Top 10 Holders Gate', 'FAIL', false, `TOP10_HOLDERS_TOO_HIGH: ${top10Pct}% exceeds ${maxTop10}%`, top10Pct, `<=${maxTop10}%`);
      } else {
        record('TOP10_HOLDERS', 'Top 10 Holders Gate', 'PASS', true, 'TOP10_HOLDERS_OK', top10Pct);
      }
    }

    // ---- RULE 13: RUG SAFETY ----
    const isRugSafe = extractVal<boolean>(candidate.isRugSafe);
    if (isRugSafe !== null && isRugSafe !== undefined) {
      if (!isRugSafe) {
        record('RUG_SAFETY', 'Rug Safety Gate', 'FAIL', false, 'RUG_PULL_SUSPECTED');
      } else {
        record('RUG_SAFETY', 'Rug Safety Gate', 'PASS', true, 'RUG_SAFE');
      }
    }

    // ---- RULE 14: SELLABLE GATE ----
    const isSellable = extractVal<boolean>(candidate.isSellable);
    if (isSellable !== null && isSellable !== undefined) {
      if (!isSellable) {
        record('SELLABLE_GATE', 'Sellable Gate', 'FAIL', false, 'TOKEN_UNSELLABLE_HONEYPOT');
      } else {
        record('SELLABLE_GATE', 'Sellable Gate', 'PASS', true, 'TOKEN_SELLABLE');
      }
    }

    // ---- FINAL DECISION ----
    let finalDecision: HardenedDecision = 'PASS';
    if (rejectionReasons.length > 0) finalDecision = 'FAIL';
    else if (unknownReasons.length > 0) finalDecision = 'UNKNOWN';

    // Handle FAIL
    if (finalDecision === 'FAIL') {
      this.rejectionCache.set(cacheKey, { rejectedAt: now, reasons: rejectionReasons });
      this.retryTracker.delete(mint);
      return {
        decision: 'FAIL',
        checks,
        rejectionReasons,
        unknownReasons,
        buyAmountSol: defaultBuyAmountSol,
        criteriaVersion: this.criteriaVersion,
        evaluatedAt: now,
      };
    }

    // Handle UNKNOWN (with retry logic)
    if (finalDecision === 'UNKNOWN') {
      const retryInfo = this.retryTracker.get(mint) || { retries: 0, lastAttemptAt: 0 };
      retryInfo.retries++;
      retryInfo.lastAttemptAt = now;
      this.retryTracker.set(mint, retryInfo);

      if (retryInfo.retries >= this.MAX_RETRIES) {
        const deathReason = `PERSISTENT_UNKNOWN_DEAD: ${unknownReasons.join(', ')}`;
        this.rejectionCache.set(cacheKey, { rejectedAt: now, reasons: [deathReason] });
        this.retryTracker.delete(mint);
        return {
          decision: 'FAIL',
          checks,
          rejectionReasons: [deathReason],
          unknownReasons,
          buyAmountSol: defaultBuyAmountSol,
          criteriaVersion: this.criteriaVersion,
          evaluatedAt: now,
        };
      }

      return {
        decision: 'UNKNOWN',
        checks,
        rejectionReasons,
        unknownReasons,
        buyAmountSol: defaultBuyAmountSol,
        criteriaVersion: this.criteriaVersion,
        evaluatedAt: now,
      };
    }

    // Handle PASS — Issue HardenedApproval
    this.retryTracker.delete(mint);
    const approvalId = `appr_${mint.slice(0, 8)}_${now}_${Math.random().toString(36).slice(2, 7)}`;
    const evaluatedSlot = opts.currentSlot || 0;
    const evaluationPrice = candidate.priceSol?.value || 0;
    const expiresAt = now + 15000; // 15s TTL

    const decisionHash = HardenedApprovalStore.computeDecisionHash({
      approvalId,
      chain: 'solana',
      mint,
      criteriaVersion: this.criteriaVersion,
      evaluatedSlot,
      evaluationPrice,
      checks,
    });

    const approval: HardenedApproval = {
      approvalId,
      chain: 'solana',
      mint,
      criteriaVersion: this.criteriaVersion,
      evaluatedAt: now,
      evaluatedSlot,
      evaluationPrice,
      maxSlotLag: 50,
      maxPriceDeviationPct: 15.0,
      expiresAt,
      checks,
      decisionHash,
      correlationId: `corr_${mint.slice(0, 8)}_${now}`,
      state: 'ISSUED',
    };

    hardenedApprovalStore.issueApproval(approval);

    return {
      decision: 'PASS',
      approval,
      checks,
      rejectionReasons: [],
      unknownReasons: [],
      buyAmountSol: defaultBuyAmountSol,
      criteriaVersion: this.criteriaVersion,
      evaluatedAt: now,
    };
  }

  // ==========================================
  // FINAL RE-CHECK (Before Broadcast)
  // ==========================================

  public async performFinalRecheck(
    approval: HardenedApproval,
    opts: { network: string; wallet: string }
  ): Promise<{ allowed: boolean; reason?: string }> {
    // 1. Check approval expiry
    if (Date.now() > approval.expiresAt) {
      return { allowed: false, reason: `APPROVAL_EXPIRED: approvalId=${approval.approvalId}` };
    }

    // 2. Check approval state
    if (approval.state !== 'ISSUED') {
      return { allowed: false, reason: `APPROVAL_NOT_ISSUED: state=${approval.state}` };
    }

    // 3. Re-check rebuy guard
    const rebuyCheck = rebuyGuard.canBuy({ network: opts.network, wallet: opts.wallet, mint: approval.mint });
    if (!rebuyCheck.allowed) {
      return { allowed: false, reason: `FINAL_RECHECK_REBUY_GUARD_REJECT: ${rebuyCheck.reason}` };
    }

    console.log(`[FINAL_BUY_RECHECK_PASSED] approvalId=${approval.approvalId} mint=${approval.mint}`);
    return { allowed: true };
  }
}

export const hardenedCriteriaEngine = HardenedCriteriaEngine.getInstance();
