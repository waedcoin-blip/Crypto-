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
    const lamports = await this.connection.getBalance(
      publicKey,
      'confirmed'
    );

    const sol = lamports / LAMPORTS_PER_SOL;

    useBalanceStore.getState().setBalance({
      solBalance: sol,
    });

    return sol;
  }

  start(walletAddress: string, intervalMs = 5_000): void {
    this.activeAddress = walletAddress;
    this.stop();

    const refresh = async () => {
      try {
        await this.refresh(walletAddress);
      } catch (error) {
        console.error('[WalletBalanceService] refresh failed:', error);

        useBalanceStore
          .getState()
          .setStatus(
            'error',
            error instanceof Error
              ? error.message
              : 'Balance refresh failed'
          );
      }
    };

    void refresh();

    this.timer = setInterval(
      refresh,
      intervalMs
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  destroy(): void {
    this.stop();
    this.connection = null;
  }
}

// Global active instance for unified background sync
let activeServiceInstance: WalletBalanceService | null = null;

export function getActiveWalletBalanceService(network: TradingNetwork = 'devnet'): WalletBalanceService {
  if (!activeServiceInstance) {
    activeServiceInstance = new WalletBalanceService(network);
  }
  return activeServiceInstance;
}
