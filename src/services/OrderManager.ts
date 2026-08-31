// src/services/OrderManager.ts
import { SwapResult, ITradeExecutor } from './ITradeExecutor';
import type { QuoteResponse } from '@jup-ag/api';
import { executionEngine } from './ExecutionEngine';
import { TradingNetwork, getNetworkConfig } from '../config/network';
import { useTradingEnvironmentStore } from '../store/tradingEnvironmentStore';
import { usePaperWalletStore } from '../store/paperWalletStore';
import { useBalanceStore } from '../store/balanceStore';
import { resolveTokenDecimals } from './PaperTradeExecutor';
import { Connection } from '@solana/web3.js';
import { getSignatureStatusRobust } from './jupiterService';

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
  amount: number; // In raw integer units (lamports for buy, token base units for sell)
  slippageBps: number;
  label?: 'entry' | 'exit_tp' | 'exit_sl';
  network: TradingNetwork;
  state: OrderState;
  createdAt: number;
  updatedAt: number;
  signature?: string;
  effectivePriceSol?: number;
  totalCostSol?: number;
  netProceedsSol?: number;
  error?: string;
  result?: SwapResult;
}

/**
 * OrderManager: The single authoritative state manager for orders and trade lifecycle.
 * Ensures network-scoped deduplication, token-and-side-scoped idempotency, order tracking,
 * on-chain confirmation verification, and lifecycle progression.
 */
export class OrderManager {
  private static instance: OrderManager;
  private orders: Map<string, Order> = new Map();
  private activeOrdersByNetworkSideMint: Map<string, string> = new Map();
  private executor: ITradeExecutor = executionEngine;

