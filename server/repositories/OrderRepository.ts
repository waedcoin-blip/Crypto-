// server/repositories/OrderRepository.ts
import { readDataFile, updateDataFileAtomic } from '../db/jsonStore.js';

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
  version?: number;
}

const FILE_NAME = 'orders.json';

export class OrderRepository {
  private static instance: OrderRepository;

  private constructor() {}

  public static getInstance(): OrderRepository {
    if (!OrderRepository.instance) {
      OrderRepository.instance = new OrderRepository();
    }
    return OrderRepository.instance;
  }

  private readAll(): OrderRecord[] {
    return readDataFile<OrderRecord[]>(FILE_NAME, []);
  }

  public getOrder(orderId: string): OrderRecord | undefined {
    return this.readAll().find(o => o.order_id === orderId);
  }

  public getOrders(): OrderRecord[] {
    return this.readAll();
  }

  public createOrder(record: OrderRecord): OrderRecord {
    let result = record;
    updateDataFileAtomic<OrderRecord[]>(FILE_NAME, [], (current) => {
      const existingIdx = current.findIndex(o => o.order_id === record.order_id);
      const now = Date.now();

      if (existingIdx !== -1) {
        const existing = current[existingIdx];
        const merged: OrderRecord = {
          ...existing,
          ...record,
          version: (existing.version || 1) + 1,
          updated_at: now,
        };
        current[existingIdx] = merged;
        result = merged;
      } else {
        const newRecord: OrderRecord = {
          ...record,
          version: 1,
          created_at: record.created_at || now,
          updated_at: now,
        };
        current.push(newRecord);
        result = newRecord;
      }

      return current;
    });

    return result;
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
    let updated: OrderRecord | undefined;

    updateDataFileAtomic<OrderRecord[]>(FILE_NAME, [], (current) => {
      const idx = current.findIndex(o => o.order_id === orderId);
      if (idx === -1) return current;

      const existing = current[idx];

      // Terminal state guard: If already CONFIRMED, do not revert to SUBMITTED or FAILED
      if (existing.state === 'CONFIRMED' && state !== 'CONFIRMED') {
        console.warn(`[OrderRepository] Rejected transition from CONFIRMED to ${state} for order ${orderId}`);
        updated = existing;
        return current;
      }

      const merged: OrderRecord = {
        ...existing,
        state,
        updated_at: details?.confirmedAt || Date.now(),
        signature: details?.signature || existing.signature,
        error: details?.error || existing.error,
        effectivePriceSol: details?.effectivePriceSol !== undefined ? details.effectivePriceSol : existing.effectivePriceSol,
        totalCostSol: details?.totalCostSol !== undefined ? details.totalCostSol : existing.totalCostSol,
        netProceedsSol: details?.netProceedsSol !== undefined ? details.netProceedsSol : existing.netProceedsSol,
        version: (existing.version || 1) + 1,
      };

      current[idx] = merged;
      updated = merged;
      return current;
    });

    return updated;
  }
}

export const orderRepository = OrderRepository.getInstance();
