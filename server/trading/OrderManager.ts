// server/trading/OrderManager.ts
import { orderRepository, OrderRecord } from '../repositories/OrderRepository.js';
import { ExecutionGateway, executionGateway } from '../execution/ExecutionGateway.js';
import { ExecutionResult } from '../execution/TradeExecutor.js';

export type OrderStatus =
  | 'CREATED'
  | 'PENDING'
  | 'SUBMITTED'
  | 'CONFIRMING'
  | 'FILLED'
  | 'PARTIALLY_FILLED'
  | 'FAILED'
  | 'CANCELLED'
  | 'RECOVERY_REQUIRED';

export interface Order {
  id: string;
  network: string;
  wallet: string;
  mint: string;
  side: 'buy' | 'sell';
  amount: bigint | string | number; // Raw integer base units or lamports
  decimals: number;
  slippageBps: number;
  status: OrderStatus;
  createdAt: number;
  updatedAt: number;
  clientRequestId: string;
  transactionSignature?: string;
  error?: string;
  label?: string;
  effectivePriceSol?: number;
  totalCostSol?: number;
  netProceedsSol?: number;
}

export class OrderManager {
  private static instance: OrderManager;
  private orders: Map<string, Order> = new Map();
  private idempotencyMap: Map<string, string> = new Map(); // idempotencyKey -> orderId

  private constructor() {
    this.loadFromRepository();
  }

  public static getInstance(): OrderManager {
    if (!OrderManager.instance) {
      OrderManager.instance = new OrderManager();
    }
    return OrderManager.instance;
  }

  private loadFromRepository(): void {
    const list = orderRepository.getOrders();
    for (const record of list) {
      const rawAmtStr = String(record.amount_raw || '0');
      const order: Order = {
        id: record.order_id,
        network: record.network || 'paper',
        wallet: record.wallet || 'default',
        mint: record.mint,
        side: record.side,
        amount: rawAmtStr,
        decimals: record.decimals !== undefined ? record.decimals : 9,
        slippageBps: record.slippageBps || 250,
        status: this.mapRecordStateToStatus(record.state),
        createdAt: record.created_at,
        updatedAt: record.updated_at,
        clientRequestId: record.order_id,
        transactionSignature: record.signature,
        error: record.error,
        label: record.label,
        effectivePriceSol: record.effectivePriceSol,
        totalCostSol: record.totalCostSol,
        netProceedsSol: record.netProceedsSol,
      };
      this.orders.set(order.id, order);

      const idempotencyKey = `${order.network}:${order.wallet}:${order.mint}:${order.side}:${order.clientRequestId}`;
      this.idempotencyMap.set(idempotencyKey, order.id);
    }
  }

  private mapRecordStateToStatus(state: string): OrderStatus {
    switch (state) {
      case 'CONFIRMED': return 'FILLED';
      case 'FAILED': return 'FAILED';
      case 'CANCELLED': return 'CANCELLED';
      case 'SUBMITTED': return 'SUBMITTED';
      case 'CONFIRMING': return 'CONFIRMING';
      case 'RECOVERY_REQUIRED': return 'RECOVERY_REQUIRED';
      default: return 'PENDING';
    }
  }

  public generateIdempotencyKey(
    network: string,
    wallet: string,
    mint: string,
    side: 'buy' | 'sell',
    clientRequestId: string
  ): string {
    return `${network}:${wallet}:${mint}:${side}:${clientRequestId}`;
  }

  public getOrderById(orderId: string): Order | undefined {
    return this.orders.get(orderId);
  }

  public getOrders(filters?: { network?: string; wallet?: string; mint?: string; side?: string }): Order[] {
    let result = Array.from(this.orders.values());
    if (filters?.network) result = result.filter(o => o.network === filters.network);
    if (filters?.wallet) result = result.filter(o => o.wallet === filters.wallet);
    if (filters?.mint) result = result.filter(o => o.mint === filters.mint);
    if (filters?.side) result = result.filter(o => o.side === filters.side);
    return result;
  }

