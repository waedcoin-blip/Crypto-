// server/trading/PositionManager.ts
import { positionRepository, PositionRecord } from '../repositories/PositionRepository.js';

export type PositionStatus = 'NONE' | 'BUY_PENDING' | 'OPEN' | 'EXIT_PENDING' | 'CLOSED';

export interface Position {
  id: string;
  network: string;
  wallet: string;
  mint: string;
  tokenAmount: number; // Raw integer base units
  decimals: number;
  totalSolSpent: number;
  averageEntryPrice: number; // SOL per 1 whole token
  currentPriceSol: number;
  peakPriceSol: number;
  highestPnlPct: number;
  realizedPnl: number; // SOL
  unrealizedPnl: number; // SOL
  unrealizedPnlPct: number;
  status: PositionStatus;
  openedAt: number;
  updatedAt: number;
  closedAt?: number;
  tpPct: number;
  slPct: number;
  trailingSlPct?: number;
  maxHoldTimeMs?: number;
  slippageBpsTp: number;
  slippageBpsSl: number;
  orderIds: string[];
  buySignature?: string;
  exitSignature?: string;
}

export class PositionManager {
  private static instance: PositionManager;
  private positions: Map<string, Position> = new Map(); // Keyed by positionId
  private positionKeys: Map<string, string> = new Map(); // Keyed by network:wallet:mint -> positionId

  private constructor() {
    this.refreshFromRepository();
  }

  public static getInstance(): PositionManager {
    if (!PositionManager.instance) {
      PositionManager.instance = new PositionManager();
    }
    return PositionManager.instance;
  }

  public getPositionKey(network: string, wallet: string, mint: string): string {
    return `${network}:${wallet}:${mint.trim()}`;
  }

  public refreshFromRepository(): void {
    const list = positionRepository.getAllPositions();
    for (const record of list) {
      const existing = this.positions.get(record.id);
      const isClosed = record.state === 'CLOSED';
      const key = this.getPositionKey(record.network || 'paper', record.wallet || 'default', record.mintAddress);

      if (isClosed) {
        if (existing) {
          existing.status = 'CLOSED';
          existing.closedAt = record.closedAt || Date.now();
          existing.exitSignature = record.exitSignature || existing.exitSignature;
          existing.realizedPnl = record.realizedPnLSol ?? existing.realizedPnl;
        }
        if (this.positionKeys.get(key) === record.id) {
          this.positionKeys.delete(key);
        }
        continue;
      }

      const status = this.mapRecordStateToStatus(record.state);
      if (existing) {
        existing.status = status;
        existing.tokenAmount = Number(record.amountRaw || 0);
        existing.decimals = record.decimals;
        existing.totalSolSpent = record.solSpent || 0;
        existing.averageEntryPrice = record.entryPriceSOL || 0;
        existing.currentPriceSol = record.currentPriceSOL || record.entryPriceSOL || 0;
        existing.peakPriceSol = record.peakPriceSOL || record.entryPriceSOL || 0;
        existing.highestPnlPct = record.highestPnLPct || 0;
        existing.unrealizedPnl = record.currentPnLSol || 0;
        existing.unrealizedPnlPct = record.currentPnLPct || 0;
        existing.updatedAt = record.updatedAt;
      } else {
        const pos: Position = {
          id: record.id,
          network: record.network || 'paper',
          wallet: record.wallet || 'default',
          mint: record.mintAddress,
          tokenAmount: Number(record.amountRaw || 0),
          decimals: record.decimals,
          totalSolSpent: record.solSpent || 0,
          averageEntryPrice: record.entryPriceSOL || 0,
          currentPriceSol: record.currentPriceSOL || record.entryPriceSOL || 0,
          peakPriceSol: record.peakPriceSOL || record.entryPriceSOL || 0,
          highestPnlPct: record.highestPnLPct || 0,
          realizedPnl: record.realizedPnLSol || 0,
          unrealizedPnl: record.currentPnLSol || 0,
          unrealizedPnlPct: record.currentPnLPct || 0,
          status,
          openedAt: record.createdAt,
          updatedAt: record.updatedAt,
          closedAt: record.closedAt,
          tpPct: record.tpPct || 25,
          slPct: record.slPct || 15,
          trailingSlPct: record.trailingSlPct,
          maxHoldTimeMs: record.maxHoldTimeMs,
          slippageBpsTp: record.slippageBpsTp || 250,
          slippageBpsSl: record.slippageBpsSl || 1000,
          orderIds: record.orderIds || [],
          buySignature: record.buySignature,
          exitSignature: record.exitSignature,
        };
        this.positions.set(pos.id, pos);
      }

      if (status !== 'CLOSED') {
        this.positionKeys.set(key, record.id);
      }
    }
  }

