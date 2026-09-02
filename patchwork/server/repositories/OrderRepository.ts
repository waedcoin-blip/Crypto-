// server/repositories/OrderRepository.ts
import { readDataFile, writeDataFile } from '../db/jsonStore.js';

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

export interface OrderRecord {
  order_id: string;
  position_id?: string;
  mint: string;
  wallet?: string;
  side: 'buy' | 'sell';
  amount_raw: number | string;
  slippageBps?: number;
  label?: string;
  network?: string;
  state: OrderState;
  signature?: string;
  created_at: number;
  updated_at: number;
  error?: string;
  effectivePriceSol?: number;
  totalCostSol?: number;
  netProceedsSol?: number;
  clientRequestId?: string;
}

const FILE_NAME = 'orders.json';

export class OrderRepository {
  private static instance: OrderRepository;
  private orders: Map<string, OrderRecord> = new Map();

  private constructor() {
    this.load();
  }

  public static getInstance(): OrderRepository {
    if (!OrderRepository.instance) {
      OrderRepository.instance = new OrderRepository();
    }
    return OrderRepository.instance;
  }

  private load(): void {
    const list = readDataFile<OrderRecord[]>(FILE_NAME, []);
    for (const item of list) {
      if (item && item.order_id) {
        this.orders.set(item.order_id, item);
      }
    }
  }

  private save(): void {
    const arr = Array.from(this.orders.values());
    writeDataFile(FILE_NAME, arr);
  }

  public getOrder(orderId: string): OrderRecord | undefined {
    return this.orders.get(orderId);
  }

  public getOrders(): OrderRecord[] {
    return Array.from(this.orders.values());
  }

  public createOrder(record: OrderRecord): OrderRecord {
    record.created_at = record.created_at || Date.now();
    record.updated_at = Date.now();
    this.orders.set(record.order_id, record);
    this.save();
    return record;
  }

  public async updateState(
    orderId: string,
    state: OrderState,
    details?: {
      signature?: string;
      error?: string;
      confirmedAt?: number;
      effectivePriceSol?: number;
      totalCostSol?: number;
      netProceedsSol?: number;
    }
  ): Promise<OrderRecord | undefined> {
    const existing = this.orders.get(orderId);
    if (!existing) return undefined;

    existing.state = state;
    existing.updated_at = details?.confirmedAt || Date.now();
    if (details?.signature) existing.signature = details.signature;
    if (details?.error) existing.error = details.error;
    if (details?.effectivePriceSol !== undefined) existing.effectivePriceSol = details.effectivePriceSol;
    if (details?.totalCostSol !== undefined) existing.totalCostSol = details.totalCostSol;
    if (details?.netProceedsSol !== undefined) existing.netProceedsSol = details.netProceedsSol;

    this.orders.set(orderId, existing);
    this.save();
    return existing;
  }
}

export const orderRepository = OrderRepository.getInstance();