  public createOrder(params: {
    network: string;
    wallet: string;
    mint: string;
    side: 'buy' | 'sell';
    amount: bigint | string | number;
    decimals: number;
    slippageBps: number;
    clientRequestId: string;
    label?: string;
  }): Order {
    const net = executionGateway.resolveNetwork(params.network);
    const idempotencyKey = this.generateIdempotencyKey(
      net,
      params.wallet,
      params.mint,
      params.side,
      params.clientRequestId
    );

    const existingId = this.idempotencyMap.get(idempotencyKey);
    if (existingId) {
      const existing = this.orders.get(existingId);
      if (existing) {
        return existing;
      }
    }

    const id = `ord_${params.mint.slice(0, 8)}_${params.side}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const now = Date.now();
    const order: Order = {
      id,
      network: net,
      wallet: params.wallet,
      mint: params.mint,
      side: params.side,
      amount: typeof params.amount === 'bigint' ? params.amount.toString() : params.amount,
      decimals: params.decimals,
      slippageBps: params.slippageBps,
      status: 'CREATED',
      createdAt: now,
      updatedAt: now,
      clientRequestId: params.clientRequestId,
      label: params.label,
    };

    this.orders.set(id, order);
    this.idempotencyMap.set(idempotencyKey, id);

    orderRepository.createOrder({
      order_id: id,
      mint: order.mint,
      wallet: order.wallet,
      side: order.side,
      amount_raw: String(order.amount),
      decimals: order.decimals,
      slippageBps: order.slippageBps,
      label: order.label,
      network: order.network,
      state: 'SIGNAL',
      created_at: now,
      updated_at: now,
    });

    return order;
  }

  public async executeOrder(
    orderId: string,
    preValidatedQuote?: any
  ): Promise<ExecutionResult> {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error(`ORDER_NOT_FOUND: ${orderId}`);
    }

    if (['FILLED', 'FAILED', 'CANCELLED'].includes(order.status)) {
      throw new Error(`ORDER_ALREADY_TERMINAL: Order ${orderId} is in status ${order.status}`);
    }

    this.updateOrderStatus(orderId, 'SUBMITTED');

    const executor = executionGateway.getExecutor(order.network);
    const executeParams = {
      inputMint: order.side === 'buy' ? 'So11111111111111111111111111111111111111112' : order.mint,
      outputMint: order.side === 'buy' ? order.mint : 'So11111111111111111111111111111111111111112',
      amount: order.amount,
      slippageBps: order.slippageBps,
      decimals: order.decimals,
      walletAddress: order.wallet,
      network: order.network,
      label: order.label,
      preValidatedQuote,
      clientRequestId: order.clientRequestId,
      onBroadcast: async (sig: string) => {
        order.transactionSignature = sig;
        order.status = 'CONFIRMING';
        order.updatedAt = Date.now();
        this.updateOrderStatus(orderId, 'CONFIRMING');
        await orderRepository.updateState(orderId, 'CONFIRMING', { signature: sig });
      },
    };

    try {
      this.updateOrderStatus(orderId, 'CONFIRMING');
      const result = order.side === 'buy'
        ? await executor.buy(executeParams)
        : await executor.sell(executeParams);

      if (result.signature) {
        order.transactionSignature = result.signature;
      }

      if (result.success) {
        order.effectivePriceSol = result.effectivePriceSol;
        order.totalCostSol = result.totalCostSol;
        order.netProceedsSol = result.netProceedsSol;
        this.updateOrderStatus(orderId, 'FILLED');
      } else {
        order.error = result.error;
        // 🔴 BUG-002: If broadcasted or ambiguous, enter RECOVERY_REQUIRED, NOT FAILED
        if (result.status === 'RECOVERY_REQUIRED' || result.isAmbiguous || order.transactionSignature) {
          this.updateOrderStatus(orderId, 'RECOVERY_REQUIRED', result.error);
        } else {
          this.updateOrderStatus(orderId, 'FAILED', result.error);
        }
      }

      return result;
    } catch (err: any) {
      const errorMsg = err?.message || String(err);
      order.error = errorMsg;
      if (order.transactionSignature) {
        this.updateOrderStatus(orderId, 'RECOVERY_REQUIRED', errorMsg);
      } else {
        this.updateOrderStatus(orderId, 'FAILED', errorMsg);
      }
      return {
        success: false,
        signature: order.transactionSignature,
        status: order.transactionSignature ? 'RECOVERY_REQUIRED' : 'FAILED',
        isAmbiguous: !!order.transactionSignature,
        inputMint: executeParams.inputMint,
        outputMint: executeParams.outputMint,
        inAmountRaw: order.amount,
        outAmountRaw: 0,
        error: errorMsg,
      };
    }
  }

  public updateOrderStatus(orderId: string, status: OrderStatus, error?: string): void {
    const order = this.orders.get(orderId);
    if (!order) return;

    order.status = status;
    order.updatedAt = Date.now();
    if (error) order.error = error;

    orderRepository.updateState(orderId, this.mapStatusToRecordState(status), {
      signature: order.transactionSignature,
      error: order.error,
      effectivePriceSol: order.effectivePriceSol,
      totalCostSol: order.totalCostSol,
      netProceedsSol: order.netProceedsSol,
    });
  }

  private mapStatusToRecordState(status: OrderStatus): any {
    switch (status) {
      case 'FILLED': return 'CONFIRMED';
      case 'FAILED': return 'FAILED';
      case 'CANCELLED': return 'CANCELLED';
      case 'SUBMITTED': return 'SUBMITTED';
      case 'CONFIRMING': return 'CONFIRMING';
      case 'RECOVERY_REQUIRED': return 'RECOVERY_REQUIRED';
      default: return 'SIGNAL';
    }
  }
}

export const orderManager = OrderManager.getInstance();
