// server/trading/PositionManager.ts
import { positionRepository, PositionRecord, PositionState } from '../repositories/PositionRepository.js';
import { rawToUiNumber, safeRawNumber } from '../utils/rawAmount.js';

export interface Position {
  id: string;
  mint: string;
  network: string;
  wallet: string;
  tokenAmountRaw: string;
  tokenAmount: number;
  decimals: number;
  averageEntryPrice: number;
  totalSolSpent: number;
  currentPrice: number;
  peakPrice: number;
  highestPnLPct: number;
  tpPct: number;
  slPct: number;
  status: PositionState;
  orderIds: string[];
  buySignature?: string;
  exitSignature?: string;
  maxHoldTimeMs?: number;
  openedAt?: number;
  slippageBpsTp?: number;
  slippageBpsSl?: number;
  trailingSlPct?: number;
  createdAt: number;
  updatedAt: number;
  closedAt?: number;
  totalSolSpentOnSold?: number;
  realizedPnl: number;
  lastMarketPriceAt?: number;
  lastExecutableQuoteAt?: number;
  lastMarketEventAt?: number;
  lastExitEvaluationAt?: number;
  executableValueSol?: number;
  executablePnlSol?: number;
  executablePnlPercent?: number;
  marketValueSol?: number;
  marketPnlSol?: number;
  marketPnlPercent?: number;
  valuationSource?: string;
}

export interface OpenPositionParams {
  network: string;
  wallet: string;
  mint: string;
  tokenAmountRaw: string | bigint;
  decimals: number;
  solSpent: number;
  buyPriceSol?: number;
  orderId?: string;
  buySignature?: string;
  tpPct?: number;
  slPct?: number;
  trailingSlPct?: number;
  maxHoldTimeMs?: number;
}

export class PositionManager {
  private static instance: PositionManager;
  private positions = new Map<string, Position>();
  private positionKeys = new Map<string, string>(); // key -> positionId

  constructor() {
    this.refreshFromRepository();
  }

  public static getInstance(): PositionManager {
    if (!PositionManager.instance) {
      PositionManager.instance = new PositionManager();
    }
    return PositionManager.instance;
  }

  public getPositionKey(network: string, wallet: string, mint: string): string {
    return `${network.toLowerCase()}:${(wallet || 'default').toLowerCase()}:${mint.trim()}`;
  }

  public refreshFromRepository(): void {
    try {
      const records = positionRepository.getAllPositions();
      for (const record of records) {
        const pos = this.mapRecordToPosition(record);
        this.positions.set(pos.id, pos);
        if (pos.status !== 'CLOSED') {
          const key = this.getPositionKey(pos.network, pos.wallet, pos.mint);
          this.positionKeys.set(key, pos.id);
        }
      }
    } catch (e) {
      console.warn('[PositionManager] Error refreshing from repository:', e);
    }
  }

  private mapRecordToPosition(r: PositionRecord): Position {
    const rawBig = BigInt(r.amountRaw || '0');
    return {
      id: r.id,
      mint: r.mintAddress,
      network: r.network,
      wallet: r.wallet || 'default',
      tokenAmountRaw: r.amountRaw ? String(r.amountRaw) : '0',
      tokenAmount: rawToUiNumber(rawBig, r.decimals),
      decimals: r.decimals,
      averageEntryPrice: r.entryPriceSOL,
      totalSolSpent: r.solSpent,
      currentPrice: r.currentPriceSOL,
      peakPrice: r.peakPriceSOL,
      highestPnLPct: r.highestPnLPct,
      tpPct: r.tpPct,
      slPct: r.slPct,
      status: r.state as PositionState,
      orderIds: r.orderIds || [],
      buySignature: r.buySignature,
      exitSignature: r.exitSignature,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      closedAt: r.closedAt,
      realizedPnl: r.realizedPnLSol || 0,
      lastMarketPriceAt: r.lastMarketPriceAt,
      lastExecutableQuoteAt: r.lastExecutableQuoteAt,
      lastMarketEventAt: r.lastMarketEventAt,
      lastExitEvaluationAt: r.lastExitEvaluationAt,
    };
  }

