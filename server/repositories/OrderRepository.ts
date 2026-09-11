// server/repositories/OrderRepository.ts
import { JsonStore } from './JsonStore.js';

export interface OrderRecord {
  id?: string;
  order_id?: string;
  network: string;
  wallet: string;
  mint: string;
  side: 'buy' | 'sell';
  amountRaw?: string;
  amount_raw?: string;
  decimals: number;
  slippageBps: number;
  status?: string;
  state?: string;
  createdAt?: number;
  created_at?: number;
  updatedAt?: number;
  updated_at?: number;
  filledAt?: number;
  filled_at?: number;
  signature?: string;
  error?: string;
  clientRequestId?: string;
  label?: string;
}

/**
 * OrderRepository: Authoritative persistence layer for all trading orders.
 */
export class OrderRepository {
  private static instance: OrderRepository;
  private store: JsonStore<Record<string, OrderRecord>>;

  private constructor() {
    this.store = new JsonStore<Record<string, OrderRecord>>('orders.json', {});
  }

  public static getInstance(): OrderRepository {
    if (!OrderRepository.instance) {
      OrderRepository.instance = new OrderRepository();
    }
    return OrderRepository.instance;
  }

  public upsertOrder(record: OrderRecord): void {
    const id = record.id || record.order_id;
    if (!id) return;
    const normalized: OrderRecord = {
      ...record,
      id,
      order_id: id,
      amountRaw: record.amountRaw || record.amount_raw || '0',
      amount_raw: record.amount_raw || record.amountRaw || '0',
      status: record.status || record.state || 'CREATED',
      state: record.state || record.status || 'CREATED',
      createdAt: record.createdAt || record.created_at || Date.now(),
      created_at: record.created_at || record.createdAt || Date.now(),
      updatedAt: record.updatedAt || record.updated_at || Date.now(),
      updated_at: record.updated_at || record.updatedAt || Date.now(),
    };
    const all = this.store.read();
    all[id] = normalized;
    this.store.write(all);
  }

  public createOrder(record: OrderRecord): void {
    this.upsertOrder(record);
  }

  public getOrder(id: string): OrderRecord | undefined {
    const all = this.store.read();
    return all[id];
  }

  public getAllOrders(): OrderRecord[] {
    const all = this.store.read();
    return Object.values(all).sort((a, b) => (b.createdAt || b.created_at || 0) - (a.createdAt || a.created_at || 0));
  }

  public getOrders(): OrderRecord[] {
    return this.getAllOrders();
  }

  public getOrdersByStatus(status: string): OrderRecord[] {
    return this.getAllOrders().filter(o => o.status === status || o.state === status);
  }

  public getOrderByClientRequestId(clientRequestId: string): OrderRecord | undefined {
    return this.getAllOrders().find(o => o.clientRequestId === clientRequestId);
  }
}

export const orderRepository = OrderRepository.getInstance();
