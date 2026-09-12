// server/trading/TradingEngine.ts
import { executionGateway } from '../execution/ExecutionGateway.js';
import { orderManager } from './OrderManager.js';
import { positionManager, Position } from './PositionManager.js';
import { tokenProgramResolver } from '../wallet/TokenProgramResolver.js';
import { tokenMintResolver } from '../market/TokenMintResolver.js';
import { hardenedApprovalStore } from './HardenedApprovalStore.js';
import type { HardenedApproval } from './HardenedApprovalStore.js';
import { hardenedCriteriaEngine } from './HardenedCriteriaEngine.js';
import { candidateEnricher } from './CandidateEnricher.js';
import { rebuyGuard } from './RebuyGuard.js';
import { riskManager } from './RiskManager.js';
import { candidateRegistry } from '../market/CandidateRegistry.js';
import { tradeRepository } from '../repositories/TradeRepository.js';
import { tokenRepository } from '../repositories/TokenRepository.js';
import { unifiedExitEngine } from './UnifiedExitEngine.js';
import { tradingConfigManager } from '../config/TradingConfig.js';
import { logger } from '../utils/logger.js';

export interface BuyParams {
  network: string;
  wallet?: string;
  mint: string;
  amountSol: number;
  decimals?: number;
  slippageBps?: number;
  maxRebuyTimes?: number;
  tradeOnlyOnce?: boolean;
  clientRequestId?: string;
  label?: string;
  tpPct?: number;
  slPct?: number;
  approval?: HardenedApproval;
  pool?: string;
}

export interface SellParams {
  network: string;
  wallet?: string;
  mint: string;
  amountRaw?: string | number | bigint;
  slippageBps?: number;
  clientRequestId?: string;
  reason?: string;
}

export interface TradeEngineResponse {
  success: boolean;
  orderId?: string;
  positionId?: string;
  signature?: string;
  error?: string;
  status?: 'success' | 'rejected' | 'error';
  reason?: string;
  stage?: string;
  result?: any;
}

export class TradingEngine {
  private static instance: TradingEngine;
  private buyLocks: Map<string, Promise<any>> = new Map();

  private constructor() {}

  public static getInstance(): TradingEngine {
    if (!TradingEngine.instance) {
      TradingEngine.instance = new TradingEngine();
    }
    return TradingEngine.instance;
  }

  // ==========================================
  // BUY — Top-level with error boundary
  // ==========================================

