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
    const decimals = candidate.decimals?.value;
    if (candidate.decimals?.state === 'PENDING') {
      record('TOKEN_DECIMALS', 'Token Decimals Gate', 'UNKNOWN', false, 'DECIMALS_RESOLUTION_PENDING');
    } else if (decimals === null || decimals === undefined || candidate.decimals?.state !== 'AVAILABLE' || !Number.isInteger(decimals) || decimals < 0) {
      record('TOKEN_DECIMALS', 'Token Decimals Gate', 'UNKNOWN', false, `DECIMALS_UNRESOLVED: state=${candidate.decimals?.state}`);
    } else {
      record('TOKEN_DECIMALS', 'Token Decimals Gate', 'PASS', true, 'DECIMALS_RESOLVED', decimals);
    }

    // ---- RULE 3: MARKET CAP ----
    const mcap = candidate.marketCapUsd?.value;
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
    const liq = candidate.liquidityUsd?.value;
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
    const ageMinutes = candidate.ageMinutes?.value;
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
    const bondingProgress = (candidate as any).bondingProgress?.value;
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
    const riskScore = candidate.riskScore?.value;
    if (riskScore !== null && riskScore !== undefined) {
      const maxRisk = config.maxRiskScore || 80;
      if (riskScore > maxRisk) {
        record('RISK_SCORE', 'Risk Score Gate', 'FAIL', false, `RISK_TOO_HIGH: ${riskScore}`, riskScore, `<${maxRisk}`);
      } else {
        record('RISK_SCORE', 'Risk Score Gate', 'PASS', true, 'RISK_OK', riskScore);
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
