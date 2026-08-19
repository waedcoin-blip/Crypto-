// src/services/WalletBalanceService.ts
import { Connection, PublicKey } from '@solana/web3.js';
import { getNetworkConfig, TradingNetwork } from '../config/network';
import { useBalanceStore } from '../store/balanceStore';
import { useActiveWalletStore } from '../store/activeWalletStore';

const LAMPORTS_PER_SOL = 1_000_000_000;
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

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

  refreshNow(address?: string) {
    void this.refresh(address);
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

  async refresh(overrideAddress?: string): Promise<number> {
    const address = overrideAddress || useActiveWalletStore.getState().activeWallet?.address;
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

  /**
   * Fetch exact on-chain SPL token account balance for a specific mint
   */
  async getTokenBalance(mint: string, walletAddress?: string): Promise<number> {
    const address = walletAddress || useActiveWalletStore.getState().activeWallet?.address;
    if (!address) return 0;

    try {
      if (!this.connection) {
        const config = getNetworkConfig(this.network);
        this.connection = new Connection(config.rpcUrl, 'confirmed');
      }
      const owner = new PublicKey(address);
      const mintPk = new PublicKey(mint);

      const accounts = await this.connection.getParsedTokenAccountsByOwner(owner, {
        mint: mintPk
      });

      let totalRawAmount = 0;
      for (const account of accounts.value) {
        const amountStr = account.account.data.parsed?.info?.tokenAmount?.amount;
        if (amountStr) {
          totalRawAmount += Number(amountStr);
        }
      }
      return totalRawAmount;
    } catch (err) {
      console.warn(`Failed to fetch token balance for ${mint}:`, err);
      return 0;
    }
  }
}

export const walletBalanceService = new WalletBalanceService('devnet');