  public async buy(params: BuyParams): Promise<TradeEngineResponse> {
    let network: string;
    try {
      network = executionGateway.resolveNetwork(params.network);
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) };
    }

    if (!params.amountSol || !Number.isFinite(params.amountSol) || params.amountSol <= 0) {
      return {
        success: false,
        error: `INVALID_AMOUNT: Buy amount SOL must be a positive finite number, received ${params.amountSol}`,
      };
    }

    const wallet = params.wallet || 'default';
    const lockKey = `${network}:${wallet}`;

    // FIX: Top-level error boundary prevents HTTP 500 crashes
    try {
      return await this.withBuyWalletLock(lockKey, () => this.buyUnlocked({ ...params, network, wallet }));
    } catch (err: any) {
      const errorMsg = err?.message || String(err);
      logger.error({ mint: params.mint, error: errorMsg }, '[TradingEngine] UNCAUGHT BUY ERROR');
      return {
        success: false,
        error: `INTERNAL_BUY_ERROR: ${errorMsg}`,
        status: 'rejected',
        reason: 'UNCAUGHT_EXCEPTION',
        stage: 'EXECUTION',
      };
    }
  }

  // ==========================================
  // BUY — Unlocked (serialized per wallet)
  // ==========================================

  private async buyUnlocked(params: BuyParams): Promise<TradeEngineResponse> {
    const network = executionGateway.resolveNetwork(params.network);
    const wallet = params.wallet || 'default';
    const mint = (params.mint || '').trim();
    const clientRequestId = params.clientRequestId || `buy_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    if (!mint) {
      return { success: false, error: 'INVALID_MINT: Mint address is required.' };
    }

    // ---- 0. On-Chain Canonical Mint Validation Gate ----
    try {
      if (network !== 'paper') {
        const executor = executionGateway.getExecutor(network) as any;
        const connection = executor?.connection || null;
        const mintValidation = await tokenMintResolver.validateTokenMint(mint, connection);
        if (!mintValidation.ok) {
          if (mintValidation.code === 'INVALID_MINT') {
            return {
              success: false,
              error: `BUY REJECTED: Invalid token mint ${mint} (${mintValidation.reason})`,
              status: 'rejected',
              reason: 'INVALID_MINT',
              stage: 'MINT_VALIDATION',
            };
          }
          return {
            success: false,
            error: `MINT_VALIDATION_UNAVAILABLE: ${mintValidation.reason}`,
            status: 'error',
            reason: mintValidation.code,
            stage: 'MINT_VALIDATION',
          };
        }
      } else {
        console.log('[TradingEngine] BUY Stage MINT_VALIDATION check:', {
          suppliedMint: params.mint,
          suppliedMintLength: params.mint?.length,
          canonicalMint: mint,
          canonicalMintLength: mint?.length,
          isValidPublicKey: tokenMintResolver.isValidPublicKey(mint)
        });
        if (!tokenMintResolver.isValidPublicKey(mint)) {
          return {
            success: false,
            error: `BUY REJECTED: Invalid token mint ${mint} (INVALID_PUBLIC_KEY_FORMAT)`,
            status: 'rejected',
            reason: 'INVALID_MINT',
            stage: 'MINT_VALIDATION',
          };
        }
      }
    } catch (err: any) {
      return {
        success: false,
        error: `MINT_VALIDATION_ERROR: ${err?.message || String(err)}`,
        status: 'rejected',
        reason: 'MINT_VALIDATION_ERROR',
        stage: 'MINT_VALIDATION',
      };
    }

    // ---- 1. Resolve Token Decimals ----
    let decimals = params.decimals;
    if (decimals === undefined || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
      const existingPos = positionManager.getPosition(network, wallet, mint);
      if (existingPos?.decimals !== undefined && Number.isInteger(existingPos.decimals)) {
        decimals = existingPos.decimals;
      } else {
        try {
          const executor = executionGateway.getExecutor(network) as any;
          const tokenInfo = await tokenProgramResolver.resolve(executor?.connection || null, mint);
          decimals = tokenInfo.decimals;
        } catch (err: any) {
          if (network === 'paper') {
            decimals = 6;
          } else {
            return {
              success: false,
              error: `UNRESOLVED_TOKEN_DECIMALS: Could not resolve decimals for ${mint} on ${network}: ${err?.message || err}`,
            };
          }
        }
      }
    }

    // ---- 2. HardenedApproval Invariant ----
    try {
      let approval = params.approval;
      if (!approval) {
        if (network === 'paper') {
          // Bypass in paper mode, will be created below
        } else {
          const currentPrice = candidateEnricher.enrichCandidate(mint, network)
            .then(c => c.priceSol?.value)
            .catch(() => undefined);
          const currentSlot = 0;
          approval = hardenedApprovalStore.getLatestUsableApproval(
            'solana', mint, params.pool, await currentPrice, currentSlot
          );
        }
      }

      if (!approval) {
        if (network === 'paper') {
          const now = Date.now();
          approval = {
            approvalId: `appr_paper_${now}_${Math.random().toString(36).slice(2, 8)}`,
            chain: 'solana',
            mint,
            criteriaVersion: '1.0.0',
            evaluatedAt: now,
            evaluatedSlot: 0,
            evaluationPrice: 0.00001,
            maxSlotLag: 100000,
            maxPriceDeviationPct: 100,
            expiresAt: now + 300000,
            checks: [{ ruleId: 'PAPER_AUTO', name: 'Paper Mode Auto Approval', status: 'PASS', passed: true }],
            decisionHash: 'paper_hash',
            correlationId: `corr_paper_${mint.slice(0, 8)}_${now}`,
            state: 'ISSUED',
          };
          hardenedApprovalStore.issueApproval(approval);
        } else {
          logger.info({ mint }, '[TradingEngine] No pre-existing approval. Running HardenedCriteriaEngine...');
          const candidate = await candidateEnricher.enrichCandidate(mint, network);

          if (!candidate.isEnriched) {
            return {
              success: false,
              error: `ENRICHMENT_DATA_UNAVAILABLE: Could not obtain market data for ${mint}`,
              status: 'rejected',
              reason: 'ENRICHMENT_DATA_UNAVAILABLE',
              stage: 'ENRICHMENT',
            };
          }

          const evalResult = await hardenedCriteriaEngine.evaluateCandidate(candidate, { network, wallet });
          if (evalResult.decision !== 'PASS' || !evalResult.approval) {
            return {
              success: false,
              error: `NO_VALID_HARDENED_APPROVAL: ${evalResult.rejectionReasons.join(', ') || 'CRITERIA_FAILED'}`,
              status: 'rejected',
              reason: evalResult.rejectionReasons.join(', ') || 'CRITERIA_FAILED',
              stage: 'HARDENED_APPROVAL',
            };
          }
          approval = evalResult.approval;
        }
      }

      // Final recheck before broadcast
      const finalRecheck = await hardenedCriteriaEngine.performFinalRecheck(approval, { network, wallet });
      if (!finalRecheck.allowed) {
        hardenedApprovalStore.markInvalid(approval.approvalId, finalRecheck.reason);
        return {
          success: false,
          error: `FINAL_RECHECK_FAILED: ${finalRecheck.reason}`,
          status: 'rejected',
          reason: finalRecheck.reason,
          stage: 'FINAL_RECHECK',
        };
      }

      hardenedApprovalStore.startConsuming(approval.approvalId, clientRequestId);
    } catch (err: any) {
      return {
        success: false,
        error: `APPROVAL_RESOLUTION_ERROR: ${err?.message || String(err)}`,
        status: 'rejected',
        reason: 'APPROVAL_RESOLUTION_ERROR',
        stage: 'HARDENED_APPROVAL',
      };
    }

    // ---- 3. RebuyGuard Reservation ----
    const config = tradingConfigManager.getConfig();
    const maxRebuys = params.maxRebuyTimes ?? config.maxPositions;
    const reservation = rebuyGuard.reserveBuy({
      network,
      wallet,
      mint,
      amountSol: params.amountSol,
      maxRebuyTimes: maxRebuys,
    });

    if (!reservation || !reservation.reservationId) {
      return {
        success: false,
        error: `REBUY_GUARD_BLOCKED: ${reservation?.reason || 'Reservation failed'}`,
        status: 'rejected',
        reason: 'REBUY_GUARD_BLOCKED',
        stage: 'REBUY_GUARD',
      };
    }

    // ---- 4. Risk Manager Final Revalidation ----
    const amountLamports = BigInt(Math.floor(params.amountSol * 1e9));
    const revalidation = await riskManager.revalidateBuyBeforeBroadcast({
      mint,
      buyAmountLamports: amountLamports,
      network,
      wallet,
    });

    if (!revalidation.allowed) {
      rebuyGuard.releaseReservation(reservation.reservationId);
      return {
        success: false,
        error: `RISK_REVALIDATION_FAILED: ${revalidation.reason}`,
        status: 'rejected',
        reason: revalidation.reason,
        stage: 'RISK_REVALIDATION',
      };
    }

    // ---- 5. Create Order ----
    const order = orderManager.createOrder({
      network,
      wallet,
      mint,
      side: 'buy',
      amount: amountLamports,
      decimals: decimals!,
      slippageBps: params.slippageBps || config.maxSlippageBps,
      clientRequestId,
      label: params.label || 'entry',
    });

    // ---- 6. Execute Order ----
    let execResult;
    try {
      execResult = await orderManager.executeOrder(order.id);
    } catch (err: any) {
      rebuyGuard.releaseReservation(reservation.reservationId);
      return {
        success: false,
        error: `EXECUTION_FAILED: ${err?.message || String(err)}`,
        status: 'error',
        reason: 'EXECUTION_FAILED',
        stage: 'EXECUTION',
      };
    }

    if (!execResult.success) {
      rebuyGuard.releaseReservation(reservation.reservationId);
      return {
        success: false,
        orderId: order.id,
        error: execResult.error || 'EXECUTION_FAILED',
        status: 'error',
        reason: execResult.error,
        stage: 'EXECUTION',
      };
    }

    // ---- 7. Create/Update Position ----
    const outAmountRaw = execResult.outAmountRaw || '0';
    const position = positionManager.openOrAccumulatePosition({
      network,
      wallet,
      mint,
      tokenAmountRaw: outAmountRaw,
      decimals: decimals!,
      solSpent: params.amountSol,
      orderId: order.id,
      buySignature: execResult.signature,
      tpPct: params.tpPct ?? config.tpPct,
      slPct: params.slPct ?? config.slPct,
    });

    // ---- 8. Finalize ----
    const approval = hardenedApprovalStore.getApprovalByClientRequestId(clientRequestId);
    if (approval) {
      hardenedApprovalStore.markConsumed(approval.approvalId, order.id);
    }
    rebuyGuard.confirmBuy(reservation.reservationId);
    riskManager.recordBuySuccess(network, wallet, mint);
    candidateRegistry.updateCandidateState(network, mint, 'BOUGHT');
    tokenRepository.setExecutionState(mint, 'HELD', position.id);

    tradeRepository.recordTrade({
      id: `trade_${order.id}`,
      orderId: order.id,
      positionId: position.id,
      mintAddress: mint,
      side: 'BUY',
      network,
      wallet,
      amountRaw: typeof outAmountRaw === 'bigint' ? outAmountRaw.toString() : String(outAmountRaw),
      amountTokens: position.tokenAmount,
      solAmount: params.amountSol,
      priceSOL: position.averageEntryPrice,
      signature: execResult.signature,
      timestamp: Date.now(),
      status: 'CONFIRMED',
    });

    logger.info({ mint, orderId: order.id, positionId: position.id, signature: execResult.signature }, '[TradingEngine] BUY CONFIRMED');

    return {
      success: true,
      orderId: order.id,
      positionId: position.id,
      signature: execResult.signature,
      status: 'success',
    };
  }

  // ==========================================
  // SELL
  // ==========================================

  public async sell(params: SellParams): Promise<TradeEngineResponse> {
    let network: string;
    try {
      network = executionGateway.resolveNetwork(params.network);
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) };
    }

    const wallet = params.wallet || 'default';
    const mint = (params.mint || '').trim();
    if (!mint) {
      return { success: false, error: 'INVALID_MINT: Mint address is required for sell.' };
    }

    const position = positionManager.getPosition(network, wallet, mint);
    if (!position) {
      return { success: false, error: `POSITION_NOT_FOUND: No active position for mint ${mint} on ${network}` };
    }
    if (position.status === 'EXIT_PENDING' || position.status === 'RECOVERY_REQUIRED') {
      return { success: false, error: `EXIT_ALREADY_PENDING: Position ${position.id} has status ${position.status}` };
    }

    // FIX: Safe fallback for legacy positions with float tokenAmount
    const fallbackAmount = position.tokenAmountRaw
      ? String(position.tokenAmountRaw)
      : String(Math.floor(position.tokenAmount * (10 ** position.decimals)));

    const rawAmountStr = params.amountRaw !== undefined ? String(params.amountRaw).trim() : fallbackAmount;

    let rawAmountBigInt: bigint;
    try {
      if (!/^\d+$/.test(rawAmountStr)) throw new Error('NON_INTEGER');
      rawAmountBigInt = BigInt(rawAmountStr);
      if (rawAmountBigInt <= 0n) throw new Error('NON_POSITIVE');
    } catch {
      return {
        success: false,
        error: `INVALID_AMOUNT: Sell amount must be a positive integer raw amount, received ${rawAmountStr}`,
      };
    }

    // Delegate to UnifiedExitEngine (single exit authority)
    const exitRes = await unifiedExitEngine.executeManualExitDetail(position.id);
    if (exitRes.success) {
      const updatedPos = positionManager.getPositionById(position.id);
      return {
        success: true,
        positionId: position.id,
        signature: exitRes.signature || updatedPos?.exitSignature,
        result: exitRes.result,
      };
    } else {
      return {
        success: false,
        positionId: position.id,
        signature: exitRes.signature,
        error: exitRes.error || 'EXIT_FAILED',
        result: exitRes.result,
      };
    }
  }

  public async rebuy(params: BuyParams): Promise<TradeEngineResponse> {
    // Rebuy is semantically a buy that accumulates cost basis
    return this.buy({ ...params, decimals: params.decimals ?? 6 });
  }

  // ==========================================
  // WALLET LOCK (Serializes buys per wallet)
  // ==========================================

  private async withBuyWalletLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.buyLocks.get(key) || Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    const queued = previous.then(() => current);
    this.buyLocks.set(key, queued);

    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.buyLocks.get(key) === queued) this.buyLocks.delete(key);
    }
  }

  // ==========================================
  // STATUS
  // ==========================================

  public getEngineStatus() {
    return {
      isRunning: true,
      activeBuyLocks: this.buyLocks.size,
      activePositions: positionManager.getOpenPositions().length,
      openOrders: orderManager.getOrders().filter(o =>
        ['CREATED', 'PENDING', 'SUBMITTED', 'CONFIRMING'].includes(o.status)
      ).length,
    };
  }
}

export const tradingEngine = TradingEngine.getInstance();