  private mapRecordStateToStatus(state: string): PositionStatus {
    switch (state) {
      case 'PENDING_BUY': return 'BUY_PENDING';
      case 'OPEN': return 'OPEN';
      case 'EXIT_REQUESTED':
      case 'EXIT_SUBMITTED':
      case 'EXIT_CONFIRMING': return 'EXIT_PENDING';
      case 'CLOSED': return 'CLOSED';
      default: return 'OPEN';
    }
  }

  public getPosition(network: string, wallet: string, mint: string): Position | undefined {
    this.refreshFromRepository();
    const key = this.getPositionKey(network, wallet, mint);
    const posId = this.positionKeys.get(key);
    if (!posId) return undefined;
    const pos = this.positions.get(posId);
    if (pos && pos.status === 'CLOSED') {
      this.positionKeys.delete(key);
      return undefined;
    }
    return pos;
  }

  public getPositionById(id: string): Position | undefined {
    this.refreshFromRepository();
    return this.positions.get(id);
  }

  public getOpenPositions(network?: string, wallet?: string): Position[] {
    this.refreshFromRepository();
    let list = Array.from(this.positions.values()).filter(p => p.status !== 'CLOSED');
    if (network) list = list.filter(p => p.network === network);
    if (wallet) list = list.filter(p => p.wallet === wallet);
    return list;
  }

  public getAllPositions(): Position[] {
    this.refreshFromRepository();
    return Array.from(this.positions.values());
  }

  public updatePositionPrice(
    network: string,
    wallet: string,
    mint: string,
    currentPriceSol: number
  ): Position | undefined {
    const pos = this.getPosition(network, wallet, mint);
    if (!pos || pos.status === 'CLOSED') return undefined;

    pos.currentPriceSol = currentPriceSol;
    if (currentPriceSol > pos.peakPriceSol) {
      pos.peakPriceSol = currentPriceSol;
    }

    const tokenQty = pos.tokenAmount / (10 ** pos.decimals);
    const currentValueSol = tokenQty * currentPriceSol;
    pos.unrealizedPnl = currentValueSol - pos.totalSolSpent;
    pos.unrealizedPnlPct = pos.totalSolSpent > 0 ? (pos.unrealizedPnl / pos.totalSolSpent) * 100 : 0;

    if (pos.unrealizedPnlPct > pos.highestPnlPct) {
      pos.highestPnlPct = pos.unrealizedPnlPct;
    }

    pos.updatedAt = Date.now();
    this.syncRepository(pos);
    return pos;
  }

