// src/services/WalletBalanceService.ts
import { useBalanceStore } from '../store/balanceStore';

export class WalletBalanceService {
  private static instance: WalletBalanceService;
  private intervalId: any = null;
  public network: string = 'paper';

  constructor(network: string = 'paper') {
    this.network = network;
  }

  public static getInstance(network: string = 'paper'): WalletBalanceService {
    if (!WalletBalanceService.instance) {
      WalletBalanceService.instance = new WalletBalanceService(network);
    }
    return WalletBalanceService.instance;
  }

  public async refresh(address?: string): Promise<number> {
    const targetAddr = address || useBalanceStore.getState().walletAddress;
    if (!targetAddr) return 0;
    try {
      const res = await fetch(`/api/balances?address=${encodeURIComponent(targetAddr)}&network=${this.network}`);
      if (res.ok) {
        const data = await res.json();
        if (data.sol !== undefined) {
          useBalanceStore.getState().setBalance({ solBalance: data.sol });
          useBalanceStore.getState().setOnChainBalance({ solBalance: data.sol });
          return data.sol;
        }
      }
    } catch {
      // Fallback
    }
    return useBalanceStore.getState().solBalance || 0;
  }

  public async refreshNow(address?: string): Promise<number> {
    return this.refresh(address);
  }

  public start(intervalMs: number = 5000): void {
    this.destroy();
    this.refresh();
    this.intervalId = setInterval(() => {
      this.refresh();
    }, intervalMs);
  }

  public startPolling(address: string, intervalMs: number = 10000): void {
    this.destroy();
    this.refresh(address);
    this.intervalId = setInterval(() => {
      this.refresh(address);
    }, intervalMs);
  }

  public updateNetwork(net: string): void {
    this.network = net;
    this.refresh();
  }

  public stopPolling(): void {
    this.destroy();
  }

  public destroy(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}

export const walletBalanceService = WalletBalanceService.getInstance();
