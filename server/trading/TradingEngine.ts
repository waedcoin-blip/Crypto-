// server/trading/TradingEngine.ts
import { orderManager, Order } from './OrderManager.js';
import { positionManager, Position } from './PositionManager.js';
import { rebuyGuard } from './RebuyGuard.js';
import { riskManager } from './RiskManager.js';
import { pnlEngine, PnLMetrics } from './PnLEngine.js';
import { executionGateway } from '../execution/ExecutionGateway.js';
import { ExecutionResult } from '../execution/TradeExecutor.js';
import { tradeRepository } from '../repositories/TradeRepository.js';
import { tokenProgramResolver } from '../wallet/TokenProgramResolver.js';
import { unifiedExitEngine } from './UnifiedExitEngine.js';
import { HardenedApproval } from '../types/index.js';
import { hardenedApprovalStore } from './HardenedApprovalStore.js';
import { hardenedCriteriaEngine } from './HardenedCriteriaEngine.js';
import { candidateEnricher } from './CandidateEnricher.js';
import { candidateRegistry } from '../market/CandidateRegistry.js';

export interface BuyParams {
  network: string;
  wallet: string;
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
  trailingSlPct?: number;
  maxHoldTimeMs?: number;
  pool?: string;
  approval?: HardenedApproval;
}

export interface SellParams {
  network: string;
  wallet: string;
  mint: string;
  amountRaw?: number; // Optional, defaults to full position amount
  slippageBps?: number;
  clientRequestId?: string;
  reason?: 'TP' | 'SL' | 'MANUAL' | 'FORCE_EXIT' | string;
}

export interface TradeEngineResponse {
  success: boolean;
  orderId?: string;
  positionId?: string;
  signature?: string;
  error?: string;
  result?: ExecutionResult;
}

export class TradingEngine {
  private static instance: TradingEngine;
  private buyLocks: Map<string, Promise<void>> = new Map();

  private constructor() {}

