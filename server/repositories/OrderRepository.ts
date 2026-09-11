// server/repositories/OrderRepository.ts
import { JsonStore } from './JsonStore.js';
import { OrderRecord } from '../types/index.js';

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
    const all = this.store.read();
    all[record.id] = record;
    this.store.write(all);
  }

  public getOrder(id: string): OrderRecord | undefined {
    const all = this.store.read();
    return all[id];
  }

  public getAllOrders(): OrderRecord[] {
    const all = this.store.read();
    return Object.values(all).sort((a, b) => b.createdAt - a.createdAt);
  }

  public getOrdersByStatus(status: string): OrderRecord[] {
    return this.getAllOrders().filter(o => o.status === status);
  }

  public getOrderByClientRequestId(clientRequestId: string): OrderRecord | undefined {
    return this.getAllOrders().find(o => o.clientRequestId === clientRequestId);
  }
}

export const orderRepository = OrderRepository.getInstance();
