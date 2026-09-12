// server/trading/PositionManager.ts
import { positionRepository, PositionRecord } from '../repositories/PositionRepository.js';
import { positionValuationEngine } from './PositionValuationEngine.js';
import { heliusLaserStreamWssManager } from '../market/HeliusLaserStreamWssManager.js';
import { rawToUiNumber, parsePositiveRawAmount, safeRawNumber } from '../utils/rawAmount.js';
import { logger } from '../utils/logger.js';

export type PositionStatus = 'NONE' | 'BUY_PENDING' | 'OPEN' | 'EXIT_PENDING' | 'RECOVERY_REQUIRED' | 'CLOSED';

export interface Position {
  id: string;
  network: string;
  wallet: string;
  mint: string;
  symbol?: string;
  tokenAmount: number;
  tokenAmountRaw?: string;
  decimals: number;
  totalSolSpent: number;
  averageEntryPrice: number;
  currentPriceSol: number;
  peakPriceSol: number;
  highestPnlPct: number;
  realizedPnl: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  status: PositionStatus;
  openedAt: number;
  updatedAt: number;
  lastMarketPriceAt?: number;
  lastExecutableQuoteAt?: number;
  lastMarketEventAt?: number;
  lastExitEvaluationAt?: number;
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
  totalSolSpentOnSold?: number;
}

export class PositionManager {
  private static instance: PositionManager;
  private positions: Map<string, Position> = new Map();
  private positionKeys: Map<string, string> = new Map();

  private constructor() {
    this.refreshFromRepository(); // Only load on startup
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

  private parseRawAmountSafe(value: number | string | bigint, positionId: string): number {
    const raw = parsePositiveRawAmount(value, `position ${positionId}`);
    return safeRawNumber(raw);
  }

  public clear(): void {
    this.positions.clear();
    this.positionKeys.clear();
  }

  // ==========================================
  // REPOSITORY SYNC (Startup only)
  // ==========================================

  public refreshFromRepository(): void {
    this.positions.clear();
    this.positionKeys.clear();
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
        if (this.positionKeys.get(key) === record.id) this.positionKeys.delete(key);
        continue;
      }

      const status = this.mapRecordStateToStatus(record.state);
      if (existing) {
        existing.status = status;
        existing.tokenAmount = this.parseRawAmountSafe(record.amountRaw, record.id);
        existing.tokenAmountRaw = record.amountRaw;
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
          tokenAmount: this.parseRawAmountSafe(record.amountRaw, record.id),
          tokenAmountRaw: record.amountRaw,
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
          tpPct: Number.isFinite(record.tpPct) ? record.tpPct : 25,
          slPct: Number.isFinite(record.slPct) ? record.slPct : 15,
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
      if (status !== 'CLOSED') this.positionKeys.set(key, record.id);
    }
  }

  private mapRecordStateToStatus(state: string): PositionStatus {
    switch (state) {
      case 'PENDING_BUY': return 'BUY_PENDING';
      case 'OPEN': return 'OPEN';
      case 'EXIT_REQUESTED': case 'EXIT_SUBMITTED': case 'EXIT_CONFIRMING': return 'EXIT_PENDING';
      case 'RECOVERY_REQUIRED': return 'RECOVERY_REQUIRED';
      case 'CLOSED': return 'CLOSED';
      default: return 'OPEN';
    }
  }

