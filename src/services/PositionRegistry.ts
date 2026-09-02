// src/services/PositionRegistry.ts
import { TradingNetwork } from '../config/network';

export type PositionState =
  | 'PENDING_BUY'
  | 'OPEN'
  | 'EXIT_REQUESTED'
  | 'EXIT_SUBMITTED'
  | 'EXIT_CONFIRMING'
  | 'CLOSED'
  | 'RECONCILIATION_REQUIRED'
  | 'RECOVERY_REQUIRED';

export interface PositionRecord {
  id: string; // Deterministic or unique UUID
  mintAddress: string;
  network: TradingNetwork;
  amountRaw: number;
  decimals: number;
  entryPriceSOL: number;
  solSpent: number;
  currentPriceSOL: number;
  peakPriceSOL: number;
  highestPnLPct: number;
  currentPnLSol?: number;
  currentPnLPct?: number;
  tpPct: number;
  slPct: number;
  trailingSlPct?: number;
  maxHoldTimeMs?: number;
  slippageBpsTp: number;
  slippageBpsSl: number;
  state: PositionState;
  orderIds: string[];
  buySignature?: string;
  exitSignature?: string;
  createdAt: number;
  updatedAt: number;
  closedAt?: number;
  realizedPnLSol?: number;
  realizedPnLPct?: number;
}

export type PositionRegistryListener = (positions: PositionRecord[]) => void;

/**
 * PositionRegistry: The single authoritative registry for open and historical positions.
 * Decouples position tracking from generic token records and individual orders.
 */
export class PositionRegistry {
  private static instance: PositionRegistry;
  private positions: Map<string, PositionRecord> = new Map(); // Keyed by position ID
  private positionsByMint: Map<string, string> = new Map(); // mintAddress -> positionId (for open positions)
  private listeners: Set<PositionRegistryListener> = new Set();

  private constructor() {
    this.loadPositions();
  }

  public static getInstance(): PositionRegistry {
    if (!PositionRegistry.instance) {
      PositionRegistry.instance = new PositionRegistry();
    }
    return PositionRegistry.instance;
  }

  private loadPositions(): void {
    if (typeof window === 'undefined') {
      try {
        const { positionRepository } = require('../../server/repositories/PositionRepository.js');
        const list = positionRepository.getAllPositions();
        for (const pos of list) {
          if (pos && pos.id && pos.mintAddress) {
            this.positions.set(pos.id, pos);
            if (pos.state !== 'CLOSED') {
              this.positionsByMint.set(pos.mintAddress, pos.id);
            }
          }
        }
      } catch (e) {
        // Fallback for non-Node browser contexts
      }
    }
  }

  private syncServer(pos: PositionRecord): void {
    if (typeof window === 'undefined') {
      try {
        const { positionRepository } = require('../../server/repositories/PositionRepository.js');
        positionRepository.upsertPosition(pos);
      } catch (e) {
        // Ignored
      }
    }
  }

