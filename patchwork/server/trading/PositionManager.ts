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
    this.loadFromRepository();
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

  private loadFromRepository(): void {
    const list = positionRepository.getAllPositions();
    for (const record of list) {
      const pos: Position = {
        id: record.id,
        network: record.network || 'paper',
        wallet: record.wallet || 'default',
        mint: record.mintAddress,
        tokenAmount: Number(record.amountRaw || 0),
        decimals: Number.isInteger(record.decimals) && record.decimals >= 0 && record.decimals <= 18 ? record.decimals : (() => { throw new Error(`INVALID_PERSISTED_DECIMALS: ${record.mintAddress}`); })(),
        totalSolSpent: record.solSpent || 0,
        averageEntryPrice: record.entryPriceSOL || 0,
        currentPriceSol: record.currentPriceSOL || record.entryPriceSOL || 0,
        peakPriceSol: record.peakPriceSOL || record.entryPriceSOL || 0,
        highestPnlPct: record.highestPnLPct || 0,
        realizedPnl: record.realizedPnLSol || 0,
        unrealizedPnl: record.currentPnLSol || 0,
        unrealizedPnlPct: record.currentPnLPct || 0,
        status: this.mapRecordStateToStatus(record.state),
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
      if (pos.status !== 'CLOSED') {
        const key = this.getPositionKey(pos.network, pos.wallet, pos.mint);
        this.positionKeys.set(key, pos.id);
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
    const key = this.getPositionKey(network, wallet, mint);
    const posId = this.positionKeys.get(key);
    if (!posId) return undefined;
    return this.positions.get(posId);
  }

  public getPositionById(id: string): Position | undefined {
    return this.positions.get(id);
  }

  public getOpenPositions(network?: string, wallet?: string): Position[] {
    let list = Array.from(this.positions.values()).filter(p => p.status !== 'CLOSED');
    if (network) list = list.filter(p => p.network === network);
    if (wallet) list = list.filter(p => p.wallet === wallet);
    return list;
  }

  public getAllPositions(): Position[] {
    return Array.from(this.positions.values());
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
    const key = this.getPositionKey(params.network, params.wallet, params.mint);
    const existingId = this.positionKeys.get(key);
    const now = Date.now();
    const decimals = params.decimals;
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) throw new Error(`UNRESOLVED_TOKEN_DECIMALS: decimals required for ${params.mint}`);

    if (existingId) {
      const existing = this.positions.get(existingId);
      if (existing && existing.status !== 'CLOSED') {
        // Weighted average cost basis accumulation
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

  public reducePosition(network: string, wallet: string, mint: string, soldRaw: number, proceedsSol: number, exitSignature?: string): Position | undefined {
    const pos = this.getPosition(network, wallet, mint);
    if (!pos) return undefined;
    if (!Number.isSafeInteger(soldRaw) || soldRaw <= 0 || soldRaw >= pos.tokenAmount) throw new Error('INVALID_PARTIAL_SELL');
    const fraction = soldRaw / pos.tokenAmount;
    pos.tokenAmount -= soldRaw;
    pos.totalSolSpent = Math.max(0, pos.totalSolSpent * (1 - fraction));
    pos.realizedPnl += proceedsSol - (pos.totalSolSpent > 0 ? pos.totalSolSpent * fraction / (1 - fraction) : 0);
    if (exitSignature) pos.exitSignature = exitSignature;
    pos.status = 'OPEN';
    pos.updatedAt = Date.now();
    this.syncRepository(pos);
    return pos;
  }

  public updatePositionStatus(
    network: string,
    wallet: string,
    mint: string,
    status: PositionStatus,
    exitDetails?: { exitSignature?: string; netProceedsSol?: number }
  ): Position | undefined {
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