  private async withBuyWalletLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.buyLocks.get(key) || Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    const queued = previous.then(() => current);
    this.buyLocks.set(key, queued);
    await previous;
    try { return await fn(); } finally {
      release();
      if (this.buyLocks.get(key) === queued) this.buyLocks.delete(key);
    }
  }

  public static getInstance(): TradingEngine {
    if (!TradingEngine.instance) {
      TradingEngine.instance = new TradingEngine();
    }
    return TradingEngine.instance;
  }

  /**
   * Centralized BUY execution.
   * Flow: TradingEngine -> RebuyGuard (Reserve) -> OrderManager -> ExecutionGateway -> PositionManager.
   */
  public async buy(params: BuyParams): Promise<TradeEngineResponse> {
    let network: string;
    try {
      network = executionGateway.resolveNetwork(params.network);
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || String(err),
      };
    }

    if (!params.amountSol || !Number.isFinite(params.amountSol) || params.amountSol <= 0) {
      return {
        success: false,
        error: `INVALID_AMOUNT: Buy amount SOL must be a positive finite number, received ${params.amountSol}`,
      };
    }

    const wallet = params.wallet || 'default';
    const lockKey = `${network}:${wallet}`;
    return this.withBuyWalletLock(lockKey, () => this.buyUnlocked({ ...params, network, wallet }));
  }

  private async buyUnlocked(params: BuyParams): Promise<TradeEngineResponse> {
    const network = executionGateway.resolveNetwork(params.network);
    const wallet = params.wallet || 'default';
    const mint = (params.mint || '').trim();
    if (!mint) {
      return {
        success: false,
        error: 'INVALID_MINT: Mint address is required.',
      };
    }

    const clientRequestId = params.clientRequestId || `buy_${mint.slice(0, 8)}_${Date.now()}`;
    const rawLamports = params.amountSol * 1e9;
    if (!Number.isInteger(Math.round(rawLamports)) || rawLamports <= 0) {
      return {
        success: false,
        error: `INVALID_AMOUNT: Non-integer or non-positive lamports calculated: ${rawLamports}`,
      };
    }
    const amountLamports = Math.floor(rawLamports);
    const slippageBps = params.slippageBps || 250;

    // 1. Fetch token decimals first (resolves from params, existing position, or chain/cache)
    let decimals = params.decimals;
    if (decimals === undefined || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
      const existingPos = positionManager.getPosition(network, wallet, mint);
      if (existingPos?.decimals !== undefined && Number.isInteger(existingPos.decimals)) {
        decimals = existingPos.decimals;
      } else {
        try {
          const executor = executionGateway.getExecutor(network) as any;
          const tokenInfo = await tokenProgramResolver.resolve(
            executor?.connection || null,
            mint
          );
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

    // 2. Authoritative Invariant: NO TOKEN MAY REACH BUY EXECUTION WITHOUT A CURRENT, VALID, SINGLE-USE, MINT/POOL-BOUND HardenedApproval
    let approval = params.approval;
    if (!approval) {
      approval = hardenedApprovalStore.getLatestUsableApproval('solana', mint, params.pool);
    }

    if (!approval) {
      console.log(`[TradingEngine] No pre-existing HardenedApproval for ${mint}. Running authoritative HardenedCriteriaEngine evaluation...`);
      const candidate = await candidateEnricher.enrichCandidate(mint, network);
      const evalResult = await hardenedCriteriaEngine.evaluateCandidate(candidate, { network, wallet });
      if (evalResult.decision !== 'PASS' || !evalResult.approval) {
        console.warn(`[TradingEngine] BUY REJECTED: Candidate ${mint} failed hardened criteria. Reasons: ${evalResult.rejectionReasons.join(', ')}`);
        return {
          success: false,
          error: `NO_VALID_HARDENED_APPROVAL: Token failed hardened criteria: ${evalResult.rejectionReasons.join(', ') || 'CRITERIA_FAILED'}`,
        };
      }
      approval = evalResult.approval;
    }

    // Perform final recheck right before order execution
    const finalRecheck = await hardenedCriteriaEngine.performFinalRecheck(approval, { network, wallet });
    if (!finalRecheck.allowed) {
      console.warn(`[TradingEngine] BUY REJECTED by final recheck: ${finalRecheck.reason}`);
      hardenedApprovalStore.markInvalid(approval.approvalId, finalRecheck.reason);
      return {
        success: false,
        error: `FINAL_RECHECK_FAILED: ${finalRecheck.reason}`,
      };
    }

    // Mark approval as CONSUMING
    hardenedApprovalStore.startConsuming(approval.approvalId, clientRequestId);

    // 3. RebuyGuard Reservation Check
    let reservation;
    try {
      reservation = rebuyGuard.reserveBuy({
        network,
        wallet,
        mint,
        amountSol: params.amountSol,
        maxRebuyTimes: params.maxRebuyTimes,
        tradeOnlyOnce: params.tradeOnlyOnce,
      });
    } catch (err: any) {
      hardenedApprovalStore.markInvalid(approval.approvalId, err?.message || 'REBUY_GUARD_REJECTED');
      return {
        success: false,
        error: err?.message || String(err),
      };
    }

    // 4. Create Order in OrderManager
    const order = orderManager.createOrder({
      network,
      wallet,
      mint,
      side: 'buy',
      amount: amountLamports,
      decimals,
      slippageBps,
      clientRequestId,
      label: params.label || 'entry',
    });

    // 5. Execute Order
    try {
      const execResult = await orderManager.executeOrder(order.id);

      if (!execResult.success) {
        if (execResult.isAmbiguous || execResult.signature || execResult.status === 'RECOVERY_REQUIRED') {
          console.warn(`[TradingEngine] Buy transaction for ${mint} broadcasted or timed out (sig=${execResult.signature}). Retaining rebuy reservation to prevent duplicate spend.`);
          hardenedApprovalStore.markInvalid(approval.approvalId, 'UNKNOWN_STATUS');
          rebuyGuard.holdBuy(reservation.reservationId, execResult.signature, 'UNKNOWN_STATUS');
          return {
            success: false,
            orderId: order.id,
            signature: execResult.signature,
            error: `RECOVERY_REQUIRED: Transaction broadcast or confirmation timeout (${execResult.error}). Rebuy reservation retained.`,
            result: execResult,
          };
        }

        // Release reservation only on definite pre-broadcast failure or verified expiration
        hardenedApprovalStore.markInvalid(approval.approvalId, execResult.error || 'EXEC_FAILED');
        rebuyGuard.releaseBuy(reservation.reservationId);
        return {
          success: false,
          orderId: order.id,
          error: execResult.error,
          result: execResult,
        };
      }

      // 6. Update the authoritative position first, then persist the
      // confirmed BUY so rebuy limits survive worker/server restarts.
      const position = positionManager.openOrAccumulatePosition({
        network,
        wallet,
        mint,
        tokenAmountRaw: execResult.outAmountRaw,
        decimals,
        solSpent: execResult.totalCostSol || params.amountSol,
        orderId: order.id,
        buySignature: execResult.signature,
        tpPct: params.tpPct,
        slPct: params.slPct,
        trailingSlPct: params.trailingSlPct,
        maxHoldTimeMs: params.maxHoldTimeMs,
      });

      hardenedApprovalStore.markConsumed(approval.approvalId, order.id);
      rebuyGuard.confirmBuy(reservation.reservationId);
      candidateRegistry.updateCandidateState(network, mint, 'BOUGHT');
      tradeRepository.recordTrade({
        id: `trade_${order.id}`,
        orderId: order.id,
        positionId: position.id,
        mintAddress: mint,
        side: 'BUY',
        network,
        wallet,
        amountRaw: execResult.outAmountRaw,
        amountTokens: execResult.outAmountRaw / (10 ** position.decimals),
        solAmount: execResult.totalCostSol || params.amountSol,
        priceSOL: execResult.effectivePriceSol || position.averageEntryPrice,
        signature: execResult.signature || order.id,
        timestamp: Date.now(),
        status: 'CONFIRMED',
      });

      return {
        success: true,
        orderId: order.id,
        positionId: position.id,
        signature: execResult.signature,
        result: execResult,
      };
    } catch (err: any) {
      hardenedApprovalStore.markInvalid(approval.approvalId, err?.message || 'UNCAUGHT_ERROR');
      const orderRecord = orderManager.getOrderById(order.id);
      if (orderRecord?.transactionSignature || orderRecord?.status === 'RECOVERY_REQUIRED') {
        console.warn(`[TradingEngine] Buy caught error but transaction signature exists (${orderRecord.transactionSignature}). Retaining reservation.`);
        rebuyGuard.holdBuy(reservation.reservationId, orderRecord.transactionSignature, 'UNCAUGHT_ERROR');
        return {
          success: false,
          orderId: order.id,
          signature: orderRecord.transactionSignature,
          error: `RECOVERY_REQUIRED: ${err?.message || String(err)}`,
        };
      }
      rebuyGuard.releaseBuy(reservation.reservationId);
      return {
        success: false,
        orderId: order.id,
        error: err?.message || String(err),
      };
    }
  }

  /**
   * Centralized SELL execution.
   */
  public async sell(params: SellParams): Promise<TradeEngineResponse> {
    let network: string;
    try {
      network = executionGateway.resolveNetwork(params.network);
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || String(err),
      };
    }

    const wallet = params.wallet || 'default';
    const mint = (params.mint || '').trim();
    if (!mint) {
      return {
        success: false,
        error: 'INVALID_MINT: Mint address is required for sell.',
      };
    }

    const position = positionManager.getPosition(network, wallet, mint);
    if (!position) {
      return {
        success: false,
        error: `POSITION_NOT_FOUND: No active position for mint ${mint} on ${network}`,
      };
    }

    if (position.status === 'EXIT_PENDING' || position.status === 'RECOVERY_REQUIRED') {
      return {
        success: false,
        error: `EXIT_ALREADY_PENDING: Position ${position.id} has status ${position.status} and is already in exit/recovery pipeline.`,
      };
    }

    const rawAmount = params.amountRaw !== undefined ? params.amountRaw : position.tokenAmount;
    if (rawAmount <= 0) {
      return {
        success: false,
        error: `INVALID_AMOUNT: Sell amount must be greater than 0, received ${rawAmount}`,
      };
    }

    // Delegate authorization and execution entirely to UnifiedExitEngine
    const exitRes = await unifiedExitEngine.executeManualExitDetail(position.id);
    if (exitRes.success) {
      // Re-fetch the closed/closing position details to return response
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
        error: exitRes.error || `EXIT_FAILED: Manual sell request rejected or already in exit pipeline.`,
        result: exitRes.result,
      };
    }
  }

  public async rebuy(params: BuyParams): Promise<TradeEngineResponse> {
    const existingPos = positionManager.getPosition(params.network || 'paper', params.wallet || 'default', params.mint);
    return this.buy({
      decimals: existingPos?.decimals ?? params.decimals,
      ...params,
      label: 'rebuy',
    });
  }

  public async cancel(orderId: string): Promise<boolean> {
    const order = orderManager.getOrderById(orderId);
    if (!order) return false;
    if (['FILLED', 'FAILED', 'CANCELLED'].includes(order.status)) return false;

    orderManager.updateOrderStatus(orderId, 'CANCELLED');
    return true;
  }

  public getPosition(network: string, wallet: string, mint: string): Position | undefined {
    return positionManager.getPosition(network, wallet, mint);
  }

  public getOrders(filters?: { network?: string; wallet?: string; mint?: string; side?: string }): Order[] {
    return orderManager.getOrders(filters);
  }

  public getStatus(): { isRunning: boolean; activePositions: number; openOrders: number } {
    const activePositions = positionManager.getOpenPositions().length;
    const openOrders = orderManager.getOrders().filter(o => ['CREATED', 'PENDING', 'SUBMITTED', 'CONFIRMING'].includes(o.status)).length;
    return {
      isRunning: true,
      activePositions,
      openOrders,
    };
  }
}

export const tradingEngine = TradingEngine.getInstance();