  private syncRepository(pos: Position): void {
    try {
      positionRepository.upsertPosition({
        id: pos.id,
        mintAddress: pos.mint,
        network: pos.network,
        wallet: pos.wallet,
        amountRaw: pos.tokenAmountRaw,
        decimals: pos.decimals,
        entryPriceSOL: pos.averageEntryPrice,
        solSpent: pos.totalSolSpent,
        currentPriceSOL: pos.currentPrice,
        peakPriceSOL: pos.peakPrice,
        highestPnLPct: pos.highestPnLPct,
        tpPct: pos.tpPct,
        slPct: pos.slPct,
        slippageBpsTp: 150,
        slippageBpsSl: 300,
        state: pos.status,
        orderIds: pos.orderIds,
        buySignature: pos.buySignature,
        exitSignature: pos.exitSignature,
        createdAt: pos.createdAt,
        updatedAt: pos.updatedAt,
        lastMarketPriceAt: pos.lastMarketPriceAt,
        lastExecutableQuoteAt: pos.lastExecutableQuoteAt,
        lastMarketEventAt: pos.lastMarketEventAt,
        lastExitEvaluationAt: pos.lastExitEvaluationAt,
        closedAt: pos.closedAt,
        realizedPnLSol: pos.realizedPnl,
      });
    } catch (err) {
      console.warn('[PositionManager] Repository sync non-blocking error:', err);
    }
  }

  // FIX 1: Read-only getter without forcing full repository refresh
  public getPosition(network: string, wallet: string, mint: string): Position | undefined {
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
    return this.positions.get(id);
  }

  public getOpenPositions(network?: string, wallet?: string): Position[] {
    return Array.from(this.positions.values()).filter(pos => {
      if (pos.status === 'CLOSED') return false;
      if (network && pos.network !== network) return false;
      if (wallet && pos.wallet !== wallet) return false;
      return true;
    });
  }

  public getAllPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  public openOrAccumulatePosition(params: OpenPositionParams): Position {
    const network = params.network || 'paper';
    const wallet = params.wallet || 'default';
    const mint = params.mint.trim();
    const key = this.getPositionKey(network, wallet, mint);
    const existingId = this.positionKeys.get(key);
    const now = Date.now();

    const rawBig = typeof params.tokenAmountRaw === 'bigint'
      ? params.tokenAmountRaw
      : BigInt(params.tokenAmountRaw || '0');

    if (existingId) {
      const existing = this.positions.get(existingId);
      if (existing && existing.status !== 'CLOSED') {
        const prevTotalCost = existing.totalSolSpent;
        const newTotalCost = prevTotalCost + params.solSpent;
        const prevTotalRawBig = existing.tokenAmountRaw
          ? BigInt(existing.tokenAmountRaw)
          : BigInt(Math.floor(existing.tokenAmount * (10 ** existing.decimals)));
        const newTotalRawBig = prevTotalRawBig + rawBig;
        const newTotalQty = rawToUiNumber(newTotalRawBig, existing.decimals);
        existing.tokenAmountRaw = newTotalRawBig.toString();
        existing.tokenAmount = newTotalQty;
        existing.totalSolSpent = newTotalCost;
        if (newTotalQty > 0) existing.averageEntryPrice = newTotalCost / newTotalQty;
        if (params.orderId && !existing.orderIds.includes(params.orderId)) existing.orderIds.push(params.orderId);
        if (params.tpPct !== undefined) existing.tpPct = params.tpPct;
        if (params.slPct !== undefined) existing.slPct = params.slPct;
        if (params.buySignature) existing.buySignature = params.buySignature;
        existing.status = 'OPEN';
        existing.updatedAt = now;
        this.syncRepository(existing);
        return existing;
      }
    }

    const tokenQty = rawToUiNumber(rawBig, params.decimals);
    const buyPrice = params.buyPriceSol || (tokenQty > 0 ? params.solSpent / tokenQty : 0);

    const pos: Position = {
      id: `pos-${now}-${Math.random().toString(36).substring(2, 7)}`,
      mint,
      network,
      wallet,
      tokenAmountRaw: rawBig.toString(),
      tokenAmount: tokenQty,
      decimals: params.decimals,
      averageEntryPrice: buyPrice,
      totalSolSpent: params.solSpent,
      currentPrice: buyPrice,
      peakPrice: buyPrice,
      highestPnLPct: 0,
      tpPct: params.tpPct || 25,
      slPct: params.slPct || 15,
      status: 'OPEN',
      orderIds: params.orderId ? [params.orderId] : [],
      buySignature: params.buySignature,
      createdAt: now,
      updatedAt: now,
      realizedPnl: 0,
    };

    this.positions.set(pos.id, pos);
    this.positionKeys.set(key, pos.id);
    this.syncRepository(pos);
    return pos;
  }