  /**
   * Opens a new position or accumulates into an existing open position using
   * weighted-average cost basis accounting.
   */
  public openPosition(params: {
    mintAddress: string;
    network: TradingNetwork;
    amountRaw: number;
    decimals?: number;
    entryPriceSOL: number;
    solSpent: number;
    tpPct?: number;
    slPct?: number;
    trailingSlPct?: number;
    maxHoldTimeMs?: number;
    slippageBpsTp?: number;
    slippageBpsSl?: number;
    orderId?: string;
    buySignature?: string;
  }): PositionRecord {
    const mint = params.mintAddress.trim();
    if (!mint) {
      throw new Error('INVALID_POSITION_ENTRY: mintAddress is required');
    }
    const rawAmount = Math.floor(Math.max(0, params.amountRaw || 0));
    const solSpent = Math.max(0, params.solSpent || 0);
    const decimals = params.decimals !== undefined ? params.decimals : 6;

    const existingId = this.positionsByMint.get(mint);
    if (existingId) {
      const existing = this.positions.get(existingId);
      if (existing && existing.state !== 'CLOSED') {
        // Weighted average cost basis accumulation
        if (rawAmount > 0 && solSpent > 0) {
          const prevTotalCost = existing.solSpent;
          const prevTotalRaw = existing.amountRaw;
          const newTotalCost = prevTotalCost + solSpent;
          const newTotalRaw = prevTotalRaw + rawAmount;
          const newTotalQty = newTotalRaw / (10 ** existing.decimals);

          existing.amountRaw = newTotalRaw;
          existing.solSpent = newTotalCost;
          if (newTotalQty > 0) {
            existing.entryPriceSOL = newTotalCost / newTotalQty;
          }
        }
        if (params.tpPct !== undefined) existing.tpPct = params.tpPct;
        if (params.slPct !== undefined) existing.slPct = Math.abs(params.slPct);
        if (params.trailingSlPct !== undefined) existing.trailingSlPct = params.trailingSlPct;
        if (params.maxHoldTimeMs !== undefined) existing.maxHoldTimeMs = params.maxHoldTimeMs;
        if (params.slippageBpsTp !== undefined) existing.slippageBpsTp = params.slippageBpsTp;
        if (params.slippageBpsSl !== undefined) existing.slippageBpsSl = params.slippageBpsSl;
        if (params.orderId && !existing.orderIds.includes(params.orderId)) {
          existing.orderIds.push(params.orderId);
        }
        if (existing.state === 'RECOVERY_REQUIRED') {
          existing.state = 'OPEN';
        }
        existing.updatedAt = Date.now();
        this.syncServer(existing);
        this.notify();
        return existing;
      }
    }

    // Validation for new position
    const tokenQty = rawAmount / (10 ** decimals);
    let calculatedEntryPrice = params.entryPriceSOL || 0;
    if (calculatedEntryPrice <= 0 && solSpent > 0 && tokenQty > 0) {
      calculatedEntryPrice = solSpent / tokenQty;
    }

    if (rawAmount <= 0 || calculatedEntryPrice <= 0 || !Number.isFinite(calculatedEntryPrice)) {
      throw new Error(`INVALID_POSITION_ENTRY: Cannot open position for ${mint} without valid amountRaw > 0 and positive entry price or solSpent.`);
    }

    const posId = `pos_${Date.now()}_${mint.slice(0, 6)}`;
    const now = Date.now();

    const record: PositionRecord = {
      id: posId,
      mintAddress: mint,
      network: params.network,
      amountRaw: rawAmount,
      decimals,
      entryPriceSOL: calculatedEntryPrice,
      solSpent,
      currentPriceSOL: calculatedEntryPrice,
      peakPriceSOL: calculatedEntryPrice,
      highestPnLPct: 0,
      currentPnLSol: 0,
      currentPnLPct: 0,
      tpPct: params.tpPct ?? 25,
      slPct: Math.abs(params.slPct ?? 15),
      trailingSlPct: params.trailingSlPct,
      maxHoldTimeMs: params.maxHoldTimeMs,
      slippageBpsTp: params.slippageBpsTp ?? 250,
      slippageBpsSl: params.slippageBpsSl ?? 1000,
      state: 'OPEN',
      orderIds: params.orderId ? [params.orderId] : [],
      buySignature: params.buySignature,
      createdAt: now,
      updatedAt: now,
    };

    this.positions.set(posId, record);
    this.positionsByMint.set(mint, posId);
    this.syncServer(record);
    this.notify();
    return record;
  }

  public getPosition(id: string): PositionRecord | undefined {
    return this.positions.get(id);
  }

  public getOpenPositionByMint(mintAddress: string): PositionRecord | undefined {
    const id = this.positionsByMint.get(mintAddress.trim());
    if (!id) return undefined;
    const pos = this.positions.get(id);
    return pos && pos.state !== 'CLOSED' ? pos : undefined;
  }

  public getOpenPositions(): PositionRecord[] {
    return Array.from(this.positions.values()).filter(p => p.state !== 'CLOSED');
  }

  public getAllPositions(): PositionRecord[] {
    return Array.from(this.positions.values());
  }