  // ==========================================
  // READ OPERATIONS (No DB reads — FIX)
  // ==========================================

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
    let list = Array.from(this.positions.values()).filter(p => p.status !== 'CLOSED');
    if (network) list = list.filter(p => p.network === network);
    if (wallet) list = list.filter(p => p.wallet === wallet);
    return list;
  }

  public getAllPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  // ==========================================
  // PRICE UPDATES
  // ==========================================

  public updatePositionPrice(
    network: string,
    wallet: string,
    mint: string,
    currentPriceSol: number,
    opts: { isFreshQuote?: boolean; isMarketEvent?: boolean; timestamp?: number } = {}
  ): Position | undefined {
    const pos = this.getPosition(network, wallet, mint);
    if (!pos || pos.status === 'CLOSED') return undefined;
    const now = opts.timestamp || Date.now();

    pos.currentPriceSol = currentPriceSol;
    pos.lastMarketPriceAt = now;
    if (opts.isFreshQuote) pos.lastExecutableQuoteAt = now;
    if (opts.isMarketEvent) pos.lastMarketEventAt = now;
    if (currentPriceSol > pos.peakPriceSol) pos.peakPriceSol = currentPriceSol;

    const tokenQty = pos.tokenAmountRaw
      ? rawToUiNumber(BigInt(pos.tokenAmountRaw), pos.decimals)
      : pos.tokenAmount / (10 ** pos.decimals);
    const currentValueSol = tokenQty * currentPriceSol;
    pos.unrealizedPnl = currentValueSol - pos.totalSolSpent;
    pos.unrealizedPnlPct = pos.totalSolSpent > 0 ? (pos.unrealizedPnl / pos.totalSolSpent) * 100 : 0;
    if (pos.unrealizedPnlPct > pos.highestPnlPct) pos.highestPnlPct = pos.unrealizedPnlPct;

    pos.updatedAt = now;
    this.syncRepository(pos);
    return pos;
  }

  // ==========================================
  // POSITION CREATION / ACCUMULATION
  // ==========================================

  public openOrAccumulatePosition(params: {
    network: string;
    wallet: string;
    mint: string;
    tokenAmountRaw: number | string | bigint;
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
    if (decimals === undefined) throw new Error(`Cannot open position for ${params.mint}: missing decimals.`);

    let rawBigInt: bigint;
    try {
      rawBigInt = BigInt(params.tokenAmountRaw);
      if (rawBigInt <= 0n) throw new Error('NON_POSITIVE');
    } catch {
      throw new Error(`INVALID_RAW_TOKEN_AMOUNT: tokenAmountRaw must be a positive integer for ${params.mint}.`);
    }

    const tokenAmountNum = safeRawNumber(rawBigInt);
    const tpPct = params.tpPct ?? 25;
    const slPct = Math.abs(params.slPct ?? 15);
    if (!Number.isFinite(tpPct) || tpPct <= 0 || !Number.isFinite(slPct) || slPct <= 0 || slPct >= 100) {
      throw new Error(`INVALID_TP_SL: TP must be > 0 and SL must be > 0 and < 100 for ${params.mint}.`);
    }

    if (existingId) {
      const existing = this.positions.get(existingId);
      if (existing && existing.status !== 'CLOSED') {
        const prevTotalCost = existing.totalSolSpent;
        const newTotalCost = prevTotalCost + params.solSpent;

        // FIX: Safe BigInt conversion for legacy positions
        const prevTotalRawBig = existing.tokenAmountRaw
          ? BigInt(existing.tokenAmountRaw)
          : BigInt(Math.floor(existing.tokenAmount * (10 ** existing.decimals)));

        const newTotalRawBig = prevTotalRawBig + BigInt(params.tokenAmountRaw);
        const newTotalQty = rawToUiNumber(newTotalRawBig, existing.decimals);

        existing.tokenAmountRaw = newTotalRawBig.toString();
        existing.tokenAmount = safeRawNumber(newTotalRawBig);
        existing.totalSolSpent = newTotalCost;
        if (newTotalQty > 0) existing.averageEntryPrice = newTotalCost / newTotalQty;
        if (params.orderId && !existing.orderIds.includes(params.orderId)) existing.orderIds.push(params.orderId);
        if (params.tpPct !== undefined) existing.tpPct = params.tpPct;
        if (params.slPct !== undefined) existing.slPct = slPct;

        existing.status = 'OPEN';
        existing.updatedAt = now;
        this.syncRepository(existing);
        return existing;
      }
    }

    const posId = `pos_${now}_${params.mint.slice(0, 6)}`;
    const tokenQty = rawToUiNumber(rawBigInt, decimals);
    const averageEntryPrice = tokenQty > 0 ? params.solSpent / tokenQty : 0;

    const newPos: Position = {
      id: posId,
      network: params.network,
      wallet: params.wallet,
      mint: params.mint,
      tokenAmount: tokenAmountNum,
      tokenAmountRaw: rawBigInt.toString(),
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
      tpPct,
      slPct,
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

    try {
      heliusLaserStreamWssManager.subscribeActivePositionMint(params.mint);
    } catch {}

    return newPos;
  }

  // ==========================================
  // POSITION REDUCTION (Partial/Full Sell)
  // ==========================================

  public reducePositionAmount(positionId: string, tokensSoldRaw: number | string | bigint, solReceived: number): Position | undefined {
    const pos = this.getPositionById(positionId);
    if (!pos) return undefined;

    // FIX: Safe BigInt conversion
    const currentRaw = pos.tokenAmountRaw
      ? BigInt(pos.tokenAmountRaw)
      : BigInt(Math.floor(pos.tokenAmount * (10 ** pos.decimals)));

    const soldRaw = BigInt(String(tokensSoldRaw));
    if (soldRaw <= 0n || soldRaw > currentRaw) return undefined;

    const remainingRaw = currentRaw - soldRaw;
    const soldFraction = Number(soldRaw * 1_000_000n / currentRaw) / 1_000_000;
    const soldCostBasis = pos.totalSolSpent * soldFraction;

    pos.totalSolSpentOnSold = (pos.totalSolSpentOnSold || 0) + soldCostBasis;
    pos.tokenAmountRaw = remainingRaw.toString();
    pos.tokenAmount = safeRawNumber(remainingRaw);
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

  // ==========================================
  // STATUS UPDATES
  // ==========================================

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
      positionValuationEngine.removeValuation(network, wallet, mint);
      try {
        heliusLaserStreamWssManager.unsubscribeActivePositionMint(mint);
      } catch {}
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

  // ==========================================
  // TP/SL UPDATES
  // ==========================================

  public updatePositionTpSl(
    network: string | undefined,
    wallet: string | undefined,
    mint: string,
    tpPct?: number,
    slPct?: number,
    trailingSlPct?: number
  ): Position | undefined {
    let pos: Position | undefined;
    if (network && wallet) {
      pos = this.getPosition(network, wallet, mint);
    } else {
      // Search all positions for this mint
      for (const p of this.positions.values()) {
        if (p.mint === mint && p.status !== 'CLOSED') {
          pos = p;
          break;
        }
      }
    }
    if (!pos) return undefined;

    if (tpPct !== undefined && Number.isFinite(tpPct) && tpPct > 0) pos.tpPct = tpPct;
    if (slPct !== undefined && Number.isFinite(slPct) && slPct > 0) pos.slPct = slPct;
    if (trailingSlPct !== undefined && Number.isFinite(trailingSlPct)) pos.trailingSlPct = trailingSlPct;

    pos.updatedAt = Date.now();
    this.syncRepository(pos);
    return pos;
  }

  // ==========================================
  // REPOSITORY SYNC
  // ==========================================

  private syncRepository(pos: Position): void {
    const record: PositionRecord = {
      id: pos.id,
      mintAddress: pos.mint,
      network: pos.network,
      wallet: pos.wallet,
      amountRaw: pos.tokenAmountRaw || String(pos.tokenAmount),
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
      state: pos.status === 'CLOSED' ? 'CLOSED'
        : pos.status === 'RECOVERY_REQUIRED' ? 'RECOVERY_REQUIRED'
        : pos.status === 'EXIT_PENDING' ? 'EXIT_SUBMITTED'
        : pos.status === 'BUY_PENDING' ? 'PENDING_BUY'
        : 'OPEN',
      orderIds: pos.orderIds,
      buySignature: pos.buySignature,
      exitSignature: pos.exitSignature,
      createdAt: pos.openedAt,
      updatedAt: pos.updatedAt,
      lastMarketPriceAt: pos.lastMarketPriceAt,
      lastExecutableQuoteAt: pos.lastExecutableQuoteAt,
      lastMarketEventAt: pos.lastMarketEventAt,
      lastExitEvaluationAt: pos.lastExitEvaluationAt,
      closedAt: pos.closedAt,
      realizedPnLSol: pos.realizedPnl,
    };
    positionRepository.upsertPosition(record);
  }
}

export const positionManager = PositionManager.getInstance();