  public reducePositionAmount(positionId: string, tokensSoldRaw: number | string | bigint, solReceived: number): Position | undefined {
    const pos = this.getPositionById(positionId);
    if (!pos) return undefined;
    const currentRaw = pos.tokenAmountRaw
      ? BigInt(pos.tokenAmountRaw)
      : BigInt(Math.floor(pos.tokenAmount * (10 ** pos.decimals)));
    const soldRaw = BigInt(String(tokensSoldRaw));
    if (soldRaw <= 0n || soldRaw > currentRaw) return undefined;
    const remainingRaw = currentRaw - soldRaw;
    const soldFraction = Number(soldRaw * 1_000_000n / (currentRaw || 1n)) / 1_000_000;
    const soldCostBasis = pos.totalSolSpent * soldFraction;
    pos.totalSolSpentOnSold = (pos.totalSolSpentOnSold || 0) + soldCostBasis;
    pos.tokenAmountRaw = remainingRaw.toString();
    pos.tokenAmount = rawToUiNumber(remainingRaw, pos.decimals);
    pos.realizedPnl += solReceived - soldCostBasis;
    pos.updatedAt = Date.now();
    if (remainingRaw <= 0n) {
      pos.status = 'CLOSED';
      pos.closedAt = Date.now();
      const key = this.getPositionKey(pos.network, pos.wallet, pos.mint);
      this.positionKeys.delete(key);
    }
    this.syncRepository(pos);
    return pos;
  }

  public updatePositionPrice(network: string, wallet: string, mint: string, priceSol: number, options?: { lastMarketEventAt?: number; source?: string; isMarketEvent?: boolean; timestamp?: number }): Position | undefined {
    const pos = this.getPosition(network, wallet, mint);
    if (!pos || pos.status === 'CLOSED') return undefined;
    const now = options?.timestamp || Date.now();
    pos.currentPrice = priceSol;
    pos.lastMarketPriceAt = now;
    if (options?.lastMarketEventAt) pos.lastMarketEventAt = options.lastMarketEventAt;
    if (options?.source) pos.valuationSource = options.source;
    if (priceSol > pos.peakPrice) {
      pos.peakPrice = priceSol;
      if (pos.averageEntryPrice > 0) {
        pos.highestPnLPct = ((priceSol - pos.averageEntryPrice) / pos.averageEntryPrice) * 100;
      }
    }
    pos.updatedAt = now;
    this.syncRepository(pos);
    return pos;
  }

  public updatePositionStatus(network: string, wallet: string, mint: string, status: PositionState, options?: { exitSignature?: string; netProceedsSol?: number }): Position | undefined {
    const pos = this.getPosition(network, wallet, mint);
    if (!pos) return undefined;
    pos.status = status;
    pos.updatedAt = Date.now();
    if (options?.exitSignature) pos.exitSignature = options.exitSignature;
    if (options?.netProceedsSol !== undefined) {
      pos.realizedPnl = options.netProceedsSol - pos.totalSolSpent;
    }
    if (status === 'CLOSED') {
      pos.closedAt = Date.now();
      const key = this.getPositionKey(network, wallet, mint);
      this.positionKeys.delete(key);
    }
    this.syncRepository(pos);
    return pos;
  }
}

export const positionManager = PositionManager.getInstance();
