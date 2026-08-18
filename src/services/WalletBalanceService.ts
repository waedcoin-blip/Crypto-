// src/services/WalletBalanceService.ts
import { Connection, PublicKey } from '@solana/web3.js';
import { getNetworkConfig, TradingNetwork } from '../config/network';
import { useBalanceStore } from '../store/balanceStore';

const LAMPORTS_PER_SOL = 1_000_000_000;

export class WalletBalanceService {
  private connection: Connection | null = null;
  private network: TradingNetwork;
  private timer: ReturnType<typeof setInterval> | null = null;
  private activeAddress: string | null = null;
  private refreshGeneration = 0;

  constructor(network: TradingNetwork) {
    this.network = network;
    const config = getNetworkConfig(network);
    this.connection = new Connection(config.rpcUrl, 'confirmed');
    useBalanceStore.getState().setNetwork(network);
  }

  refreshNow() {
    if (this.activeAddress) {
      void this.refresh(this.activeAddress);
    }
  }

  start(address: string, intervalMs = 5000) {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.activeAddress = address;
    void this.refresh(address);
    this.timer = setInterval(() => void this.refresh(this.activeAddress || address), intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  destroy() {
    this.stop();
  }

  public updateNetwork(network: TradingNetwork): void {
    this.network = network;
    const config = getNetworkConfig(network);
    this.connection = new Connection(config.rpcUrl, 'confirmed');
    useBalanceStore.getState().setNetwork(network);
    if (this.activeAddress) {
      void this.refresh(this.activeAddress);
    }
  }

  async refresh(walletAddress?: string): Promise<number> {
    const address = walletAddress || this.activeAddress;
    if (!address) {
      useBalanceStore.getState().reset();
      return 0;
    }

    const requestId = ++this.refreshGeneration;
    this.activeAddress = address;

    try {
      if (!this.connection) {
        const config = getNetworkConfig(this.network);
        this.connection = new Connection(config.rpcUrl, 'confirmed');
      }

      // Mark address in store if not set
      if (useBalanceStore.getState().walletAddress !== address) {
        useBalanceStore.getState().setWalletAddress(address);
      }

      const publicKey = new PublicKey(address);
      const balance = await this.connection.getBalance(publicKey);
      const sol = balance / LAMPORTS_PER_SOL;

      // Generation & Active Address Guard to eliminate async race conditions
      if (requestId !== this.refreshGeneration || this.activeAddress !== address) {
        return sol;
      }

      useBalanceStore.getState().setOnChainBalance({ solBalance: sol });
      return sol;
    } catch (err) {
      if (requestId === this.refreshGeneration && this.activeAddress === address) {
        console.warn('Wallet balance query notice for', address, err);
      }
      return 0;
    }
  }
}

export const walletBalanceService = new WalletBalanceService('devnet');
