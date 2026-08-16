// src/services/WalletBalanceService.ts
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { useBalanceStore } from '../store/balanceStore';

class WalletBalanceService {
  private static instance: WalletBalanceService;
  private connection: Connection | null = null;
  private activeAddress: string | null = null;
  private pollIntervalId: any = null;
  private isFetching = false;
  private lastFetchTime = 0;

  private constructor() {}

  public static getInstance(): WalletBalanceService {
    if (!WalletBalanceService.instance) {
      WalletBalanceService.instance = new WalletBalanceService();
    }
    return WalletBalanceService.instance;
  }

  /**
   * Set or update the active connection and active address
   */
  public setContext(connection: Connection | null, address: string | null): void {
    const addressChanged = this.activeAddress !== address;
    const connectionChanged = this.connection !== connection;

    this.connection = connection;
    this.activeAddress = address;

    useBalanceStore.getState().setWalletAddress(address);

    if (addressChanged || connectionChanged) {
      if (!address || !connection) {
        useBalanceStore.getState().setRealSolBalance(null, address);
        useBalanceStore.getState().setStatus('idle');
      } else {
        this.refreshNow();
      }
    }
  }

  /**
   * Start polling for on-chain wallet balance
   */
  public startPolling(intervalMs: number = 8000): void {
    this.stopPolling();
    this.refreshNow();
    this.pollIntervalId = setInterval(() => {
      this.refreshNow();
    }, intervalMs);
  }

  /**
   * Stop polling
   */
  public stopPolling(): void {
    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
    }
  }

  /**
   * Force an immediate on-chain balance fetch (e.g. after buy/sell execution)
   */
  public async refreshNow(): Promise<number | null> {
    if (!this.connection || !this.activeAddress) {
      useBalanceStore.getState().setRealSolBalance(null, this.activeAddress);
      return null;
    }

    if (this.isFetching) {
      return useBalanceStore.getState().realSolBalance;
    }

    this.isFetching = true;
    const store = useBalanceStore.getState();
    if (store.status === 'idle' || store.realSolBalance === null) {
      store.setStatus('loading');
    }

    try {
      const pubkey = new PublicKey(this.activeAddress);
      const lamports = await this.connection.getBalance(pubkey, 'confirmed');
      const solBalance = lamports / LAMPORTS_PER_SOL;

      this.lastFetchTime = Date.now();
      useBalanceStore.getState().setRealSolBalance(solBalance, this.activeAddress);
      useBalanceStore.getState().setStatus('live', null);

      return solBalance;
    } catch (err: any) {
      console.warn(`[WalletBalanceService] Failed to fetch live SOL balance for ${this.activeAddress}:`, err);
      const isStale = this.lastFetchTime > 0 && (Date.now() - this.lastFetchTime < 60000);
      useBalanceStore.getState().setStatus(isStale ? 'stale' : 'error', err?.message || 'Failed to fetch balance');
      return useBalanceStore.getState().realSolBalance;
    } finally {
      this.isFetching = false;
    }
  }

  /**
   * Get current state snapshot
   */
  public getSnapshot() {
    return useBalanceStore.getState();
  }
}

export const walletBalanceService = WalletBalanceService.getInstance();
