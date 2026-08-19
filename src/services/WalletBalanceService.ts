// src/services/WalletBalanceService.ts
import { Connection, PublicKey } from '@solana/web3.js';
import { getNetworkConfig, TradingNetwork } from '../config/network';
import { useBalanceStore } from '../store/balanceStore';
import { useAppStore } from '../store/appStore';
import { getSimExecutor } from './SimExecutorSingleton';
import { useActiveWalletStore } from '../store/activeWalletStore';

const LAMPORTS_PER_SOL = 1_000_000_000;

export class WalletBalanceService {
  private connection: Connection | null = null;
  private network: TradingNetwork;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(network: TradingNetwork) {
    this.network = network;
    const config = getNetworkConfig(network);
    this.connection = new Connection(config.rpcUrl, 'confirmed');
    useBalanceStore.getState().setNetwork(network);
  }

  refreshNow() {
    void this.refresh();
  }

  start(intervalMs: number) {
    this.refresh();
    this.timer = setInterval(() => this.refresh(), intervalMs);
  }

  destroy() {
    if (this.timer) clearInterval(this.timer);
  }

  public updateNetwork(network: TradingNetwork): void {
    this.network = network;
    const config = getNetworkConfig(network);
    this.connection = new Connection(config.rpcUrl, 'confirmed');
    useBalanceStore.getState().setNetwork(network);
    void this.refresh();
  }

  async refresh(): Promise<number> {
    const address = useActiveWalletStore.getState().activeWallet?.address;
    if (!address) {
      useBalanceStore.getState().setWalletAddress(null);
      return 0;
    }
    try {
      if (!this.connection) {
        const config = getNetworkConfig(this.network);
        this.connection = new Connection(config.rpcUrl, 'confirmed');
      }
      useBalanceStore.getState().setWalletAddress(address);
      const publicKey = new PublicKey(address);
      const balance = await this.connection.getBalance(publicKey);
      const sol = balance / LAMPORTS_PER_SOL;
      useBalanceStore.getState().setOnChainBalance({ solBalance: sol });
      return sol;
    } catch (err) {
      console.warn('Wallet balance query error for', address, err);
      return 0;
    }
  }
}

export const walletBalanceService = new WalletBalanceService('devnet');
