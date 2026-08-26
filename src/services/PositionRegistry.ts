// src/services/PositionRegistry.ts
import { TradingNetwork } from '../config/network';

export type PositionState =
  | 'PENDING_BUY'
  | 'OPEN'
  | 'EXIT_REQUESTED'
  | 'EXIT_SUBMITTED'
  | 'EXIT_CONFIRMING'
  | 'CLOSED'
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
  private positions: Map<string, PositionRecord> = new Map(); // Keyed by position ID (or mintAddress for 1-pos-per-mint)
  private positionsByMint: Map<string, string> = new Map(); // mintAddress -> positionId (for open positions)
  private listeners: Set<PositionRegistryListener> = new Set();

  private constructor() {
    this.loadPersistedPositions();
  }

  public static getInstance(): PositionRegistry {
    if (!PositionRegistry.instance) {
      PositionRegistry.instance = new PositionRegistry();
    }
    return PositionRegistry.instance;
  }

  private loadPersistedPositions(): void {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem('app_position_registry');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const pos of parsed) {
            if (pos && pos.id && pos.mintAddress) {
              this.positions.set(pos.id, pos);
              if (pos.state !== 'CLOSED') {
                this.positionsByMint.set(pos.mintAddress, pos.id);
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn('[PositionRegistry] Failed to load persisted positions:', e);
    }
  }

  private persist(): void {
    if (typeof window === 'undefined') return;
    try {
      const arr = Array.from(this.positions.values()).slice(-100);
      localStorage.setItem('app_position_registry', JSON.stringify(arr));
    } catch (e) {
      console.warn('[PositionRegistry] Failed to persist positions:', e);
    }
  }

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
    const existingId = this.positionsByMint.get(mint);
    if (existingId) {
      const existing = this.positions.get(existingId);
      if (existing && existing.state !== 'CLOSED') {
        // Position already exists, update amounts and return
        if (params.amountRaw > 0) existing.amountRaw = params.amountRaw;
        if (params.solSpent > 0) existing.solSpent = params.solSpent;
        if (params.entryPriceSOL > 0) existing.entryPriceSOL = params.entryPriceSOL;
        if (params.orderId && !existing.orderIds.includes(params.orderId)) {
          existing.orderIds.push(params.orderId);
        }
        existing.updatedAt = Date.now();
        this.persist();
        this.notify();
        return existing;
      }
    }

    const posId = `pos_${Date.now()}_${mint.slice(0, 6)}`;
    const now = Date.now();
    const decimals = params.decimals !== undefined ? params.decimals : 6;

    const record: PositionRecord = {
      id: posId,
      mintAddress: mint,
      network: params.network,
      amountRaw: params.amountRaw,
      decimals,
      entryPriceSOL: params.entryPriceSOL > 0 ? params.entryPriceSOL : (params.solSpent / (params.amountRaw / (10 ** decimals) || 1)),
      solSpent: params.solSpent,
      currentPriceSOL: params.entryPriceSOL,
      peakPriceSOL: params.entryPriceSOL,
      highestPnLPct: 0,
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
    this.persist();
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
    if (!pos || pos.state === 'CLOSED') return;

    pos.currentPriceSOL = priceSOL;
    if (priceSOL > pos.peakPriceSOL) {
      pos.peakPriceSOL = priceSOL;
    }

    const pnlPct = pos.entryPriceSOL > 0 ? ((priceSOL - pos.entryPriceSOL) / pos.entryPriceSOL) * 100 : 0;
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
      this.positionsByMint.delete(pos.mintAddress);
    }

    this.persist();
    this.notify();
  }

  public closePosition(mintAddress: string, signature?: string, pnlSol?: number, pnlPct?: number): void {
    const pos = this.getOpenPositionByMint(mintAddress);
    if (pos) {
      this.transitionState(pos.id, 'CLOSED', {
        exitSignature: signature,
        realizedPnLSol: pnlSol,
        realizedPnLPct: pnlPct,
      });
    }
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