  public updatePrice(mintAddress: string, priceSOL: number): void {
    const pos = this.getOpenPositionByMint(mintAddress);
    if (!pos || pos.state === 'CLOSED' || priceSOL <= 0 || !Number.isFinite(priceSOL)) return;

    pos.currentPriceSOL = priceSOL;
    if (!pos.peakPriceSOL || priceSOL > pos.peakPriceSOL) {
      pos.peakPriceSOL = priceSOL;
    }

    const tokenQty = pos.amountRaw / (10 ** pos.decimals);
    const currentVal = tokenQty * priceSOL;
    const pnlSol = currentVal - pos.solSpent;
    const pnlPct = pos.entryPriceSOL > 0 ? ((priceSOL - pos.entryPriceSOL) / pos.entryPriceSOL) * 100 : 0;
    
    pos.currentPnLSol = pnlSol;
    pos.currentPnLPct = pnlPct;

    if (pnlPct > pos.highestPnLPct) {
      pos.highestPnLPct = pnlPct;
    }
    pos.updatedAt = Date.now();
    this.notify();
  }

  public transitionState(id: string, newState: PositionState, metadata?: {
    exitSignature?: string;
    realizedPnLSol?: number;
    realizedPnLPct?: number;
    orderId?: string;
  }): void {
    const pos = this.positions.get(id);
    if (!pos) return;

    pos.state = newState;
    pos.updatedAt = Date.now();

    if (metadata?.exitSignature) pos.exitSignature = metadata.exitSignature;
    if (metadata?.realizedPnLSol !== undefined) pos.realizedPnLSol = metadata.realizedPnLSol;
    if (metadata?.realizedPnLPct !== undefined) pos.realizedPnLPct = metadata.realizedPnLPct;
    if (metadata?.orderId && !pos.orderIds.includes(metadata.orderId)) {
      pos.orderIds.push(metadata.orderId);
    }

    if (newState === 'CLOSED') {
      pos.closedAt = Date.now();
      // Only delete from positionsByMint if it is still pointing to this position
      if (this.positionsByMint.get(pos.mintAddress) === pos.id) {
        this.positionsByMint.delete(pos.mintAddress);
      }
    }

    this.syncServer(pos);
    this.notify();
    this.notify();
  }

  public closePosition(mintAddress: string, signature?: string, pnlSol?: number, pnlPct?: number): boolean {
    const pos = this.getOpenPositionByMint(mintAddress);
    if (pos) {
      this.transitionState(pos.id, 'CLOSED', {
        exitSignature: signature,
        realizedPnLSol: pnlSol,
        realizedPnLPct: pnlPct,
      });
      return true;
    }
    console.warn(`[PositionRegistry] Cannot close position: No open position found for mint ${mintAddress}`);
    return false;
  }

  /**
   * Reconciles an open position's token amount to match the authoritative wallet balance.
   * If wallet balance is 0, closes the position.
   */
  public reconcilePosition(mintAddress: string, authoritativeAmountRaw: number): PositionRecord | undefined {
    const pos = this.getOpenPositionByMint(mintAddress);
    if (!pos) return undefined;

    if (authoritativeAmountRaw <= 0) {
      this.closePosition(mintAddress);
      return undefined;
    }

    if (pos.amountRaw > 0 && pos.amountRaw !== authoritativeAmountRaw) {
      const ratio = authoritativeAmountRaw / pos.amountRaw;
      pos.solSpent = pos.solSpent * ratio;
    }
    pos.amountRaw = authoritativeAmountRaw;
    pos.updatedAt = Date.now();
    if (pos.state === 'RECONCILIATION_REQUIRED') {
      pos.state = 'OPEN';
    }
    this.syncServer(pos);
    this.notify();
    return pos;
  }

  public updatePositionState(mintAddress: string, newState: PositionState): boolean {
    const pos = this.getOpenPositionByMint(mintAddress);
    if (pos) {
      this.transitionState(pos.id, newState);
      return true;
    }
    return false;
  }

  public subscribe(listener: PositionRegistryListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const all = Array.from(this.positions.values());
    for (const listener of this.listeners) {
      try {
        listener(all);
      } catch (err) {
        console.error('[PositionRegistry] Error in listener:', err);
      }
    }
  }
}

export const positionRegistry = PositionRegistry.getInstance();
