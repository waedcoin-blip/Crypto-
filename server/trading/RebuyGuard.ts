// server/trading/RebuyGuard.ts
import { positionManager } from './PositionManager.js';
import { tradeRepository } from '../repositories/TradeRepository.js';

export interface BuyReservation {
  reservationId: string;
  network: string;
  wallet: string;
  mint: string;
  amountSol: number;
  reservedAt: number;
}

export class RebuyGuard {
  private static instance: RebuyGuard;
  private pendingReservations: Map<string, BuyReservation> = new Map(); // reservationId -> reservation
  private reservedKeys: Map<string, string> = new Map(); // network:wallet:mint -> reservationId
  private completedBuyCounts: Map<string, number> = new Map(); // network:wallet:mint -> completed count

  private constructor() {}

  public static getInstance(): RebuyGuard {
    if (!RebuyGuard.instance) {
      RebuyGuard.instance = new RebuyGuard();
    }
    return RebuyGuard.instance;
  }

  public getGuardKey(network: string, wallet: string, mint: string): string {
    // Solana base58 addresses are case-sensitive; never lowercase them.
    return `${network.trim().toLowerCase()}:${wallet.trim()}:${mint.trim()}`;
  }

  public getCompletedBuyCount(network: string, wallet: string, mint: string): number {
    const key = this.getGuardKey(network, wallet, mint);
    // The repository is authoritative across process restarts. The in-memory
    // counter remains a fast-path for the current process.
    const persisted = tradeRepository.getTrades(network).filter((t) =>
      t.side === 'BUY' &&
      t.status === 'CONFIRMED' &&
      (t.wallet || 'default') === wallet.trim() &&
      t.mintAddress.trim() === mint.trim()
    ).length;
    const memory = this.completedBuyCounts.get(key) || 0;
    return Math.max(persisted, memory);
  }

  /**
   * Check if a BUY is permitted under the RebuyGuard rules.
   * Accepts either an object or positional arguments (network, wallet, mint).
   */
  public canBuy(
    paramsOrNetwork:
      | {
          network: string;
          wallet: string;
          mint: string;
          maxRebuyTimes?: number;
          tradeOnlyOnce?: boolean;
        }
      | string,
    walletArg?: string,
    mintArg?: string
  ): { allowed: boolean; reason: string } {
    let network: string;
    let wallet: string;
    let mint: string;
    let maxRebuyTimes: number | undefined;
    let tradeOnlyOnce: boolean | undefined;

    if (typeof paramsOrNetwork === 'string') {
      network = paramsOrNetwork;
      wallet = walletArg || 'default';
      mint = mintArg || '';
    } else {
      network = paramsOrNetwork.network;
      wallet = paramsOrNetwork.wallet;
      mint = paramsOrNetwork.mint;
      maxRebuyTimes = paramsOrNetwork.maxRebuyTimes;
      tradeOnlyOnce = paramsOrNetwork.tradeOnlyOnce;
    }

    const key = this.getGuardKey(network, wallet, mint);

    // 1. Check if reservation currently active or on HOLD
    if (this.reservedKeys.has(key)) {
      return { allowed: false, reason: 'BUY_RESERVATION_ACTIVE: A buy transaction is already pending or held for this mint' };
    }

    // 2. Check position status
    const existingPosition = positionManager.getPosition(network, wallet, mint);
    if (existingPosition && existingPosition.status === 'BUY_PENDING') {
      return { allowed: false, reason: 'POSITION_BUY_PENDING: Position is currently buying' };
    }

    // 3. Rebuy count check
    const maxRebuys = Math.max(0, Math.floor(Number(maxRebuyTimes ?? 1)));
    const maxTotalBuys = tradeOnlyOnce ? 1 : 1 + maxRebuys;
    const currentCompleted = this.getCompletedBuyCount(network, wallet, mint);

    if (currentCompleted >= maxTotalBuys) {
      return {
        allowed: false,
        reason: tradeOnlyOnce
          ? `TRADE_ONLY_ONCE: Completed ${currentCompleted}/${maxTotalBuys} total buys`
          : `REBUY_LIMIT_REACHED: Completed ${currentCompleted}/${maxTotalBuys} total buys (maxRebuyTimes: ${maxRebuys})`,
      };
    }

    return { allowed: true, reason: 'OK' };
  }

  /**
   * Atomically reserve a BUY slot.
   */
  public reserveBuy(params: {
    network: string;
    wallet: string;
    mint: string;
    amountSol: number;
    maxRebuyTimes?: number;
    tradeOnlyOnce?: boolean;
  }): BuyReservation {
    const check = this.canBuy(params);
    if (!check.allowed) {
      throw new Error(`REBUY_GUARD_REJECTED: ${check.reason}`);
    }

    const key = this.getGuardKey(params.network, params.wallet, params.mint);
    const reservationId = `res_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const reservation: BuyReservation = {
      reservationId,
      network: params.network,
      wallet: params.wallet,
      mint: params.mint,
      amountSol: params.amountSol,
      reservedAt: Date.now(),
    };

    this.pendingReservations.set(reservationId, reservation);
    this.reservedKeys.set(key, reservationId);

    return reservation;
  }

  /**
   * Release reservation on execution failure.
   * Ensures failed BUY never permanently locks token!
   */
  public releaseBuy(reservationId: string): void {
    const res = this.pendingReservations.get(reservationId);
    if (!res) return;

    const key = this.getGuardKey(res.network, res.wallet, res.mint);
    this.pendingReservations.delete(reservationId);
    if (this.reservedKeys.get(key) === reservationId) {
      this.reservedKeys.delete(key);
    }
  }

  /**
   * Confirm BUY on successful execution. Increments completed BUY count.
   */
  public confirmBuy(reservationId: string): void {
    const res = this.pendingReservations.get(reservationId);
    if (!res) return;

    const key = this.getGuardKey(res.network, res.wallet, res.mint);
    const current = this.completedBuyCounts.get(key) || 0;
    this.completedBuyCounts.set(key, current + 1);

    this.releaseBuy(reservationId);
  }

  /**
   * Puts reservation on HOLD for unknown transaction status (timeout or ambiguous broadcast).
   * Does NOT release the reservation and flags manual reconciliation required.
   */
  public holdBuy(reservationId: string, signature?: string, reason?: string): void {
    const res = this.pendingReservations.get(reservationId);
    if (!res) return;
    console.warn(
      `[REBUY_GUARD_HELD] reservationId=${reservationId} mint=${res.mint} sig=${signature || 'none'} reason=${reason || 'UNKNOWN_STATUS'}. Reservation retained to prevent duplicate spend.`
    );
    // Keep in pendingReservations and reservedKeys so canBuy remains false!
  }

  /**
   * Clean up all locks and reservations for a mint (e.g. when position is closed).
   */
  public releaseAllForMint(network: string, wallet: string, mint: string): void {
    const key = this.getGuardKey(network, wallet, mint);
    const resId = this.reservedKeys.get(key);
    if (resId) {
      this.pendingReservations.delete(resId);
      this.reservedKeys.delete(key);
    }
  }

  public resetBuyCount(network: string, wallet: string, mint: string): void {
    const key = this.getGuardKey(network, wallet, mint);
    this.completedBuyCounts.delete(key);
  }
}

export const rebuyGuard = RebuyGuard.getInstance();
