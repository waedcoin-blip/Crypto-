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
  filledAt?: number;
  signature?: string;
  error?: string;
  clientRequestId?: string;
  label?: string;
  quote?: any;
}

export class OrderManager {
  private static instance: OrderManager;
  private orders: Map<string, Order> = new Map();
  private idempotencyMap: Map<string, string> = new Map(); // clientRequestId -> orderId

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
    // FIX: Changed from getOrders() to getAllOrders() to match OrderRepository
    const records = orderRepository.getAllOrders();
    for (const record of records) {
      const orderId = record.id || record.order_id || '';
      if (!orderId) continue;
      const order: Order = {
        id: orderId,
        network: record.network || 'mainnet',
        wallet: record.wallet || 'default',
        mint: record.mint,
        side: record.side as 'buy' | 'sell',
        amount: record.amountRaw || record.amount_raw || '0',
        decimals: record.decimals || 9,
        slippageBps: record.slippageBps || 250,
        status: (record.state === 'CONFIRMED' || record.status === 'CONFIRMED' ? 'FILLED' : (record.status || record.state || 'CREATED')) as OrderStatus,
        createdAt: record.createdAt || record.created_at || Date.now(),
        updatedAt: record.updatedAt || record.updated_at || Date.now(),
        filledAt: record.filledAt || record.filled_at,
        signature: record.signature,
        error: record.error,
        clientRequestId: record.clientRequestId,
        label: record.label,
      };
      this.orders.set(order.id, order);
      if (order.clientRequestId) {
        this.idempotencyMap.set(order.clientRequestId, order.id);
      }
    }
  }

  // ==========================================
  // ORDER CREATION
  // ==========================================

  public createOrder(params: {
    network: string;
    wallet: string;
    mint: string;
    side: 'buy' | 'sell';
    amount: bigint | string | number;
    decimals: number;
    slippageBps: number;
    clientRequestId?: string;
    label?: string;
    quote?: any;
  }): Order {
    // Idempotency check
    if (params.clientRequestId) {
      const existingId = this.idempotencyMap.get(params.clientRequestId);
      if (existingId) {
        const existing = this.orders.get(existingId);
        if (existing) {
          console.log(`[OrderManager] Idempotent order returned: ${existingId}`);
          return existing;
        }
      }
    }

    const orderId = `ord_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();

    const order: Order = {
      id: orderId,
      network: params.network,
      wallet: params.wallet,
      mint: params.mint,
      side: params.side,
      amount: params.amount,
      decimals: params.decimals,
      slippageBps: params.slippageBps,
      status: 'CREATED',
      createdAt: now,
      updatedAt: now,
      clientRequestId: params.clientRequestId,
      label: params.label,
      quote: params.quote,
    };

    this.orders.set(orderId, order);
    if (params.clientRequestId) {
      this.idempotencyMap.set(params.clientRequestId, orderId);
    }

    this.syncRepository(order);
    return order;
  }

  // ==========================================
  // ORDER EXECUTION
  // ==========================================

  public async executeOrder(orderId: string, preValidatedQuote?: any): Promise<ExecutionResult> {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error(`ORDER_NOT_FOUND: ${orderId}`);
    }
    if (['FILLED', 'FAILED', 'CANCELLED'].includes(order.status)) {
      throw new Error(`ORDER_ALREADY_TERMINAL: Order ${orderId} is in status ${order.status}`);
    }

    this.updateOrderStatus(orderId, 'SUBMITTED');

    const executor = executionGateway.getExecutor(order.network);
    if (!executor) {
      this.updateOrderStatus(orderId, 'FAILED', `NO_EXECUTOR_FOR_NETWORK: ${order.network}`);
      throw new Error(`NO_EXECUTOR_FOR_NETWORK: ${order.network}`);
    }

    const executeParams = {
      inputMint: order.side === 'buy' ? 'So11111111111111111111111111111111111111112' : order.mint,
      outputMint: order.side === 'buy' ? order.mint : 'So11111111111111111111111111111111111111112',
      amount: order.amount,
      slippageBps: order.slippageBps,
      decimals: order.decimals,
      walletAddress: order.wallet,
      network: order.network,
      label: order.label,
      preValidatedQuote: preValidatedQuote || order.quote,
      clientRequestId: order.clientRequestId,
      onBroadcast: async (sig: string) => {
        this.updateOrderStatus(orderId, 'CONFIRMING');
        this.updateOrderSignature(orderId, sig);
      },
    };

    try {
      this.updateOrderStatus(orderId, 'CONFIRMING');
      const result = order.side === 'buy'
        ? await executor.buy(executeParams)
        : await executor.sell(executeParams);

      if (result.success) {
        this.updateOrderStatus(orderId, 'FILLED');
        this.updateOrderSignature(orderId, result.signature || '');
        return result;
      } else {
        // If status is RECOVERY_REQUIRED or isAmbiguous or signature present, enter RECOVERY_REQUIRED
        if (result.status === 'RECOVERY_REQUIRED' || result.isAmbiguous || order.signature) {
          this.updateOrderStatus(orderId, 'RECOVERY_REQUIRED', result.error);
        } else {
          this.updateOrderStatus(orderId, 'FAILED', result.error);
        }
        return result;
      }
    } catch (err: any) {
      const errorMsg = err?.message || String(err);
      // If we have a signature, the tx was broadcast — enter recovery
      if (order.signature) {
        this.updateOrderStatus(orderId, 'RECOVERY_REQUIRED', errorMsg);
      } else {
        this.updateOrderStatus(orderId, 'FAILED', errorMsg);
      }
      throw err;
    }
  }

  // ==========================================
  // ORDER QUERIES
  // ==========================================

  public getOrder(orderId: string): Order | undefined {
    return this.orders.get(orderId);
  }

  public getOrders(filters?: { network?: string; wallet?: string; mint?: string; side?: string }): Order[] {
    let list = Array.from(this.orders.values());
    if (filters?.network) list = list.filter(o => o.network === filters.network);
    if (filters?.wallet) list = list.filter(o => o.wallet === filters.wallet);
    if (filters?.mint) list = list.filter(o => o.mint === filters.mint);
    if (filters?.side) list = list.filter(o => o.side === filters.side);
    return list.sort((a, b) => b.createdAt - a.createdAt);
  }

  // NEW: Query orders by status
  public getOrdersByStatus(status: OrderStatus): Order[] {
    return Array.from(this.orders.values()).filter(o => o.status === status);
  }

  public getOrderByIdempotencyKey(clientRequestId: string): Order | undefined {
    const orderId = this.idempotencyMap.get(clientRequestId);
    return orderId ? this.orders.get(orderId) : undefined;
  }

  // ==========================================
  // ORDER MUTATIONS
  // ==========================================

  public updateOrderStatus(orderId: string, status: OrderStatus, error?: string): void {
    const order = this.orders.get(orderId);
    if (!order) return;
    order.status = status;
    order.updatedAt = Date.now();
    if (error) order.error = error;
    if (status === 'FILLED') order.filledAt = Date.now();
    this.syncRepository(order);
  }

  private updateOrderSignature(orderId: string, signature: string): void {
    const order = this.orders.get(orderId);
    if (!order) return;
    order.signature = signature;
    order.updatedAt = Date.now();
    this.syncRepository(order);
  }

  private syncRepository(order: Order): void {
    const record: OrderRecord = {
      order_id: order.id,
      network: order.network,
      wallet: order.wallet,
      mint: order.mint,
      side: order.side,
      amount_raw: String(order.amount),
      decimals: order.decimals,
      slippageBps: order.slippageBps,
      state: (order.status === 'FILLED' ? 'CONFIRMED' : order.status) as any,
      created_at: order.createdAt,
      updated_at: order.updatedAt,
      signature: order.signature,
      error: order.error,
      label: order.label,
    };
    orderRepository.createOrder(record);
  }
}

export const orderManager = OrderManager.getInstance();
