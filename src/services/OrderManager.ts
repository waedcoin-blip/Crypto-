// src/services/OrderManager.ts
import { SwapResult, ITradeExecutor } from './ITradeExecutor';
import { executionEngine, ExecutionEngine } from './ExecutionEngine';
import { TradingNetwork } from '../config/network';
import { useTradingEnvironmentStore } from '../store/tradingEnvironmentStore';

export type OrderState =
  | 'SIGNAL'
  | 'VALIDATING'
  | 'QUOTE_REQUESTED'
  | 'QUOTE_RECEIVED'
  | 'TRANSACTION_BUILDING'
  | 'SIGNING'
  | 'SUBMITTED'
  | 'CONFIRMING'
  | 'CONFIRMED'
  | 'FAILED'
  | 'RECOVERY_REQUIRED'
  | 'CANCELLED';

export interface Order {
  id: string;
  mint: string;
  side: 'buy' | 'sell';
  amount: number;
  slippageBps: number;
  network: TradingNetwork;
  state: OrderState;
  createdAt: number;
  updatedAt: number;
  signature?: string;
  error?: string;
  result?: SwapResult;
}

/**
 * OrderManager: The single authoritative state manager for orders and trade lifecycle.
 * Ensures network-scoped deduplication, token-scoped idempotency, order tracking, and lifecycle progression.
 */
export class OrderManager {
  private static instance: OrderManager;
  private orders: Map<string, Order> = new Map();
  private activeOrdersByNetworkMint: Map<string, string> = new Map();
  private executor: ITradeExecutor = executionEngine;

  private constructor() {
    this.loadPersistedOrders();
  }

  public static getInstance(): OrderManager {
    if (!OrderManager.instance) {
      OrderManager.instance = new OrderManager();
    }
    return OrderManager.instance;
  }

  public setExecutor(executor: ITradeExecutor): void {
    this.executor = executor;
  }

  public getExecutor(): ITradeExecutor {
    return this.executor;
  }

  private loadPersistedOrders(): void {
    if (typeof window === 'undefined') return;
    try {
      const saved = localStorage.getItem('app_order_history');
      if (saved) {
        const parsed = JSON.parse(saved) as Order[];
        for (const order of parsed) {
          this.orders.set(order.id, order);
          const net = order.network || 'devnet';
          if (['VALIDATING', 'QUOTE_REQUESTED', 'QUOTE_RECEIVED', 'TRANSACTION_BUILDING', 'SIGNING', 'SUBMITTED', 'CONFIRMING'].includes(order.state)) {
            this.activeOrdersByNetworkMint.set(`${net}_${order.mint}`, order.id);
          }
        }
      }
    } catch (e) {
      console.warn('[OrderManager] Failed to load persisted orders:', e);
    }
  }

  private persistOrders(): void {
    if (typeof window === 'undefined') return;
    try {
      const array = Array.from(this.orders.values()).slice(-50); // Keep last 50
      localStorage.setItem('app_order_history', JSON.stringify(array));
    } catch (e) {
      console.warn('[OrderManager] Failed to persist orders:', e);
    }
  }

  public createOrder(mint: string, side: 'buy' | 'sell', amount: number, slippageBps: number, customId?: string, network?: TradingNetwork): Order {
    const net = network || useTradingEnvironmentStore.getState().network || 'devnet';
    const key = `${net}_${mint}`;
    const existingActiveId = this.activeOrdersByNetworkMint.get(key);
    if (existingActiveId) {
      const existing = this.orders.get(existingActiveId);
      if (existing && !['CONFIRMED', 'FAILED', 'RECOVERY_REQUIRED', 'CANCELLED'].includes(existing.state)) {
        throw new Error(`IDEMPOTENCY LOCK: An active ${existing.side.toUpperCase()} order (${existing.id}) is already in state '${existing.state}' for mint ${mint} on ${net}`);
      }
    }

    const id = customId || `ord_${mint.slice(0, 8)}_${side}_${Date.now()}`;
    const order: Order = {
      id,
      mint,
      side,
      amount,
      slippageBps,
      network: net,
      state: 'SIGNAL',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.orders.set(id, order);
    this.activeOrdersByNetworkMint.set(key, id);
    this.persistOrders();
    return order;
  }

  public transitionState(orderId: string, newState: OrderState, details?: { signature?: string; error?: string; result?: SwapResult }): Order {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    order.state = newState;
    order.updatedAt = Date.now();
    if (details?.signature) order.signature = details.signature;
    if (details?.error) order.error = details.error;
    if (details?.result) order.result = details.result;

    if (['CONFIRMED', 'FAILED', 'RECOVERY_REQUIRED', 'CANCELLED'].includes(newState)) {
      const net = order.network || 'devnet';
      const key = `${net}_${order.mint}`;
      if (this.activeOrdersByNetworkMint.get(key) === orderId) {
        this.activeOrdersByNetworkMint.delete(key);
      }
    }

    this.persistOrders();
    return order;
  }

  /**
   * Authoritative order execution method: creates order, validates idempotency,
   * transitions states, and delegates execution solely through ExecutionEngine.
   */
  public async executeOrder(
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps: number,
    label: 'entry' | 'exit_tp' | 'exit_sl' = 'entry'
  ): Promise<SwapResult> {
    const WSOL = 'So11111111111111111111111111111111111111112';
    const isSolBuy = inputMint === WSOL;
    const targetMint = isSolBuy ? outputMint : inputMint;
    const side = isSolBuy ? 'buy' : 'sell';
    const currentNetwork = useTradingEnvironmentStore.getState().network || 'devnet';

    const order = this.createOrder(targetMint, side, amount, slippageBps, undefined, currentNetwork);
    this.transitionState(order.id, 'VALIDATING');

    try {
      this.transitionState(order.id, 'QUOTE_REQUESTED');

      const result = await this.executor.swap(inputMint, outputMint, amount, slippageBps, label);

      if (result.signature) {
        this.transitionState(order.id, 'SUBMITTED', { signature: result.signature });
      }

      this.transitionState(order.id, 'CONFIRMED', {
        signature: result.signature,
        result,
      });

      return result;
    } catch (err: any) {
      this.transitionState(order.id, 'FAILED', {
        error: err.message || String(err),
      });
      throw err;
    }
  }

  public getActiveOrderForMint(mint: string, network?: TradingNetwork): Order | undefined {
    const net = network || useTradingEnvironmentStore.getState().network || 'devnet';
    const key = `${net}_${mint}`;
    const activeId = this.activeOrdersByNetworkMint.get(key);
    if (!activeId) return undefined;
    return this.orders.get(activeId);
  }

  public getOrder(orderId: string): Order | undefined {
    return this.orders.get(orderId);
  }

  public getAllOrders(): Order[] {
    return Array.from(this.orders.values());
  }
}

export const orderManager = OrderManager.getInstance();