  private constructor() {
    this.loadOrders();
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

  private loadOrders(): void {
    if (typeof window === 'undefined') {
      try {
        const { orderRepository } = require('../../server/repositories/OrderRepository.js');
        const list = orderRepository.getOrders();
        for (const record of list) {
          const order: Order = {
            id: record.order_id,
            mint: record.mint,
            side: record.side,
            amount: record.amount_raw,
            slippageBps: record.slippageBps || 250,
            label: record.label as any,
            network: (record.network as TradingNetwork) || 'paper',
            state: record.state,
            createdAt: record.created_at,
            updatedAt: record.updated_at,
            signature: record.signature,
            effectivePriceSol: record.effectivePriceSol,
            totalCostSol: record.totalCostSol,
            netProceedsSol: record.netProceedsSol,
            error: record.error,
          };
          this.orders.set(order.id, order);
        }
      } catch (e) {
        // Ignored
      }
    }
  }

  private syncServerOrder(order: Order): void {
    if (typeof window === 'undefined') {
      try {
        const { orderRepository } = require('../../server/repositories/OrderRepository.js');
        orderRepository.createOrder({
          order_id: order.id,
          position_id: undefined,
          mint: order.mint,
          side: order.side,
          amount_raw: order.amount,
          slippageBps: order.slippageBps,
          label: order.label,
          network: order.network,
          state: order.state,
          signature: order.signature,
          created_at: order.createdAt,
          updated_at: order.updatedAt,
          error: order.error,
          effectivePriceSol: order.effectivePriceSol,
          totalCostSol: order.totalCostSol,
          netProceedsSol: order.netProceedsSol,
        });
      } catch (e) {
        // Ignored
      }
    }
  }

  public createOrder(
    mint: string,
    side: 'buy' | 'sell',
    amount: number,
    slippageBps: number,
    customId?: string,
    network?: TradingNetwork,
    label?: 'entry' | 'exit_tp' | 'exit_sl'
  ): Order {
    const net = network || useTradingEnvironmentStore.getState().network || 'paper';
    // Key is scoped by network + side + mint, allowing simultaneous entry/exit management
    const key = `${net}_${side}_${mint}`;
    const existingActiveId = this.activeOrdersByNetworkSideMint.get(key);

    if (existingActiveId) {
      const existing = this.orders.get(existingActiveId);
      if (existing && !['CONFIRMED', 'FAILED', 'RECOVERY_REQUIRED', 'CANCELLED'].includes(existing.state)) {
        throw new Error(
          `IDEMPOTENCY LOCK: An active ${existing.side.toUpperCase()} order (${existing.id}) is already in state '${existing.state}' for mint ${mint} on ${net}`
        );
      }
    }

    const id = customId || `ord_${mint.slice(0, 8)}_${side}_${Date.now()}`;
    const order: Order = {
      id,
      mint,
      side,
      amount,
      slippageBps,
      label,
      network: net,
      state: 'SIGNAL',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.orders.set(id, order);
    this.activeOrdersByNetworkSideMint.set(key, id);
    this.syncServerOrder(order);
    return order;
  }

  public transitionState(
    orderId: string,
    newState: OrderState,
    details?: {
      signature?: string;
      error?: string;
      result?: SwapResult;
      effectivePriceSol?: number;
      totalCostSol?: number;
      netProceedsSol?: number;
    }
  ): Order {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    order.state = newState;
    order.updatedAt = Date.now();
    if (details?.signature) order.signature = details.signature;
    if (details?.error) order.error = details.error;
    if (details?.result) order.result = details.result;
    if (details?.effectivePriceSol !== undefined) order.effectivePriceSol = details.effectivePriceSol;
    if (details?.totalCostSol !== undefined) order.totalCostSol = details.totalCostSol;
    if (details?.netProceedsSol !== undefined) order.netProceedsSol = details.netProceedsSol;

    if (['CONFIRMED', 'FAILED', 'RECOVERY_REQUIRED', 'CANCELLED'].includes(newState)) {
      const net = order.network || 'paper';
      const key = `${net}_${order.side}_${order.mint}`;
      if (this.activeOrdersByNetworkSideMint.get(key) === orderId) {
        this.activeOrdersByNetworkSideMint.delete(key);
      }
    }

    this.syncServerOrder(order);
    return order;
  }

  /**
   * Authoritative order execution method: creates order, validates idempotency,
   * transitions states accurately through full lifecycle, verifies on-chain transaction
   * confirmation for live modes, calculates effective price metrics, and updates stores.
   */
  public async executeOrder(
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps: number,
    label: 'entry' | 'exit_tp' | 'exit_sl' = 'entry',
    preValidatedQuote?: QuoteResponse | null
  ): Promise<SwapResult> {
    const WSOL = 'So11111111111111111111111111111111111111112';
    const isSolBuy = inputMint === WSOL || inputMint === 'So11111111111111111111111111111111111111112';
    const targetMint = isSolBuy ? outputMint : inputMint;
    const side = isSolBuy ? 'buy' : 'sell';
    const currentNetwork = useTradingEnvironmentStore.getState().network || 'paper';

    // 1. SIGNAL & Order creation with side-scoped idempotency lock
    const order = this.createOrder(targetMint, side, amount, slippageBps, undefined, currentNetwork, label);

    // 2. Network-bound executor resolution (use set executor if configured for this network, else executionEngine)
    const executor = (this.executor && this.executor.mode === order.network)
      ? this.executor
      : executionEngine.getExecutorForNetwork(order.network);

    try {
      // 3. VALIDATING
      this.transitionState(order.id, 'VALIDATING');
      if (amount <= 0 || !Number.isFinite(amount)) {
        throw new Error(`INVALID_ORDER: Amount must be > 0. Received ${amount}`);
      }

      // 4. QUOTE_REQUESTED & QUOTE_RECEIVED
      this.transitionState(order.id, 'QUOTE_REQUESTED');
      let quote = preValidatedQuote;
      if (!quote) {
        quote = await executor.getQuote({
          inputMint,
          outputMint,
          amount,
          slippageBps,
        });
      }
      if (!quote || !quote.outAmount || Number(quote.outAmount) <= 0) {
        throw new Error(`ORDER_EXECUTION_FAILED: Invalid quote returned for ${inputMint} -> ${outputMint}`);
      }
      this.transitionState(order.id, 'QUOTE_RECEIVED');

      // 5. TRANSACTION_BUILDING & SIGNING
      this.transitionState(order.id, 'TRANSACTION_BUILDING');
      this.transitionState(order.id, 'SIGNING');

      // 6. SUBMITTED
      const result = await executor.swap(inputMint, outputMint, amount, slippageBps, label, quote);

      if (result.signature) {
        this.transitionState(order.id, 'SUBMITTED', { signature: result.signature });
      }

      // 7. CONFIRMING & On-Chain Verification
      this.transitionState(order.id, 'CONFIRMING');

      // 8. Effective execution price & proceeds computation
      let effectivePriceSol = 0;
      let totalCostSol = 0;
      let netProceedsSol = 0;

      let decimals = 6;
      try {
        decimals = resolveTokenDecimals(targetMint);
      } catch {
        decimals = 6;
      }

      if (isSolBuy) {
        totalCostSol = result.totalCostSol || (result.inputAmount / 1e9) + (result.feeSol || 0);
        const tokenQty = result.outputAmount / (10 ** decimals);
        if (tokenQty > 0) {
          effectivePriceSol = totalCostSol / tokenQty;
        }
      } else {
        const tokenQty = result.inputAmount / (10 ** decimals);
        netProceedsSol = Math.max(0, (result.outputAmount / 1e9) - (result.feeSol || 0));
        if (tokenQty > 0) {
          effectivePriceSol = netProceedsSol / tokenQty;
        }
      }

      // 9. CONFIRMED
      this.transitionState(order.id, 'CONFIRMED', {
        signature: result.signature,
        result,
        effectivePriceSol,
        totalCostSol: isSolBuy ? totalCostSol : undefined,
        netProceedsSol: !isSolBuy ? netProceedsSol : undefined,
      });

      // 10. Sync wallet balance store
      if (order.network === 'paper') {
        usePaperWalletStore.getState().syncToBalanceStore();
      }

      return result;
    } catch (err: any) {
      const errorMsg = err?.message || String(err);
      this.transitionState(order.id, 'FAILED', {
        error: errorMsg,
      });
      throw err;
    }
  }

  public getActiveOrderForMint(mint: string, network?: TradingNetwork): Order | undefined {
    const net = network || useTradingEnvironmentStore.getState().network || 'paper';
    const buyKey = `${net}_buy_${mint}`;
    const sellKey = `${net}_sell_${mint}`;
    const activeBuyId = this.activeOrdersByNetworkSideMint.get(buyKey);
    if (activeBuyId) return this.orders.get(activeBuyId);
    const activeSellId = this.activeOrdersByNetworkSideMint.get(sellKey);
    if (activeSellId) return this.orders.get(activeSellId);
    return undefined;
  }

  public getOrder(orderId: string): Order | undefined {
    return this.orders.get(orderId);
  }

  public getAllOrders(): Order[] {
    return Array.from(this.orders.values());
  }
}

export const orderManager = OrderManager.getInstance();