  public openOrAccumulatePosition(params: {
    network: string;
    wallet: string;
    mint: string;
    tokenAmountRaw: number;
    decimals?: number;
    solSpent: number;
    orderId?: string;
    buySignature?: string;
    tpPct?: number;
    slPct?: number;
    trailingSlPct?: number;
    maxHoldTimeMs?: number;
    slippageBpsTp?: number;
    slippageBpsSl?: number;
  }): Position {
    this.refreshFromRepository();
    const key = this.getPositionKey(params.network, params.wallet, params.mint);
    const existingId = this.positionKeys.get(key);
    const now = Date.now();
    const decimals = params.decimals;
    if (decimals === undefined) {
      throw new Error(`Cannot open position for ${params.mint}: missing decimals.`);
    }

    if (existingId) {
      const existing = this.positions.get(existingId);
      if (existing && existing.status !== 'CLOSED') {
        const prevTotalCost = existing.totalSolSpent;
        const prevTotalRaw = existing.tokenAmount;
        const newTotalCost = prevTotalCost + params.solSpent;
        const newTotalRaw = prevTotalRaw + params.tokenAmountRaw;
        const newTotalQty = newTotalRaw / (10 ** existing.decimals);

        existing.tokenAmount = newTotalRaw;
        existing.totalSolSpent = newTotalCost;
        if (newTotalQty > 0) {
          existing.averageEntryPrice = newTotalCost / newTotalQty;
        }

        if (params.orderId && !existing.orderIds.includes(params.orderId)) {
          existing.orderIds.push(params.orderId);
        }
        if (params.tpPct !== undefined) existing.tpPct = params.tpPct;
        if (params.slPct !== undefined) existing.slPct = params.slPct;
        existing.status = 'OPEN';
        existing.updatedAt = now;

        this.syncRepository(existing);
        return existing;
      }
    }

    // New Position
    const posId = `pos_${now}_${params.mint.slice(0, 6)}`;
    const tokenQty = params.tokenAmountRaw / (10 ** decimals);
    const averageEntryPrice = tokenQty > 0 ? params.solSpent / tokenQty : 0;

    const newPos: Position = {
      id: posId,
      network: params.network,
      wallet: params.wallet,
      mint: params.mint,
      tokenAmount: params.tokenAmountRaw,
      decimals,
      totalSolSpent: params.solSpent,
      averageEntryPrice,
      currentPriceSol: averageEntryPrice,
      peakPriceSol: averageEntryPrice,
      highestPnlPct: 0,
      realizedPnl: 0,
      unrealizedPnl: 0,
      unrealizedPnlPct: 0,
      status: 'OPEN',
      openedAt: now,
      updatedAt: now,
      tpPct: params.tpPct ?? 25,
      slPct: params.slPct ?? 15,
      trailingSlPct: params.trailingSlPct,
      maxHoldTimeMs: params.maxHoldTimeMs,
      slippageBpsTp: params.slippageBpsTp ?? 250,
      slippageBpsSl: params.slippageBpsSl ?? 1000,
      orderIds: params.orderId ? [params.orderId] : [],
      buySignature: params.buySignature,
    };

    this.positions.set(posId, newPos);
    this.positionKeys.set(key, posId);
    this.syncRepository(newPos);
    return newPos;
  }

  public updatePositionStatus(
    network: string,
    wallet: string,
    mint: string,
    status: PositionStatus,
    exitDetails?: { exitSignature?: string; netProceedsSol?: number }
  ): Position | undefined {
    this.refreshFromRepository();
    const pos = this.getPosition(network, wallet, mint);
    if (!pos) return undefined;

    pos.status = status;
    pos.updatedAt = Date.now();

    if (status === 'CLOSED') {
      pos.closedAt = Date.now();
      if (exitDetails?.exitSignature) pos.exitSignature = exitDetails.exitSignature;
      if (exitDetails?.netProceedsSol !== undefined) {
        pos.realizedPnl = exitDetails.netProceedsSol - pos.totalSolSpent;
      }
      const key = this.getPositionKey(network, wallet, mint);
      this.positionKeys.delete(key);

      positionRepository.closePosition(pos.id, {
        exitSignature: pos.exitSignature,
        realizedPnLSol: pos.realizedPnl,
        realizedPnLPct: pos.totalSolSpent > 0 ? (pos.realizedPnl / pos.totalSolSpent) * 100 : 0,
      });
      return pos;
    }

    this.syncRepository(pos);
    return pos;
  }

  private syncRepository(pos: Position): void {
    const record: PositionRecord = {
      id: pos.id,
      mintAddress: pos.mint,
      network: pos.network,
      wallet: pos.wallet,
      amountRaw: pos.tokenAmount,
      decimals: pos.decimals,
      entryPriceSOL: pos.averageEntryPrice,
      solSpent: pos.totalSolSpent,
      currentPriceSOL: pos.currentPriceSol,
      peakPriceSOL: pos.peakPriceSol,
      highestPnLPct: pos.highestPnlPct,
      currentPnLSol: pos.unrealizedPnl,
      currentPnLPct: pos.unrealizedPnlPct,
      tpPct: pos.tpPct,
      slPct: pos.slPct,
      trailingSlPct: pos.trailingSlPct,
      maxHoldTimeMs: pos.maxHoldTimeMs,
      slippageBpsTp: pos.slippageBpsTp,
      slippageBpsSl: pos.slippageBpsSl,
      state: pos.status === 'CLOSED' ? 'CLOSED' : pos.status === 'EXIT_PENDING' ? 'EXIT_SUBMITTED' : pos.status === 'BUY_PENDING' ? 'PENDING_BUY' : 'OPEN',
      orderIds: pos.orderIds,
      buySignature: pos.buySignature,
      exitSignature: pos.exitSignature,
      createdAt: pos.openedAt,
      updatedAt: pos.updatedAt,
      closedAt: pos.closedAt,
      realizedPnLSol: pos.realizedPnl,
    };
    positionRepository.upsertPosition(record);
  }
}

export const positionManager = PositionManager.getInstance();
