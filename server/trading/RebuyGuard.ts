// server/trading/RebuyGuard.ts
import { tradeRepository } from '../repositories/TradeRepository.js';
import { logger } from '../utils/logger.js';

interface BuyReservation {
  reservationId: string;
  network: string;
  wallet: string;
  mint: string;
  amountSol: number;
  reservedAt: number;
  maxRebuyTimes: number;
}

export class RebuyGuard {
  private static instance: RebuyGuard;
  private pendingReservations: Map<string, BuyReservation> = new Map();
  private reservedKeys: Map<string, string> = new Map(); // guardKey -> reservationId
  private tradeCountCache: Map<string, { count: number; cachedAt: number }> = new Map();
  private readonly CACHE_TTL_MS = 10000; // 10 seconds

  private constructor() {}

  public static getInstance(): RebuyGuard {
    if (!RebuyGuard.instance) {
      RebuyGuard.instance = new RebuyGuard();
    }
    return RebuyGuard.instance;
  }

  private getGuardKey(network: string, wallet: string, mint: string): string {
    return `${network}:${wallet}:${mint.trim().toLowerCase()}`;
  }

  // ==========================================
  // RESERVATION (Atomic)
  // ==========================================

  public reserveBuy(params: {
    network: string;
    wallet: string;
    mint: string;
    amountSol: number;
    maxRebuyTimes?: number;
    tradeOnlyOnce?: boolean;
  }): { reservationId?: string; reason?: string } {
    const key = this.getGuardKey(params.network, params.wallet, params.mint);

    // Check if already reserved (prevents concurrent buys of same token)
    if (this.reservedKeys.has(key)) {
      return { reason: 'ALREADY_RESERVED: A buy for this token is already in progress' };
    }

    // Check rebuy limit
    const maxRebuys = params.tradeOnlyOnce ? 1 : (params.maxRebuyTimes ?? 1);
    const completedCount = this.getCompletedBuyCount(params.network, params.wallet, params.mint);
    if (completedCount >= maxRebuys) {
      return { reason: `MAX_REBUYS_REACHED: ${completedCount}/${maxRebuys} buys completed` };
    }

    const reservationId = `res_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const reservation: BuyReservation = {
      reservationId,
      network: params.network,
      wallet: params.wallet,
      mint: params.mint,
      amountSol: params.amountSol,
      reservedAt: Date.now(),
      maxRebuyTimes: maxRebuys,
    };

    this.pendingReservations.set(reservationId, reservation);
    this.reservedKeys.set(key, reservationId);

    return { reservationId };
  }

  // ==========================================
  // CONFIRMATION / RELEASE
  // ==========================================

  public confirmBuy(reservationId: string): void {
    const reservation = this.pendingReservations.get(reservationId);
    if (!reservation) return;

    const key = this.getGuardKey(reservation.network, reservation.wallet, reservation.mint);
    this.pendingReservations.delete(reservationId);
    this.reservedKeys.delete(key);

    // Invalidate trade count cache so next check sees the new trade
    this.tradeCountCache.delete(key);
  }

  public releaseReservation(reservationId: string): void {
    const reservation = this.pendingReservations.get(reservationId);
    if (!reservation) return;

    const key = this.getGuardKey(reservation.network, reservation.wallet, reservation.mint);
    this.pendingReservations.delete(reservationId);
    this.reservedKeys.delete(key);
  }

  // ==========================================
  // QUERIES
  // ==========================================

  public canBuy(params: { network: string; wallet: string; mint: string; maxRebuyTimes?: number; tradeOnlyOnce?: boolean }): { allowed: boolean; reason?: string } {
    const key = this.getGuardKey(params.network, params.wallet, params.mint);

    if (this.reservedKeys.has(key)) {
      return { allowed: false, reason: 'ALREADY_RESERVED' };
    }

    const maxRebuys = params.tradeOnlyOnce ? 1 : (params.maxRebuyTimes ?? 1);
    const completedCount = this.getCompletedBuyCount(params.network, params.wallet, params.mint);
    if (completedCount >= maxRebuys) {
      return { allowed: false, reason: `MAX_REBUYS_REACHED: ${completedCount}/${maxRebuys}` };
    }

    return { allowed: true };
  }

  public getCompletedBuyCount(network: string, wallet: string, mint: string): number {
    const key = this.getGuardKey(network, wallet, mint);
    const cached = this.tradeCountCache.get(key);
    if (cached && Date.now() - cached.cachedAt < this.CACHE_TTL_MS) {
      return cached.count;
    }

    const trades = tradeRepository.getTrades(network);
    const count = trades.filter(t =>
      t.mintAddress === mint.trim() &&
      t.side === 'BUY' &&
      t.status === 'CONFIRMED'
    ).length;

    this.tradeCountCache.set(key, { count, cachedAt: Date.now() });
    return count;
  }

  // Expose guard state for backend API monitoring
  public getGuardState(network: string, wallet: string, mint: string) {
    const key = this.getGuardKey(network, wallet, mint);
    const resId = this.reservedKeys.get(key);
    const reservation = resId ? this.pendingReservations.get(resId) : null;

    return {
      isReserved: !!reservation,
      reservationId: resId,
      reservedAt: reservation?.reservedAt,
      completedBuyCount: this.getCompletedBuyCount(network, wallet, mint),
    };
  }

  public resetBuyCount(mint?: string, network?: string, wallet?: string): void {
    if (!mint) {
      this.clear();
      return;
    }
    const net = network || 'paper';
    const wal = wallet || 'default';
    const key = this.getGuardKey(net, wal, mint);
    this.tradeCountCache.delete(key);
    const resId = this.reservedKeys.get(key);
    if (resId) {
      this.pendingReservations.delete(resId);
      this.reservedKeys.delete(key);
    }
  }

  public clear(): void {
    this.pendingReservations.clear();
    this.reservedKeys.clear();
    this.tradeCountCache.clear();
  }
}

export const rebuyGuard = RebuyGuard.getInstance();
