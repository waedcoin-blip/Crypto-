// src/services/OrderManager.ts
import { SwapResult } from './ITradeExecutor';

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
  state: OrderState;
  createdAt: number;
  updatedAt: number;
  signature?: string;
  error?: string;
  result?: SwapResult;
}

export class OrderManager {
  private static instance: OrderManager;
  private orders: Map<string, Order> = new Map();
  private activeOrdersByMintSide: Map<string, string> = new Map();

  private constructor() {
    this.loadPersistedOrders();
  }

  public static getInstance(): OrderManager {
    if (!OrderManager.instance) {
      OrderManager.instance = new OrderManager();
    }
    return OrderManager.instance;
  }

  private loadPersistedOrders(): void {
    if (typeof window === 'undefined') return;
    try {
      const saved = localStorage.getItem('app_order_history');
      if (saved) {
        const parsed = JSON.parse(saved) as Order[];
        for (const order of parsed) {
          this.orders.set(order.id, order);
          if (['VALIDATING', 'QUOTE_REQUESTED', 'QUOTE_RECEIVED', 'TRANSACTION_BUILDING', 'SIGNING', 'SUBMITTED', 'CONFIRMING'].includes(order.state)) {
            this.activeOrdersByMintSide.set(`${order.mint}_${order.side}`, order.id);
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

  public createOrder(mint: string, side: 'buy' | 'sell', amount: number, slippageBps: number, customId?: string): Order {
    const key = `${mint}_${side}`;
    const existingActiveId = this.activeOrdersByMintSide.get(key);
    if (existingActiveId) {
      const existing = this.orders.get(existingActiveId);
      if (existing && !['CONFIRMED', 'FAILED', 'RECOVERY_REQUIRED', 'CANCELLED'].includes(existing.state)) {
        throw new Error(`IDEMPOTENCY LOCK: An active ${side.toUpperCase()} order (${existing.id}) is already in state '${existing.state}' for mint ${mint}`);
      }
    }

    const id = customId || `ord_${mint.slice(0, 8)}_${side}_${Date.now()}`;
    const order: Order = {
      id,
      mint,
      side,
      amount,
      slippageBps,
      state: 'SIGNAL',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.orders.set(id, order);
    this.activeOrdersByMintSide.set(key, id);
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
      const key = `${order.mint}_${order.side}`;
      if (this.activeOrdersByMintSide.get(key) === orderId) {
        this.activeOrdersByMintSide.delete(key);
      }
    }

    this.persistOrders();
    return order;
  }

  public getActiveOrderForMint(mint: string, side: 'buy' | 'sell'): Order | undefined {
    const key = `${mint}_${side}`;
    const activeId = this.activeOrdersByMintSide.get(key);
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
