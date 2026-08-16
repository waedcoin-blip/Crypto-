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

  start(address: string, intervalMs: number) {
    this.activeAddress = address;
    this.refresh(address);
    this.timer = setInterval(() => this.refresh(address), intervalMs);
  }
  
  destroy() {
    if (this.timer) clearInterval(this.timer);
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
    if (!this.connection) {
      throw new Error('Wallet balance connection unavailable');
    }

    if (!address) {
      throw new Error('Wallet address is required');
    }

    useBalanceStore.getState().setWalletAddress(address);

    const publicKey = new PublicKey(address);
    const balance = await this.connection.getBalance(publicKey);
    const sol = balance / LAMPORTS_PER_SOL;
    useBalanceStore.getState().setBalance(sol);
    return sol;
  }
}

export const walletBalanceService = new WalletBalanceService('devnet');
