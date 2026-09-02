// server/trading/TradingEngine.ts
import { orderManager, Order } from './OrderManager.js';
import { positionManager, Position } from './PositionManager.js';
import { rebuyGuard } from './RebuyGuard.js';
import { riskManager } from './RiskManager.js';
import { pnlEngine, PnLMetrics } from './PnLEngine.js';
import { executionGateway } from '../execution/ExecutionGateway.js';
import { ExecutionResult } from '../execution/TradeExecutor.js';

export interface BuyParams {
  network: string;
  wallet: string;
  mint: string;
  amountSol: number;
  slippageBps?: number;
  maxRebuyTimes?: number;
  clientRequestId?: string;
  label?: string;
  tpPct?: number;
  slPct?: number;
  trailingSlPct?: number;
  maxHoldTimeMs?: number;
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

  private constructor() {}

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
    const mint = params.mint.trim();
    const clientRequestId = params.clientRequestId || `buy_${mint.slice(0, 8)}_${Date.now()}`;
    const amountLamports = Math.floor(params.amountSol * 1e9);
    const slippageBps = params.slippageBps || 250;

    // 1. RebuyGuard Reservation Check
    let reservation;
    try {
      reservation = rebuyGuard.reserveBuy({
        network,
        wallet,
        mint,
        amountSol: params.amountSol,
        maxRebuyTimes: params.maxRebuyTimes,
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

      // 4. Confirm Buy and update PositionManager
      rebuyGuard.confirmBuy(reservation.reservationId);

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
    const mint = params.mint.trim();

    const position = positionManager.getPosition(network, wallet, mint);
    if (!position) {
      return {
        success: false,
        error: `POSITION_NOT_FOUND: No active position for mint ${mint} on ${network}`,
      };
    }

    // Atomic Exit Reservation in RiskManager
    if (!riskManager.reserveExit(position.id)) {
      return {
        success: false,
        positionId: position.id,
        error: `EXIT_ALREADY_PENDING: Position ${position.id} is already in exit transition`,
      };
    }

    positionManager.updatePositionStatus(network, wallet, mint, 'EXIT_PENDING');

    const sellAmountRaw = params.amountRaw || position.tokenAmount;
    const clientRequestId = params.clientRequestId || `sell_${mint.slice(0, 8)}_${Date.now()}`;
    const slippageBps = params.slippageBps || (params.reason === 'TP' ? position.slippageBpsTp : position.slippageBpsSl);

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

      // Close Position
      positionManager.updatePositionStatus(network, wallet, mint, 'CLOSED', {
        exitSignature: execResult.signature,
        netProceedsSol: execResult.netProceedsSol,
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
