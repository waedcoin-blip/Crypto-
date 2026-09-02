// server/trading/TradingEngine.ts
import { orderManager, Order } from './OrderManager.js';
import { positionManager, Position } from './PositionManager.js';
import { rebuyGuard } from './RebuyGuard.js';
import { riskManager } from './RiskManager.js';
import { pnlEngine, PnLMetrics } from './PnLEngine.js';
import { executionGateway } from '../execution/ExecutionGateway.js';
import { ExecutionResult } from '../execution/TradeExecutor.js';
import { tradeRepository } from '../repositories/TradeRepository.js';

export interface BuyParams {
  network: string;
  wallet: string;
  mint: string;
  amountSol: number;
  slippageBps?: number;
  maxRebuyTimes?: number;
  tradeOnlyOnce?: boolean;
  clientRequestId?: string;
  label?: string;
  tpPct?: number;
  slPct?: number;
  trailingSlPct?: number;
  maxHoldTimeMs?: number;
  maxPositions?: number;
  tokenDecimals?: number;
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
    const network = params.network || 'paper';
    const wallet = params.wallet || 'default';
    const lockKey = `${network}:${wallet}`;
    return this.withBuyWalletLock(lockKey, () => this.buyUnlocked(params));
  }

  private async buyUnlocked(params: BuyParams): Promise<TradeEngineResponse> {
    const network = params.network || 'paper';
    const wallet = params.wallet || 'default';
    const mint = params.mint?.trim();
    if (!mint) return { success: false, error: 'INVALID_MINT: mint is required' };
    if (!Number.isFinite(params.amountSol) || params.amountSol <= 0) return { success: false, error: 'INVALID_AMOUNT: amountSol must be > 0' };
    if (!Number.isFinite(Number(params.slippageBps ?? 250)) || Number(params.slippageBps ?? 250) < 0) return { success: false, error: 'INVALID_SLIPPAGE: slippageBps must be >= 0' };
    const clientRequestId = params.clientRequestId || `buy_${mint.slice(0, 8)}_${Date.now()}`;
    const existingOrder = orderManager.getOrderByClientRequestId(network, wallet, mint, 'buy', clientRequestId);
    if (existingOrder) {
      if (existingOrder.status === 'FILLED') return { success: true, orderId: existingOrder.id, signature: existingOrder.transactionSignature };
      if (['CREATED', 'PENDING', 'SUBMITTED', 'CONFIRMING'].includes(existingOrder.status)) return { success: false, orderId: existingOrder.id, error: 'IDEMPOTENT_REQUEST_IN_PROGRESS' };
      return { success: false, orderId: existingOrder.id, error: existingOrder.error || 'IDEMPOTENT_REQUEST_ALREADY_FAILED' };
    }
    const configuredMaxPositions = Number(params.maxPositions ?? process.env.MAX_POSITIONS ?? 0);
    if (configuredMaxPositions > 0 && positionManager.getOpenPositions(network).filter(p => p.wallet === wallet).length >= configuredMaxPositions && !positionManager.getPosition(network, wallet, mint)) {
      return { success: false, error: `MAX_POSITIONS_REACHED: ${configuredMaxPositions}` };
    }
    const amountLamports = Math.floor(params.amountSol * 1e9);
    const slippageBps = params.slippageBps === undefined ? 250 : Math.max(0, Math.floor(params.slippageBps));

    // 1. RebuyGuard Reservation Check
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
      return {
        success: false,
        error: err?.message || String(err),
      };
    }

    // 2. Create Order in OrderManager
    const order = orderManager.createOrder({
      network,
      wallet,
      mint,
      side: 'buy',
      amount: amountLamports,
      slippageBps,
      clientRequestId,
      label: params.label || 'entry',
    });

    // 3. Execute Order
    try {
      const execResult = await orderManager.executeOrder(order.id);

      if (!execResult.success) {
        // Release reservation on failure so retry is permitted
        rebuyGuard.releaseBuy(reservation.reservationId);
        return {
          success: false,
          orderId: order.id,
          error: execResult.error,
          result: execResult,
        };
      }

      // 4. Update the authoritative position first, then persist the
      // confirmed BUY so rebuy limits survive worker/server restarts.
      const position = positionManager.openOrAccumulatePosition({
        network,
        wallet,
        mint,
        tokenAmountRaw: execResult.outAmountRaw,
        solSpent: execResult.totalCostSol || params.amountSol,
        orderId: order.id,
        buySignature: execResult.signature,
        tpPct: params.tpPct,
        slPct: params.slPct,
        trailingSlPct: params.trailingSlPct,
        maxHoldTimeMs: params.maxHoldTimeMs,
        decimals: execResult.outputDecimals ?? params.tokenDecimals,
      });

      rebuyGuard.confirmBuy(reservation.reservationId);
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
    const network = params.network || 'paper';
    const wallet = params.wallet || 'default';
    const mint = params.mint?.trim();
    if (!mint) return { success: false, error: 'INVALID_MINT: mint is required' };

    const position = positionManager.getPosition(network, wallet, mint);
    if (!position) {
      return {
        success: false,
        error: `POSITION_NOT_FOUND: No active position for mint ${mint} on ${network}`,
      };
    }

    const clientRequestId = params.clientRequestId || `sell_${mint.slice(0, 8)}_${Date.now()}`;
    const existingOrder = orderManager.getOrderByClientRequestId(network, wallet, mint, 'sell', clientRequestId);
    if (existingOrder) {
      if (existingOrder.status === 'FILLED') return { success: true, orderId: existingOrder.id, positionId: position.id, signature: existingOrder.transactionSignature };
      if (['CREATED', 'PENDING', 'SUBMITTED', 'CONFIRMING'].includes(existingOrder.status)) return { success: false, orderId: existingOrder.id, positionId: position.id, error: 'IDEMPOTENT_REQUEST_IN_PROGRESS' };
      return { success: false, orderId: existingOrder.id, positionId: position.id, error: existingOrder.error || 'IDEMPOTENT_REQUEST_ALREADY_FAILED' };
    }

    // Atomic Exit Reservation in RiskManager
    if (!riskManager.reserveExit(position.id)) {
      return { success: false, positionId: position.id, error: `EXIT_ALREADY_PENDING: Position ${position.id} is already in exit transition` };
    }
    positionManager.updatePositionStatus(network, wallet, mint, 'EXIT_PENDING');
    const sellAmountRaw = params.amountRaw !== undefined ? Number(params.amountRaw) : position.tokenAmount;
    if (!Number.isSafeInteger(sellAmountRaw) || sellAmountRaw <= 0 || sellAmountRaw > position.tokenAmount) {
      riskManager.releaseExit(position.id);
      positionManager.updatePositionStatus(network, wallet, mint, 'OPEN');
      return { success: false, positionId: position.id, error: `INVALID_SELL_AMOUNT: must be an integer raw amount between 1 and ${position.tokenAmount}` };
    }
    const slippageBps = params.slippageBps === undefined ? (params.reason === 'TP' ? position.slippageBpsTp : position.slippageBpsSl) : Math.max(0, Math.floor(params.slippageBps));

    const order = orderManager.createOrder({
      network,
      wallet,
      mint,
      side: 'sell',
      amount: sellAmountRaw,
      slippageBps,
      clientRequestId,
      label: params.reason || 'MANUAL',
    });

    try {
      const execResult = await orderManager.executeOrder(order.id);

      if (!execResult.success) {
        riskManager.releaseExit(position.id);
        positionManager.updatePositionStatus(network, wallet, mint, 'OPEN');
        return {
          success: false,
          orderId: order.id,
          positionId: position.id,
          error: execResult.error,
          result: execResult,
        };
      }

      const isFullExit = sellAmountRaw >= position.tokenAmount;
      const allocatedCost = position.totalSolSpent * (sellAmountRaw / position.tokenAmount);
      if (isFullExit) {
        positionManager.updatePositionStatus(network, wallet, mint, 'CLOSED', {
          exitSignature: execResult.signature,
          netProceedsSol: execResult.netProceedsSol,
        });
      } else {
        positionManager.reducePosition(network, wallet, mint, sellAmountRaw, execResult.netProceedsSol || 0, execResult.signature);
      }

      tradeRepository.recordTrade({
        id: `trade_${order.id}`,
        orderId: order.id,
        positionId: position.id,
        mintAddress: mint,
        side: 'SELL',
        network,
        wallet,
        amountRaw: sellAmountRaw,
        amountTokens: sellAmountRaw / (10 ** position.decimals),
        solAmount: execResult.netProceedsSol || 0,
        priceSOL: execResult.effectivePriceSol || 0,
        pnlSol: execResult.netProceedsSol !== undefined ? execResult.netProceedsSol - allocatedCost : undefined,
        signature: execResult.signature || order.id,
        timestamp: Date.now(),
        status: 'CONFIRMED',
      });

      riskManager.releaseExit(position.id);

      return {
        success: true,
        orderId: order.id,
        positionId: position.id,
        signature: execResult.signature,
        result: execResult,
      };
    } catch (err: any) {
      riskManager.releaseExit(position.id);
      positionManager.updatePositionStatus(network, wallet, mint, 'OPEN');
      return {
        success: false,
        orderId: order.id,
        positionId: position.id,
        error: err?.message || String(err),
      };
    }
  }

  public async rebuy(params: BuyParams): Promise<TradeEngineResponse> {
    return this.buy({
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
