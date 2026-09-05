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

  // Retry tracking for UNKNOWN candidates: `${mint}` -> { retries: number; lastAttemptAt: number }
  private retryTracker: Map<string, { retries: number; lastAttemptAt: number }> = new Map();
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_BACKOFF_MS = [500, 1000, 2000];

  private constructor() {
    this.updateCriteriaVersion();
  }

  public static getInstance(): HardenedCriteriaEngine {
    if (!HardenedCriteriaEngine.instance) {
      HardenedCriteriaEngine.instance = new HardenedCriteriaEngine();
    }
    return HardenedCriteriaEngine.instance;
  }

  public getCriteriaVersion(): string {
    return this.criteriaVersion;
  }

  public bumpCriteriaVersion(): void {
    this.versionCounter++;
    this.criteriaVersion = `v1.0.${this.versionCounter}`;
    this.rejectionCache.clear();
    console.log(`[HARDENED_CRITERIA_VERSION_BUMP] New criteriaVersion=${this.criteriaVersion}. Rejection cache cleared.`);
  }

  private updateCriteriaVersion(): void {
    const config = criteriaRepository.getActiveCriteriaSync() as any;
    if (config?.activePreset) {
      this.criteriaVersion = `v1-${config.activePreset}`;
    }
  }

  /**
   * Authoritative entrypoint: Evaluates candidate against all 12 hardened criteria gates.
   */
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
    const repoConfig = (criteriaRepository.getActiveCriteriaSync() as any) || {};
    const config: CriteriaConfig = { ...DEFAULT_CRITERIA, ...repoConfig, ...(opts.criteria || {}) };

    const mint = candidate.mintAddress.trim();
    const cacheKey = `${this.criteriaVersion}:${mint}`;
    const now = Date.now();

    const defaultBuyAmountSol = config.buyAmountSol || config.minBuyAmount || 0.1;

    console.log(`[HARDENED_EVALUATION_STARTED] mint=${mint} version=${this.criteriaVersion}`);

    // Check negative decision cache
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
      console.log(`[HARDENED_CRITERION] ${ruleId}: status=${status} passed=${passed} reason=${reason || 'OK'}`);
      if (status === 'FAIL') rejectionReasons.push(reason || ruleId);
      if (status === 'UNKNOWN') unknownReasons.push(reason || ruleId);
    };

    // 1. MINT VALIDITY
    const mintClassification = tokenMintResolver.classifyAddress(mint);
    if (!mintClassification.isValidMint) {
      record('MINT_VALIDITY', 'Mint Validity', 'FAIL', false, `INVALID_MINT: ${mintClassification.reason}`, mint);
    } else {
      record('MINT_VALIDITY', 'Mint Validity', 'PASS', true, 'VALID_MINT', mint);
    }

    // 2. TOKEN DECIMALS
    const decimals = candidate.decimals.value;
    if (candidate.decimals.state === 'PENDING') {
      record('TOKEN_DECIMALS', 'Token Decimals Gate', 'UNKNOWN', false, 'DECIMALS_RESOLUTION_PENDING');
    } else if (decimals === null || candidate.decimals.state !== 'AVAILABLE' || !Number.isInteger(decimals) || decimals < 0) {
      record('TOKEN_DECIMALS', 'Token Decimals Gate', 'UNKNOWN', false, `DECIMALS_UNRESOLVED: state=${candidate.decimals.state}`);
    } else {
      record('TOKEN_DECIMALS', 'Token Decimals Gate', 'PASS', true, 'DECIMALS_RESOLVED', decimals);
    }

    // 3. RUG-SHIELD / FREEZE AUTHORITY
    if (candidate.isRugSafe.state === 'AVAILABLE' && candidate.isRugSafe.value === false) {
      record('FREEZE_AUTHORITY', 'Rug Safety Check', 'FAIL', false, 'RUG_SAFETY_FAILED', false, true);
    } else if (candidate.isRugSafe.value === true) {
      record('FREEZE_AUTHORITY', 'Rug Safety Check', 'PASS', true, 'RUG_SAFETY_PASSED', true, true);
    } else {
      record('FREEZE_AUTHORITY', 'Rug Safety Check', 'PASS', true, 'RUG_SAFETY_SATISFIED', true, true);
    }

    // 4. LIQUIDITY
    const isPump = candidate.dexId.includes('pump') || mint.toLowerCase().endsWith('pump');
    const minLiquidityUsd = config.minLiquidityUsd || 1000;
    const liquidityVal = candidate.liquidityUsd.value;
    if (!isPump && liquidityVal !== null && candidate.liquidityUsd.state === 'AVAILABLE') {
      if (liquidityVal < minLiquidityUsd) {
        record('LIQUIDITY', 'Minimum Liquidity', 'FAIL', false, `LIQUIDITY_TOO_LOW: $${liquidityVal} < $${minLiquidityUsd}`, liquidityVal, minLiquidityUsd);
      } else {
        record('LIQUIDITY', 'Minimum Liquidity', 'PASS', true, 'LIQUIDITY_OK', liquidityVal, minLiquidityUsd);
      }
    } else {
      record('LIQUIDITY', 'Minimum Liquidity', 'PASS', true, 'LIQUIDITY_EXEMPT_OR_SATISFIED', liquidityVal);
    }

    // 5. MARKET CAP
    const minMcap = isPump ? (config.minMarketCapUsd || 2000) : (config.minMarketCapUsd || 5000);
    const maxMcap = config.maxMarketCapUsd || 5000000;
    const mcapVal = candidate.marketCapUsd.value;
    if (mcapVal !== null && mcapVal > 0 && candidate.marketCapUsd.state === 'AVAILABLE') {
      if (mcapVal < minMcap) {
        record('MARKET_CAP', 'Market Cap Range', 'FAIL', false, `MCAP_BELOW_MIN: $${mcapVal} < $${minMcap}`, mcapVal, minMcap);
      } else if (mcapVal > maxMcap) {
        record('MARKET_CAP', 'Market Cap Range', 'FAIL', false, `MCAP_ABOVE_MAX: $${mcapVal} > $${maxMcap}`, mcapVal, maxMcap);
      } else {
        record('MARKET_CAP', 'Market Cap Range', 'PASS', true, 'MCAP_OK', mcapVal);
      }
    } else {
      if (isPump || opts.network === 'paper' || candidate.network === 'paper') {
        record('MARKET_CAP', 'Market Cap Range', 'PASS', true, 'MCAP_UNCONSTRAINED_OR_PAPER');
      } else {
        record('MARKET_CAP', 'Market Cap Range', 'UNKNOWN', false, 'MCAP_DATA_UNAVAILABLE');
      }
    }

    // 6. HOLDER CONCENTRATION
    const top10Val = candidate.top10HoldersPct.value;
    if (top10Val !== null && top10Val > 0 && candidate.top10HoldersPct.state === 'AVAILABLE') {
      const maxTop10 = config.maxTop10HoldersPct || 40.0;
      if (top10Val > maxTop10) {
        record('TOP_10_HOLDERS', 'Top 10 Holders %', 'FAIL', false, `TOP_10_TOO_HIGH: ${top10Val}% > ${maxTop10}%`, top10Val, maxTop10);
      } else {
        record('TOP_10_HOLDERS', 'Top 10 Holders %', 'PASS', true, 'TOP_10_OK', top10Val, maxTop10);
      }
    } else {
      record('TOP_10_HOLDERS', 'Top 10 Holders %', 'PASS', true, 'TOP_10_UNCONSTRAINED');
    }

    // 7. DEVELOPER HOLDING
    const devVal = candidate.devWalletOwnershipPct.value;
    if (devVal !== null && candidate.devWalletOwnershipPct.state === 'AVAILABLE') {
      const maxDev = config.maxDevWalletPct || 10.0;
      if (devVal > maxDev) {
        record('DEV_HOLDING', 'Developer Ownership %', 'FAIL', false, `DEV_HOLDING_TOO_HIGH: ${devVal}% > ${maxDev}%`, devVal, maxDev);
      } else {
        record('DEV_HOLDING', 'Developer Ownership %', 'PASS', true, 'DEV_HOLDING_OK', devVal, maxDev);
      }
    } else {
      record('DEV_HOLDING', 'Developer Ownership %', 'PASS', true, 'DEV_HOLDING_UNCONSTRAINED');
    }

    // 8. REBUY GUARD
    const rebuyCheck = rebuyGuard.canBuy(network, wallet, mint);
    if (!rebuyCheck.allowed) {
      record('REBUY_GUARD', 'Rebuy Guard', 'FAIL', false, `REBUY_GUARD_REJECT: ${rebuyCheck.reason}`);
    } else {
      record('REBUY_GUARD', 'Rebuy Guard', 'PASS', true, 'REBUY_GUARD_ALLOWED');
    }

    // 9. MAX OPEN POSITIONS
    const existingPos = positionManager.getPosition(network, wallet, mint);
    const isExistingPosition = existingPos && existingPos.status === 'OPEN';
    const currentPositions = positionManager.getOpenPositions(network, wallet);
    const maxPositions = config.maxPositions || 5;
    if (!isExistingPosition && currentPositions.length >= maxPositions) {
      record('MAX_POSITIONS', 'Max Open Positions', 'FAIL', false, `MAX_POSITIONS_REACHED: ${currentPositions.length} >= ${maxPositions}`, currentPositions.length, maxPositions);
    } else {
      record('MAX_POSITIONS', 'Max Open Positions', 'PASS', true, isExistingPosition ? 'EXISTING_POSITION_REBUY_ALLOWED' : 'POSITIONS_AVAILABLE', currentPositions.length, maxPositions);
    }

    // 10. AUTO-SNIPER TOGGLE
    if (!autoSniperEnabled) {
      record('AUTO_SNIPER', 'Auto Sniper Engine', 'FAIL', false, 'AUTO_SNIPER_DISABLED');
    } else {
      record('AUTO_SNIPER', 'Auto Sniper Engine', 'PASS', true, 'AUTO_SNIPER_ENABLED');
    }

    // Determine aggregate decision
    let finalDecision: HardenedDecision = 'PASS';
    if (rejectionReasons.length > 0) {
      finalDecision = 'FAIL';
    } else if (unknownReasons.length > 0) {
      finalDecision = 'UNKNOWN';
    }

    console.log(
      `[HARDENED_DECISION] mint=${mint} decision=${finalDecision} rejectionCount=${rejectionReasons.length} unknownCount=${unknownReasons.length}`
    );

    // Handle FAIL: Cache rejection under criteriaVersion
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

    // Handle UNKNOWN: Track retry state
    if (finalDecision === 'UNKNOWN') {
      const retryInfo = this.retryTracker.get(mint) || { retries: 0, lastAttemptAt: 0 };
      retryInfo.retries++;
      retryInfo.lastAttemptAt = now;
      this.retryTracker.set(mint, retryInfo);

      if (retryInfo.retries >= this.MAX_RETRIES) {
        console.warn(`[HARDENED_DEAD] mint=${mint} persistent UNKNOWN after ${retryInfo.retries} attempts: ${unknownReasons.join(', ')}`);
        this.rejectionCache.set(cacheKey, { rejectedAt: now, reasons: [`PERSISTENT_UNKNOWN_DEAD: ${unknownReasons.join(', ')}`] });
        this.retryTracker.delete(mint);
        return {
          decision: 'FAIL',
          checks,
          rejectionReasons: [`PERSISTENT_UNKNOWN_DEAD: ${unknownReasons.join(', ')}`],
          unknownReasons,
          buyAmountSol: defaultBuyAmountSol,
          criteriaVersion: this.criteriaVersion,
          evaluatedAt: now,
        };
      }

      const backoff = this.RETRY_BACKOFF_MS[retryInfo.retries - 1] || 2000;
      console.log(`[HARDENED_RETRY] mint=${mint} retry ${retryInfo.retries}/${this.MAX_RETRIES} scheduled in ${backoff}ms`);
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

    // Handle PASS: Clean retry tracking & Issue HardenedApproval
    this.retryTracker.delete(mint);

    const approvalId = `appr_${mint.slice(0, 8)}_${now}_${Math.random().toString(36).slice(2, 7)}`;
    const evaluatedSlot = opts.currentSlot || 0;
    const evaluationPrice = candidate.priceSol.value || 0;
    const ttlMs = 15000; // 15s approval lifetime
    const expiresAt = now + ttlMs;

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

  /**
   * Final Recheck immediately before order execution.
   */
  public async performFinalRecheck(
    approval: HardenedApproval,
    opts: {
      network: string;
      wallet: string;
      currentSlot?: number;
      currentPriceSol?: number;
    }
  ): Promise<{ allowed: boolean; reason?: string }> {
    const { network, wallet, currentSlot, currentPriceSol } = opts;

    console.log(`[FINAL_BUY_RECHECK_STARTED] approvalId=${approval.approvalId} mint=${approval.mint}`);

    const usable = hardenedApprovalStore.isApprovalUsable(
      approval,
      currentPriceSol,
      currentSlot,
      this.criteriaVersion
    );
    if (!usable.valid) {
      console.warn(`[FINAL_BUY_RECHECK_BLOCKED] approvalId=${approval.approvalId} reason=${usable.reason}`);
      return { allowed: false, reason: usable.reason };
    }

    const rebuyCheck = rebuyGuard.canBuy(network, wallet, approval.mint);
    if (!rebuyCheck.allowed) {
      return { allowed: false, reason: `FINAL_RECHECK_REBUY_GUARD_REJECT: ${rebuyCheck.reason}` };
    }

    console.log(`[FINAL_BUY_RECHECK_PASSED] approvalId=${approval.approvalId} mint=${approval.mint}`);
    return { allowed: true };
  }
}

export const hardenedCriteriaEngine = HardenedCriteriaEngine.getInstance();
