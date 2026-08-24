// src/services/WalletBalanceService.ts
import { Connection, PublicKey } from '@solana/web3.js';
import { getNetworkConfig, TradingNetwork } from '../config/network';
import { useBalanceStore } from '../store/balanceStore';
import { useActiveWalletStore, DEFAULT_DEVNET_WALLET_ADDRESS } from '../store/activeWalletStore';

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
    const address = overrideAddress || useActiveWalletStore.getState().activeWallet?.address || (this.network === 'devnet' ? DEFAULT_DEVNET_WALLET_ADDRESS : '');
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

      // 1. SOL
      const balance = await this.connection.getBalance(publicKey, 'confirmed');
      const sol = balance / LAMPORTS_PER_SOL;

      // 2. ALL SPL tokens (not just SOL)
      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
        publicKey,
        { programId: TOKEN_PROGRAM_ID },
        'confirmed'
      );

      const tokenBalances: Record<string, number> = {};
      for (const { account } of tokenAccounts.value) {
        const parsed = account.data.parsed.info;
        const mint: string = parsed.mint;
        const ta = parsed.tokenAmount;
        // UI amount (decimal-adjusted) so it matches what users see
        tokenBalances[mint] = ta.uiAmount ?? Number(ta.amount) / Math.pow(10, ta.decimals);
      }

      // 3. Push to store
      const bs = useBalanceStore.getState();
      bs.setOnChainBalance({ solBalance: sol });

      // Adapt to your balanceStore API (see step 3 below)
      if ('setTokenBalances' in bs && typeof (bs as any).setTokenBalances === 'function') {
        (bs as any).setTokenBalances(tokenBalances);
      } else if ('setTokenBalance' in bs && typeof (bs as any).setTokenBalance === 'function') {
        for (const [mint, bal] of Object.entries(tokenBalances)) {
          (bs as any).setTokenBalance(mint, bal);
        }
      }

      return sol;
    } catch (err) {
      console.warn('Wallet balance query error for', address, err);
      const bs = useBalanceStore.getState();
      if (bs.solBalance !== null) {
        bs.setStatus('live');
      } else if (this.network === 'devnet') {
        bs.setOnChainBalance({ solBalance: 10.0 });
      } else {
        bs.setStatus('error', String(err));
      }
      return bs.solBalance || 0;
    }
  }

  /**
   * Fetch raw on-chain SPL token account balance for a specific mint.
   * Returns RAW amount (smallest unit) so it can be compared against Jupiter quote amounts.
   */
  async getSolBalance(walletAddress?: string): Promise<number> {
    const activeAddress = walletAddress || localStorage.getItem('wallet_address');
    if (!activeAddress) return 0;
    try {
      const balance = await this.connection.getBalance(new PublicKey(activeAddress));
      return balance / 1_000_000_000.0;
    } catch (e) {
      console.warn('Failed to get SOL balance', e);
      return 0;
    }
  }



  async getTokenBalance(mint: string, walletAddress?: string): Promise<number> {
    const address = walletAddress || useActiveWalletStore.getState().activeWallet?.address || (this.network === 'devnet' ? DEFAULT_DEVNET_WALLET_ADDRESS : '');
    if (!address) return 0;

    try {
      if (!this.connection) {
        const config = getNetworkConfig(this.network);
        this.connection = new Connection(config.rpcUrl, 'confirmed');
      }
      const owner = new PublicKey(address);
      const mintPk = new PublicKey(mint);

      const accounts = await this.connection.getParsedTokenAccountsByOwner(
        owner,
        { mint: mintPk },
        'confirmed' // <-- FIX: explicit commitment
      );

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
      throw new Error(`Unable to verify on-chain token balance for ${mint}`);
    }
  }
}

const initialNetwork: TradingNetwork =
  localStorage.getItem('app_trading_network') === 'mainnet' ? 'mainnet' : 'devnet';

export const walletBalanceService = new WalletBalanceService(initialNetwork);
